import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findSample } from '../samples.ts';
import {
  type FeatureCostSku,
  type FitzpatrickResults,
  type SkinAnalysisRequest,
  type SkinAnalysisResults,
  type SkinOutputEntry,
  type TaskPoll,
  type TaskSource,
  type UploadSlot,
  YouCamApiError,
  type YouCamClient,
} from './types.ts';

/**
 * Demo-mode YouCam client. It replays the responses recorded from the real API
 * on 2026-10-02 (fixtures/recorded/, see docs/API_NOTES.md §12) through the same
 * interface and wire shapes as HttpYouCamClient, including the rules the live
 * API enforced: SD and HD actions can't mix, uploads must match the declared
 * size, a running task can't be deleted, and result URLs stop working once the
 * task is deleted.
 *
 * Scores are the recorded ones for whatever concerns are requested; they do not
 * depend on the photo. Mask images exist only for YouCam's sample face
 * yc-skin-01 (and only if fixtures/recorded/masks/ is present locally), so other
 * photos get no masks and the web app falls back to its approximate zone map.
 */

const SD_ACTIONS = new Set([
  'wrinkle', 'pore', 'texture', 'acne', 'oiliness', 'radiance', 'eye_bag', 'age_spot',
  'dark_circle_v2', 'droopy_upper_eyelid', 'droopy_lower_eyelid', 'firmness', 'moisture', 'redness', 'tear_trough', 'skin_type',
]);
const HD_ACTIONS = new Set([...SD_ACTIONS].map((a) => (a === 'dark_circle_v2' ? 'hd_dark_circle' : `hd_${a}`)));
const MASK_SAMPLE_ID = 'yc-skin-01';

interface Fixtures {
  skinOutput: SkinOutputEntry[];
  fitzpatrick: FitzpatrickResults;
  skus: FeatureCostSku[];
  balance: number;
}

type MockTask =
  | { kind: 'skin'; polls: number; deleted: boolean; actions: string[]; masks: boolean; done: boolean }
  | { kind: 'fitzpatrick'; polls: number; deleted: boolean; done: boolean };

export interface MockClientOptions {
  fixturesDir: string;
  /** Polls that report "running" before success (the live API took 3). */
  runningPolls?: number;
  /** Make every task end in this YouCam error code (tests and error-path demos). */
  failWith?: string;
}

function readJson(path: string): unknown {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as unknown) : null;
}

function loadFixtures(dir: string): Fixtures {
  const skin = readJson(resolve(dir, 'skin-analysis-sd.json')) as { calls?: { body?: { data?: { task_status?: string; results?: { output?: SkinOutputEntry[] } } } }[] } | null;
  const success = skin?.calls?.find((c) => c.body?.data?.task_status === 'success');
  const fitz = readJson(resolve(dir, 'fitzpatrick.json')) as { calls?: { body?: { data?: { task_status?: string; results?: FitzpatrickResults } } }[] } | null;
  const fitzOk = fitz?.calls?.find((c) => c.body?.data?.task_status === 'success')?.body?.data?.results;
  const costs = readJson(resolve(dir, 'feature-cost.json')) as { skus?: FeatureCostSku[] } | null;
  const delta = readJson(resolve(dir, 'balance-delta.json')) as { after?: number } | null;
  return {
    skinOutput: success?.body?.data?.results?.output ?? [],
    fitzpatrick: fitzOk ?? { fitzpatrick_scale: 'III' },
    skus: costs?.skus ?? [],
    balance: typeof delta?.after === 'number' ? delta.after : 1000,
  };
}

function maskFile(type: string, region: string | undefined): string {
  return `${type}${region && region !== 'whole' ? `-${region}` : ''}.png`;
}

