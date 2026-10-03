import { RateLimiter } from './rateLimiter.ts';
import {
  type FeatureCostSku,
  type FitzpatrickResults,
  type SkinAnalysisRequest,
  type SkinAnalysisResults,
  type TaskPoll,
  type TaskSource,
  type UploadSlot,
  YouCamApiError,
  type YouCamClient,
} from './types.ts';

/** The only host the API key is ever sent to. */
export const YOUCAM_API_HOST = 'https://yce-api-01.makeupar.com';
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const RETRIES_ON_429 = 3;
const API_TIMEOUT_MS = 30_000;
const TRANSFER_TIMEOUT_MS = 60_000;

type FetchLike = typeof fetch;

export interface HttpClientOptions {
  apiKey: string;
  fetchImpl?: FetchLike;
  limiter?: RateLimiter;
  sleep?: (ms: number) => Promise<void>;
  /** Test-only override; production always uses YOUCAM_API_HOST. */
  baseUrl?: string;
}

function sourceBody(source: TaskSource): Record<string, string> {
  return 'fileId' in source ? { src_file_id: source.fileId } : { src_file_url: source.url };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Implements the documented REST flow (docs/API_NOTES.md): File API → presigned
 * PUT → run task → poll → delete. The Authorization header is attached only to
 * requests for YOUCAM_API_HOST, never to presigned S3 upload/download URLs.
 */
export class HttpYouCamClient implements YouCamClient {
  readonly mode = 'live' as const;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly limiter: RateLimiter;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly baseUrl: string;

  constructor(opts: HttpClientOptions) {
    if (!opts.apiKey) throw new Error('YouCam API key missing');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.limiter = opts.limiter ?? new RateLimiter();
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.baseUrl = opts.baseUrl ?? YOUCAM_API_HOST;
  }

  /** fetch with a timeout; network failures become YouCamApiError `YouCamUnreachable`. */
  private async send(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new YouCamApiError(503, 'YouCamUnreachable', 'YouCam did not answer');
    }
  }

  private async api(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Record<string, unknown>> {
    for (let attempt = 0; ; attempt++) {
      await this.limiter.acquire();
      const res = await this.send(
        `${this.baseUrl}${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        API_TIMEOUT_MS,
      );
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = null;
      }
      if (res.status === 429 && attempt < RETRIES_ON_429) {
        await this.sleep(1000 * 2 ** attempt);
        continue;
      }
      if (!res.ok || !isRecord(json)) {
        const rec = isRecord(json) ? json : {};
        const code =
          (typeof rec.error_code === 'string' && rec.error_code) ||
          (res.status === 401 ? 'InvalidAccessToken' : res.status === 429 ? 'RateLimited' : res.status === 500 && /time/i.test(String(rec.error)) ? 'TaskTimeout' : `HTTP${res.status}`);
        const message = typeof rec.error === 'string' ? rec.error : `YouCam returned HTTP ${res.status}`;
        throw new YouCamApiError(res.status, code, message);
      }
      return json;
    }
  }

  private static data(json: Record<string, unknown>): Record<string, unknown> {
    return isRecord(json.data) ? json.data : json;
  }

  async createUpload(file: { contentType: string; fileName: string; size: number }): Promise<UploadSlot> {
    const json = await this.api('POST', '/s2s/v2.0/file', {
      files: [{ content_type: file.contentType, file_name: file.fileName, file_size: file.size }],
    });
    // Documented example: data.files[0]; the bundle schema is ambiguous, so accept files[0] too.
    const files = HttpYouCamClient.data(json).files;
    const f = Array.isArray(files) ? files[0] : undefined;
    const req = isRecord(f) && Array.isArray(f.requests) ? f.requests[0] : undefined;
    if (!isRecord(f) || typeof f.file_id !== 'string' || !isRecord(req) || typeof req.url !== 'string') {
      throw new YouCamApiError(502, 'BadFileResponse', 'Unexpected File API response shape');
    }
    const headers: Record<string, string> = {};
    if (isRecord(req.headers)) for (const [k, v] of Object.entries(req.headers)) headers[k] = String(v);
    return { fileId: f.file_id, url: req.url, method: typeof req.method === 'string' ? req.method : 'PUT', headers };
  }

  async putUpload(slot: UploadSlot, bytes: Uint8Array): Promise<void> {
    // Presigned URL: send exactly the headers YouCam returned and nothing else (no API key).
    const res = await this.send(slot.url, { method: slot.method, headers: slot.headers, body: bytes as Uint8Array<ArrayBuffer> }, TRANSFER_TIMEOUT_MS);
    if (!res.ok) throw new YouCamApiError(res.status, 'error_upload', `Upload to storage failed (HTTP ${res.status})`);
  }

  async startSkinAnalysis(req: SkinAnalysisRequest): Promise<string> {
    const body: Record<string, unknown> = {
      ...sourceBody(req.source),
      dst_actions: req.dstActions,
      format: 'json',
      miniserver_args: { enable_mask_overlay: false },
    };
    if (req.cameraKit) body.pf_camera_kit = true;
    return this.taskId(await this.api('POST', '/s2s/v2.1/task/skin-analysis', body));
  }

  async pollSkinAnalysis(taskId: string): Promise<TaskPoll<SkinAnalysisResults>> {
    const json = await this.api('GET', `/s2s/v2.1/task/skin-analysis/${encodeURIComponent(taskId)}`);
    return this.poll(json, (results) => {
      if (isRecord(results) && Array.isArray(results.output)) return { output: results.output as SkinAnalysisResults['output'] };
      throw new YouCamApiError(502, 'BadResultShape', 'Skin analysis returned no output array');
    });
  }

  async startFitzpatrick(source: TaskSource): Promise<string> {
    return this.taskId(await this.api('POST', '/s2s/v2.0/task/fitzpatrick-scale-analyzer', { ...sourceBody(source), version: '1.0' }));
  }

  async pollFitzpatrick(taskId: string): Promise<TaskPoll<FitzpatrickResults>> {
    const json = await this.api('GET', `/s2s/v2.0/task/fitzpatrick-scale-analyzer/${encodeURIComponent(taskId)}`);
    return this.poll(json, (results) => {
      if (isRecord(results) && typeof results.fitzpatrick_scale === 'string') {
        const out: FitzpatrickResults = { fitzpatrick_scale: results.fitzpatrick_scale };
        if (typeof results.timed === 'number') out.timed = results.timed;
        return out;
      }
      throw new YouCamApiError(502, 'BadResultShape', 'Fitzpatrick returned no scale');
    });
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.api('POST', '/s2s/v2.0/task/delete', { task_id: taskId });
  }

  async getBalance(): Promise<number> {
    const json = await this.api('GET', '/s2s/v1.0/client/credit');
    const results = Array.isArray(json.results) ? json.results : [];
    const now = Date.now();
    return results.reduce((sum: number, r) => {
      if (!isRecord(r)) return sum;
      if (typeof r.expiry === 'number' && r.expiry > 0 && r.expiry < now) return sum;
      const amount = typeof r.amount_dec === 'number' ? r.amount_dec : typeof r.amount === 'number' ? r.amount : 0;
      return sum + amount;
    }, 0);
  }

  async getFeatureCosts(): Promise<FeatureCostSku[]> {
    const skus: FeatureCostSku[] = [];
    let token: string | null = null;
    for (let page = 0; page < 10; page++) {
      const qs = new URLSearchParams({ page_size: '20' });
      if (token) qs.set('starting_token', token);
      const json = await this.api('GET', `/s2s/v2.0/credit/feature-cost?${qs}`);
      const result = isRecord(json.result) ? json.result : {};
      if (Array.isArray(result.skus)) skus.push(...(result.skus as FeatureCostSku[]));
      token = typeof result.next_token === 'string' && result.next_token ? result.next_token : null;
      if (!token) break;
    }
    return skus;
  }

  async fetchAsset(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    if (!/^https:\/\//.test(url)) throw new YouCamApiError(400, 'BadAssetUrl', 'Result URL is not https');
    const res = await this.send(url, {}, TRANSFER_TIMEOUT_MS); // presigned result URL: no Authorization header
    if (!res.ok) throw new YouCamApiError(res.status, 'error_download', `Result download failed (HTTP ${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_ASSET_BYTES) throw new YouCamApiError(413, 'AssetTooLarge', 'Result image is unexpectedly large');
    return { bytes, contentType: res.headers.get('content-type') ?? 'image/png' };
  }

  private taskId(json: Record<string, unknown>): string {
    const id = HttpYouCamClient.data(json).task_id;
    if (typeof id !== 'string' || !id) throw new YouCamApiError(502, 'BadTaskResponse', 'No task_id in response');
    return id;
  }

  private poll<R>(json: Record<string, unknown>, parse: (results: unknown) => R): TaskPoll<R> {
    const d = HttpYouCamClient.data(json);
    const state = d.task_status;
    if (state !== 'running' && state !== 'success' && state !== 'error') {
      throw new YouCamApiError(502, 'BadTaskStatus', `Unknown task_status ${String(state)}`);
    }
    return {
      state,
      results: state === 'success' ? parse(d.results) : null,
      errorCode: typeof d.error === 'string' ? d.error : null,
      errorMessage: typeof d.error_message === 'string' ? d.error_message : null,
    };
  }
}
