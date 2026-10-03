/** Typed client for the Unstack server. Shapes come from shared/api.ts. */
import type {
  ApiErrorBody,
  ConsentRequest,
  ConsentResponse,
  JobCreated,
  JobStatus,
  LabelReadRequest,
  LabelReadResponse,
  SampleImage,
  ScanRequest,
  StatusResponse,
  SunProfileRequest,
} from '../../shared/api.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly advice: string | undefined;

  constructor(status: number, code: string, message: string, advice?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.advice = advice;
  }

  /** The server isn't there (network error, or something other than the Unstack API answered). */
  get unreachable(): boolean {
    return this.code === 'unreachable';
  }
}

function isErrorBody(v: unknown): v is ApiErrorBody {
  return typeof v === 'object' && v !== null && typeof (v as ApiErrorBody).error === 'string' && typeof (v as ApiErrorBody).code === 'string';
}

const UNREACHABLE = 'The Unstack server is not reachable. Start it with `npm run dev`, then try again.';

async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    const init: RequestInit = { method, headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    }
    if (signal) init.signal = signal;
    res = await fetch(path, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'unreachable', UNREACHABLE);
  }

  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  if (res.status === 204) return undefined as T;
  if (!isJson) {
    // A static dev server (or a proxy error page) answered instead of the API.
    throw new ApiError(res.status, 'unreachable', UNREACHABLE);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(res.status, 'bad-response', 'The server sent a response we could not read.');
  }
  if (!res.ok) {
    if (isErrorBody(data)) throw new ApiError(res.status, data.code, data.error, data.advice);
    throw new ApiError(res.status, `http-${res.status}`, `Request failed (${res.status}).`);
  }
  return data as T;
}

export const api = {
  status: (signal?: AbortSignal) => request<StatusResponse>('GET', '/api/status', undefined, signal),
  samples: (signal?: AbortSignal) => request<SampleImage[]>('GET', '/api/samples', undefined, signal),
  grantConsent: (body: ConsentRequest) => request<ConsentResponse>('POST', '/api/consent', body),
  withdrawConsent: (consentId: string) => request<unknown>('DELETE', `/api/consent/${encodeURIComponent(consentId)}`),
  createScan: (body: ScanRequest) => request<JobCreated>('POST', '/api/scans', body),
  createSunProfile: (body: SunProfileRequest) => request<JobCreated>('POST', '/api/sun-profile', body),
  job: (jobId: string, signal?: AbortSignal) => request<JobStatus>('GET', `/api/jobs/${encodeURIComponent(jobId)}`, undefined, signal),
  readLabel: (body: LabelReadRequest) => request<LabelReadResponse>('POST', '/api/label-read', body),
};

export function isTerminal(job: JobStatus): boolean {
  return job.stage === 'done' || job.stage === 'error';
}

/**
 * Poll a job every second until it is done or failed. Brief network blips are
 * tolerated (up to `maxMisses` in a row) so a slow Wi-Fi moment doesn't lose a
 * scan that the server is still processing.
 */
export async function pollJob(
  jobId: string,
  opts: { onUpdate?: (job: JobStatus) => void; signal?: AbortSignal; intervalMs?: number; maxMisses?: number } = {},
): Promise<JobStatus> {
  const interval = opts.intervalMs ?? 1000;
  const maxMisses = opts.maxMisses ?? 5;
  let misses = 0;
  for (;;) {
    if (opts.signal?.aborted) throw new DOMException('Polling stopped', 'AbortError');
    try {
      const job = await api.job(jobId, opts.signal);
      misses = 0;
      opts.onUpdate?.(job);
      if (isTerminal(job)) return job;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (err instanceof ApiError && !err.unreachable && err.status !== 0) throw err;
      misses++;
      if (misses > maxMisses) throw err;
    }
    await sleep(interval, opts.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Polling stopped', 'AbortError'));
      },
      { once: true },
    );
  });
}

export function errorMessage(err: unknown): { title: string; advice: string; code: string } {
  if (err instanceof ApiError) {
    if (err.unreachable) return { title: 'Server not reachable', advice: UNREACHABLE, code: err.code };
    return { title: err.message, advice: err.advice ?? '', code: err.code };
  }
  return { title: 'Something went wrong', advice: err instanceof Error ? err.message : 'Please try again.', code: 'unknown' };
}