export class MockYouCamClient implements YouCamClient {
  readonly mode = 'mock' as const;
  private readonly fixtures: Fixtures;
  private readonly masksDir: string;
  private readonly runningPolls: number;
  private readonly failWith: string | undefined;
  private readonly uploads = new Map<string, { size: number; contentType: string; uploaded: boolean }>();
  private readonly tasks = new Map<string, MockTask>();
  /** Calls made, in order, so tests can assert the pipeline's sequence. */
  readonly calls: string[] = [];

  constructor(opts: MockClientOptions) {
    this.fixtures = loadFixtures(opts.fixturesDir);
    this.masksDir = resolve(opts.fixturesDir, 'masks', MASK_SAMPLE_ID);
    this.runningPolls = opts.runningPolls ?? 2;
    this.failWith = opts.failWith;
  }

  /** True when recorded scores exist (fixtures/recorded/skin-analysis-sd.json). */
  get hasFixtures(): boolean {
    return this.fixtures.skinOutput.length > 0;
  }

  async createUpload(file: { contentType: string; fileName: string; size: number }): Promise<UploadSlot> {
    this.calls.push('createUpload');
    if (!/^image\/(jpe?g|png)$/.test(file.contentType)) throw new YouCamApiError(400, 'InvalidParameters', 'Unsupported content_type');
    if (file.size > 10 * 1024 * 1024) throw new YouCamApiError(400, 'exceed_max_filesize', 'File too large');
    const fileId = `mock-file-${randomUUID()}`;
    this.uploads.set(fileId, { size: file.size, contentType: file.contentType, uploaded: false });
    return { fileId, url: `mock://upload/${fileId}`, method: 'PUT', headers: { 'Content-Length': String(file.size), 'Content-Type': file.contentType } };
  }

  async putUpload(slot: UploadSlot, bytes: Uint8Array): Promise<void> {
    this.calls.push('putUpload');
    const u = this.uploads.get(slot.fileId);
    // S3 rejects a body whose length differs from the signed Content-Length.
    if (!u || bytes.byteLength !== u.size || slot.headers['Content-Length'] !== String(u.size)) throw new YouCamApiError(403, 'error_upload', 'Upload to storage failed (HTTP 403)');
    u.uploaded = true;
  }

