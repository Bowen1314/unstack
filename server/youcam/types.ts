/**
 * The YouCam client interface. Two implementations follow the same documented
 * wire shapes: HttpYouCamClient (real API) and MockYouCamClient (fixtures).
 * See docs/API_NOTES.md for every endpoint and its source URL.
 */

export type TaskSource = { fileId: string } | { url: string };

export interface UploadSlot {
  fileId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
}

export type TaskState = 'running' | 'success' | 'error';

export interface TaskPoll<R> {
  state: TaskState;
  results: R | null;
  errorCode: string | null;
  errorMessage: string | null;
}

/** One entry of skin-analysis `data.results.output` (format=json). */
export interface SkinOutputEntry {
  type: string;
  region?: string;
  raw_score?: number;
  ui_score?: number;
  score?: number;
  skin_type?: string;
  mask_urls?: string[];
}

export interface SkinAnalysisResults {
  output: SkinOutputEntry[];
}

export interface FitzpatrickResults {
  fitzpatrick_scale: string;
  timed?: number;
}

export interface FeatureCostSku {
  description: string;
  amount: number;
  unit: string;
  proc_unit: number;
  run_task_url: string;
}

export interface SkinAnalysisRequest {
  source: TaskSource;
  dstActions: string[];
  cameraKit: boolean;
}

export interface YouCamClient {
  readonly mode: 'mock' | 'live';
  createUpload(file: { contentType: string; fileName: string; size: number }): Promise<UploadSlot>;
  putUpload(slot: UploadSlot, bytes: Uint8Array): Promise<void>;
  startSkinAnalysis(req: SkinAnalysisRequest): Promise<string>;
  pollSkinAnalysis(taskId: string): Promise<TaskPoll<SkinAnalysisResults>>;
  startFitzpatrick(source: TaskSource): Promise<string>;
  pollFitzpatrick(taskId: string): Promise<TaskPoll<FitzpatrickResults>>;
  deleteTask(taskId: string): Promise<void>;
  getBalance(): Promise<number>;
  getFeatureCosts(): Promise<FeatureCostSku[]>;
  fetchAsset(url: string): Promise<{ bytes: Uint8Array; contentType: string }>;
}

export class YouCamApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'YouCamApiError';
  }
}

/** The task itself ended in task_status "error". YouCam does not charge for these. */
export class TaskFailedError extends YouCamApiError {
  constructor(code: string, message: string) {
    super(422, code, message);
    this.name = 'TaskFailedError';
  }
}