  private checkSource(source: TaskSource): { masks: boolean } {
    if ('fileId' in source) {
      if (!this.uploads.get(source.fileId)?.uploaded) throw new YouCamApiError(404, 'InvalidParameters', 'File not found or not uploaded');
      return { masks: false };
    }
    if (!/^https:\/\//.test(source.url)) throw new YouCamApiError(400, 'InvalidParameters', 'src_file_url must be https');
    return { masks: source.url === findSample(MASK_SAMPLE_ID)?.url && existsSync(this.masksDir) };
  }

  async startSkinAnalysis(req: SkinAnalysisRequest): Promise<string> {
    this.calls.push('startSkinAnalysis');
    const actions = [...new Set(req.dstActions)];
    if (actions.length === 0) throw new YouCamApiError(400, 'InvalidParameters', 'dst_actions is empty');
    for (const a of actions) if (!SD_ACTIONS.has(a) && !HD_ACTIONS.has(a)) throw new YouCamApiError(400, 'InvalidParameters', `Not available dst_action ${a}`);
    if (actions.some((a) => SD_ACTIONS.has(a)) && actions.some((a) => HD_ACTIONS.has(a))) throw new YouCamApiError(400, 'InvalidParameters', 'cannot mix HD and SD dst_actions');
    const { masks } = this.checkSource(req.source);
    const id = `mock-task-${randomUUID()}`;
    this.tasks.set(id, { kind: 'skin', polls: 0, deleted: false, actions, masks, done: false });
    return id;
  }

  private task(taskId: string, kind: MockTask['kind']): MockTask {
    const t = this.tasks.get(taskId);
    if (!t || t.kind !== kind || t.deleted) throw new YouCamApiError(400, 'InvalidTaskId', 'Invalid task ID');
    return t;
  }

  private step<R>(t: MockTask, results: () => R): TaskPoll<R> {
    t.polls++;
    if (t.polls <= this.runningPolls) return { state: 'running', results: null, errorCode: null, errorMessage: null };
    t.done = true;
    if (this.failWith) return { state: 'error', results: null, errorCode: this.failWith, errorMessage: `Mock failure: ${this.failWith}` };
    return { state: 'success', results: results(), errorCode: null, errorMessage: null };
  }

  async pollSkinAnalysis(taskId: string): Promise<TaskPoll<SkinAnalysisResults>> {
    this.calls.push('pollSkinAnalysis');
    const t = this.task(taskId, 'skin');
    if (t.kind !== 'skin') throw new Error('unreachable');
    return this.step(t, () => ({ output: this.buildOutput(taskId, t.actions, t.masks) }));
  }

  private buildOutput(taskId: string, actions: string[], masks: boolean): SkinOutputEntry[] {
    const out: SkinOutputEntry[] = [];
    for (const action of actions) {
      const hd = action.startsWith('hd_');
      const base = hd ? (action === 'hd_dark_circle' ? 'dark_circle_v2' : action.slice(3)) : action;
      for (const rec of this.fixtures.skinOutput.filter((e) => e.type === base)) {
        const file = maskFile(base, rec.region);
        const entry: SkinOutputEntry = { ...rec, type: action, mask_urls: masks && existsSync(resolve(this.masksDir, file)) ? [`mock://mask/${taskId}/${file}`] : [] };
        out.push(entry);
      }
    }
    for (const rec of this.fixtures.skinOutput) if (rec.type === 'all' || rec.type === 'skin_age') out.push({ ...rec });
    out.push({ type: 'resize_image', mask_urls: [] });
    return out;
  }

  async startFitzpatrick(source: TaskSource): Promise<string> {
    this.calls.push('startFitzpatrick');
    this.checkSource(source);
    const id = `mock-task-${randomUUID()}`;
    this.tasks.set(id, { kind: 'fitzpatrick', polls: 0, deleted: false, done: false });
    return id;
  }

  async pollFitzpatrick(taskId: string): Promise<TaskPoll<FitzpatrickResults>> {
    this.calls.push('pollFitzpatrick');
    return this.step(this.task(taskId, 'fitzpatrick'), () => ({ ...this.fixtures.fitzpatrick }));
  }

  async deleteTask(taskId: string): Promise<void> {
    this.calls.push('deleteTask');
    const t = this.tasks.get(taskId);
    if (!t || t.deleted) throw new YouCamApiError(400, 'InvalidTaskId', 'Invalid task ID');
    if (!t.done) throw new YouCamApiError(400, 'OperationInvalid', 'Task is not finished');
    t.deleted = true;
  }

  async getBalance(): Promise<number> {
    this.calls.push('getBalance');
    return this.fixtures.balance;
  }

  async getFeatureCosts(): Promise<FeatureCostSku[]> {
    this.calls.push('getFeatureCosts');
    return this.fixtures.skus.map((s) => ({ ...s }));
  }

  async fetchAsset(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    this.calls.push('fetchAsset');
    const m = /^mock:\/\/mask\/([^/]+)\/([a-z0-9_-]+\.png)$/.exec(url);
    const t = m ? this.tasks.get(m[1]!) : undefined;
    // Verified live: result URLs return 404 once the task is deleted.
    if (!m || !t || t.deleted) throw new YouCamApiError(404, 'error_download', 'Result download failed (HTTP 404)');
    const path = resolve(this.masksDir, m[2]!);
    if (!existsSync(path)) throw new YouCamApiError(404, 'error_download', 'Result download failed (HTTP 404)');
    // Seen live 2026-10-02: YouCam's storage serves masks as binary/octet-stream.
    return { bytes: new Uint8Array(readFileSync(path)), contentType: 'binary/octet-stream' };
  }
}
