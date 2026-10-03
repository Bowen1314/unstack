import { randomUUID } from 'node:crypto';
import type { JobCreated, JobError, JobStage, JobStatus } from '../shared/api.ts';
import { fromDstAction, toDstActions } from '../shared/concerns.ts';
import type { CaptureMethod, Concern, ConcernScore, FitzpatrickScale, ScanQuality, ScanResult, SkinTypeReading, SunProfile } from '../shared/types.ts';
import { adviceFor } from '../shared/youcamErrors.ts';
import { HttpError } from './http.ts';
import { sniffType, toDataUrl, type DecodedImage } from './images.ts';
import type { Reservation, UnitLedger } from './ledger.ts';
import type { PriceBook } from './prices.ts';
import { type SkinOutputEntry, TaskFailedError, type TaskPoll, type TaskSource, YouCamApiError, type YouCamClient } from './youcam/types.ts';

/**
 * The scan pipeline. Every job runs the same steps against either client:
 *
 *   queued           units reserved; live price list and account balance re-checked
 *   uploading        POST /s2s/v2.0/file → PUT bytes to the presigned URL (or src_file_url for samples)
 *   analysing        run the task, poll with back-off
 *   copying-results  scores read, mask PNGs copied into the result as data URLs
 *   deleting         POST /s2s/v2.0/task/delete (task, input photo and outputs)
 *   done | error
 *
 * The photo is held only in this process's memory until the upload finishes.
 * Results stay in memory until the browser collects them (at most RESULT_TTL_MS).
 */

export const RESULT_TTL_MS = 10 * 60_000;
/** Seconds between polls. The live API finished SD skin analysis in about 6 s (§12). */
export const POLL_DELAYS_MS = [1500, 2000, 2500, 3500, 5000];
export const TASK_TIMEOUT_MS = 180_000;
const MASK_CONCURRENCY = 4;

export type PhotoSource = { kind: 'sample'; url: string } | { kind: 'upload'; image: DecodedImage };

export interface ScanInput {
  photo: PhotoSource;
  concerns: Concern[];
  quality: ScanQuality;
  captureMethod: CaptureMethod;
}

export interface JobDeps {
  client: YouCamClient;
  ledger: UnitLedger;
  prices: PriceBook;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollDelaysMs?: number[];
  taskTimeoutMs?: number;
  /** Called with every account balance read (feeds /api/status). */
  onBalance?: (units: number) => void;
  /** Called on every stage transition. */
  onStage?: (jobId: string, stage: JobStage) => void;
  log?: (line: string) => void;
}

interface Job {
  status: JobStatus;
  reservation: Reservation;
  charged: boolean;
  photo: PhotoSource | null;
}

/** Normalise skin-analysis `output` (format=json) into a ScanResult body. `masks` maps entry index → data URL. */
export function normaliseSkinOutput(output: SkinOutputEntry[], masks: Map<number, string>): Pick<ScanResult, 'scores' | 'skinType' | 'skinAge' | 'overall'> {
  const scores: ConcernScore[] = [];
  const skinType: SkinTypeReading[] = [];
  let skinAge: number | null = null;
  let overall: number | null = null;
  output.forEach((e, i) => {
    if (e.type === 'skin_age' && typeof e.score === 'number') skinAge = e.score;
    else if (e.type === 'all' && typeof e.score === 'number') overall = e.score;
    else {
      const concern = fromDstAction(e.type);
      if (!concern) return;
      if (concern === 'skin_type') {
        if (typeof e.skin_type === 'string') skinType.push({ region: e.region ?? 'whole', value: e.skin_type, mask: masks.get(i) ?? null });
      } else if (typeof e.raw_score === 'number') {
        scores.push({ concern, region: e.region ?? 'whole', raw: e.raw_score, ui: typeof e.ui_score === 'number' ? e.ui_score : Math.round(e.raw_score), mask: masks.get(i) ?? null });
      }
    }
  });
  return { scores, skinType, skinAge, overall };
}

const SCALES: readonly FitzpatrickScale[] = ['I', 'II', 'III', 'IV', 'V', 'VI'];

export function jobErrorFrom(err: unknown): JobError {
  if (err instanceof HttpError) return { code: err.code, title: err.message, advice: err.advice ?? 'Please try again.', retake: false };
  if (err instanceof YouCamApiError) {
    const a = adviceFor(err.code);
    return { code: err.code, title: a.title, advice: a.advice, retake: a.retake };
  }
  const a = adviceFor(null);
  return { code: 'internal', title: a.title, advice: a.advice, retake: false };
}

export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly delays: number[];
  private readonly timeoutMs: number;
  private readonly log: (line: string) => void;

  constructor(private readonly deps: JobDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? Date.now;
    this.delays = deps.pollDelaysMs ?? POLL_DELAYS_MS;
    this.timeoutMs = deps.taskTimeoutMs ?? TASK_TIMEOUT_MS;
    this.log = deps.log ?? (() => undefined);
  }

  get(id: string): JobStatus | undefined {
    return this.jobs.get(id)?.status;
  }

  /** Jobs that have not finished yet. */
  get running(): number {
    let n = 0;
    for (const j of this.jobs.values()) if (j.status.stage !== 'done' && j.status.stage !== 'error') n++;
    return n;
  }

  /** Start a skin scan. The caller has already reserved `reservation` on the ledger. */
  startScan(input: ScanInput, reservation: Reservation): JobCreated {
    const job = this.create('scan', reservation, input.photo);
    void this.runScan(job, input).catch((err: unknown) => this.fail(job, err));
    return { jobId: job.status.id, unitsReserved: reservation.units };
  }

  startSunProfile(photo: PhotoSource, reservation: Reservation): JobCreated {
    const job = this.create('sun-profile', reservation, photo);
    void this.runSunProfile(job).catch((err: unknown) => this.fail(job, err));
    return { jobId: job.status.id, unitsReserved: reservation.units };
  }

  private create(kind: JobStatus['kind'], reservation: Reservation, photo: PhotoSource): Job {
    const status: JobStatus = {
      id: randomUUID(),
      kind,
      stage: 'queued',
      message: `Holding ${reservation.units} units against the ledger cap.`,
      startedAt: new Date(this.now()).toISOString(),
      unitsReserved: reservation.units,
      unitsCharged: 0,
    };
    const job: Job = { status, reservation, charged: false, photo };
    this.jobs.set(status.id, job);
    return job;
  }

  /** Every status change goes through here, so stage transitions can be observed (onStage). */
  private update(job: Job, patch: Partial<JobStatus>): void {
    const before = job.status.stage;
    job.status = { ...job.status, ...patch };
    if (job.status.stage !== before) this.deps.onStage?.(job.status.id, job.status.stage);
  }

  private stage(job: Job, stage: JobStage, message: string): void {
    this.update(job, { stage, message });
  }

  private finish(job: Job): void {
    const t = setTimeout(() => this.jobs.delete(job.status.id), RESULT_TTL_MS);
    t.unref?.();
  }

  private fail(job: Job, err: unknown): void {
    job.photo = null;
    if (!job.charged) this.deps.ledger.release(job.reservation, 'task did not succeed');
    const error = jobErrorFrom(err);
    this.log(`job ${job.status.id.slice(0, 8)} ${job.status.kind} failed at ${job.status.stage}: ${error.code}`);
    this.update(job, { stage: 'error', message: error.title, error, unitsReserved: job.charged ? job.status.unitsReserved : 0 });
    this.finish(job);
  }

  /** Re-check the live price list and the account balance before the paid call. */
  private async preflight(job: Job, unitsFor: () => number): Promise<number | undefined> {
    const { client, prices, ledger } = this.deps;
    try {
      await prices.refresh(client);
    } catch {
      // Keep the documented prices; they are what the reservation already used.
    }
    const units = unitsFor();
    if (units > job.reservation.units) {
      job.reservation = ledger.raise(job.reservation, units);
      this.update(job, { unitsReserved: units, message: `The live price list says ${units} units; holding that instead.` });
    }
    let balance: number | undefined;
    try {
      balance = await client.getBalance();
      this.deps.onBalance?.(balance);
    } catch (err) {
      if (err instanceof YouCamApiError && err.code === 'InvalidAccessToken') throw err;
      balance = undefined; // unknown balance: the ledger cap still applies
    }
    if (balance !== undefined && balance < job.reservation.units) {
      throw new YouCamApiError(402, 'CreditInsufficiency', `The YouCam account has ${balance} units; this needs ${job.reservation.units}.`);
    }
    return balance;
  }

  private async upload(job: Job, photo: PhotoSource): Promise<TaskSource> {
    if (photo.kind === 'sample') {
      this.stage(job, 'uploading', 'Pointing YouCam at its own public sample image (src_file_url).');
      return { url: photo.url };
    }
    const { client } = this.deps;
    const { image } = photo;
    this.stage(job, 'uploading', `Uploading ${Math.round(image.bytes.byteLength / 1024)} KB to YouCam storage.`);
    const ext = image.contentType === 'image/png' ? 'png' : 'jpg';
    const slot = await client.createUpload({ contentType: image.contentType, fileName: `unstack-photo.${ext}`, size: image.bytes.byteLength });
    await client.putUpload(slot, image.bytes);
    job.photo = null; // the bytes are at YouCam now; drop our copy
    return { fileId: slot.fileId };
  }

  private async pollUntilDone<R>(job: Job, poll: () => Promise<TaskPoll<R>>): Promise<R> {
    const started = this.now();
    for (let i = 0; ; i++) {
      await this.sleep(this.delays[Math.min(i, this.delays.length - 1)]!);
      const r = await poll();
      if (r.state === 'success' && r.results !== null) return r.results;
      if (r.state === 'error') throw new TaskFailedError(r.errorCode ?? 'unknown_internal_error', r.errorMessage ?? 'Task failed');
      if (this.now() - started > this.timeoutMs) throw new YouCamApiError(504, 'PollTimeout', 'Task did not finish in time');
      this.update(job, { message: `YouCam is working on it (check ${i + 1}).` });
    }
  }

  private charge(job: Job, balanceBefore: number | undefined, note?: string): void {
    this.deps.ledger.charge(job.reservation, { ...(balanceBefore === undefined ? {} : { balanceBefore }), ...(note ? { note } : {}) });
    job.charged = true;
    this.update(job, { unitsCharged: job.reservation.units });
  }

  /**
   * Polling stopped without YouCam reporting an outcome (network error or our
   * timeout). The task may still succeed and be billed, so the ledger keeps
   * the units as spent. Only a task that YouCam reports as failed is refunded.
   */
  private async settleFailedTask(job: Job, taskId: string, err: unknown, balanceBefore: number | undefined): Promise<void> {
    const reportedByYouCam = err instanceof TaskFailedError || (err instanceof YouCamApiError && (err.code === 'TaskTimeout' || err.code === 'InvalidTaskId'));
    if (!reportedByYouCam) this.charge(job, balanceBefore, 'outcome unknown (polling stopped); counted as spent');
    await this.deleteRemote(taskId); // a finished task's files are removed even when it failed
  }

  /** Run a task. If the run request got no answer, YouCam may still have started it, so count it as spent. */
  private async startTask(job: Job, start: () => Promise<string>, balanceBefore: number | undefined): Promise<string> {
    try {
      return await start();
    } catch (err) {
      if (err instanceof YouCamApiError && err.code === 'YouCamUnreachable') this.charge(job, balanceBefore, 'outcome unknown (no answer to the run request); counted as spent');
      throw err;
    }
  }

  /** Delete the task at YouCam. Returns false (never throws) if YouCam didn't confirm. */
  private async deleteRemote(taskId: string): Promise<boolean> {
    try {
      await this.deps.client.deleteTask(taskId);
      return true;
    } catch (err) {
      this.log(`task/delete failed: ${err instanceof YouCamApiError ? err.code : 'error'}`);
      return false;
    }
  }

  private async afterCharge(job: Job): Promise<void> {
    try {
      const balance = await this.deps.client.getBalance();
      this.deps.onBalance?.(balance);
      this.deps.ledger.noteBalanceAfter(job.reservation, balance);
    } catch {
      // audit detail only
    }
  }

  private async runScan(job: Job, input: ScanInput): Promise<void> {
    const { client, prices } = this.deps;
    const balanceBefore = await this.preflight(job, () => prices.skinUnits(input.concerns.length, input.quality));
    const source = await this.upload(job, input.photo);

    this.stage(job, 'analysing', 'YouCam is analysing the photo.');
    const dstActions = toDstActions(input.concerns, input.quality);
    const taskId = await this.startTask(job, () => client.startSkinAnalysis({ source, dstActions, cameraKit: input.captureMethod === 'camera-kit' }), balanceBefore);
    let output: SkinOutputEntry[];
    try {
      output = (await this.pollUntilDone(job, () => client.pollSkinAnalysis(taskId))).output;
    } catch (err) {
      await this.settleFailedTask(job, taskId, err, balanceBefore);
      throw err;
    }
    this.charge(job, balanceBefore);

    const withMasks = output.map((e, i) => ({ e, i })).filter(({ e }) => e.type !== 'resize_image' && typeof e.mask_urls?.[0] === 'string');
    this.stage(job, 'copying-results', withMasks.length > 0 ? `Copying ${withMasks.length} mask images before YouCam's links expire.` : 'Reading the scores.');
    const masks = new Map<number, string>();
    let failedMasks = 0;
    for (let k = 0; k < withMasks.length; k += MASK_CONCURRENCY) {
      await Promise.all(
        withMasks.slice(k, k + MASK_CONCURRENCY).map(async ({ e, i }) => {
          try {
            const asset = await client.fetchAsset(e.mask_urls![0]!);
            // YouCam's storage labels masks binary/octet-stream; label them by their bytes instead.
            const type = sniffType(asset.bytes);
            if (!type) throw new Error('mask is not an image');
            masks.set(i, toDataUrl(asset.bytes, type));
          } catch {
            failedMasks++;
          }
        }),
      );
    }

    this.stage(job, 'deleting', 'Asking YouCam to delete the task, the photo and the outputs.');
    const remoteDeleted = await this.deleteRemote(taskId);

    const result: ScanResult = {
      id: randomUUID(),
      takenAt: new Date(this.now()).toISOString(),
      quality: input.quality,
      captureMethod: input.captureMethod,
      concerns: [...new Set(input.concerns)],
      ...normaliseSkinOutput(output, masks),
      unitsCharged: job.reservation.units,
      mode: client.mode,
      remoteDeleted,
    };
    const note = failedMasks > 0 ? ` ${failedMasks} mask image(s) could not be copied.` : '';
    this.update(job, { stage: 'done', message: `${remoteDeleted ? 'Done. Deleted at YouCam.' : 'Done, but YouCam did not confirm the deletion.'}${note}`, result });
    this.finish(job);
    await this.afterCharge(job);
  }

  private async runSunProfile(job: Job): Promise<void> {
    const { client, prices } = this.deps;
    const photo = job.photo;
    if (!photo) throw new Error('photo missing');
    const balanceBefore = await this.preflight(job, () => prices.fitzpatrickUnits());
    const source = await this.upload(job, photo);

    this.stage(job, 'analysing', 'YouCam is reading the Fitzpatrick type.');
    const taskId = await this.startTask(job, () => client.startFitzpatrick(source), balanceBefore);
    let scale: string;
    try {
      scale = (await this.pollUntilDone(job, () => client.pollFitzpatrick(taskId))).fitzpatrick_scale;
    } catch (err) {
      await this.settleFailedTask(job, taskId, err, balanceBefore);
      throw err;
    }
    this.charge(job, balanceBefore);
    this.stage(job, 'copying-results', 'Reading the result.');
    this.stage(job, 'deleting', 'Asking YouCam to delete the task and the photo.');
    const remoteDeleted = await this.deleteRemote(taskId);
    if (!(SCALES as readonly string[]).includes(scale)) throw new YouCamApiError(502, 'BadResultShape', `Unexpected Fitzpatrick scale ${scale}`);
    const result: SunProfile = { scale: scale as FitzpatrickScale, source: 'youcam', updatedAt: new Date(this.now()).toISOString() };
    this.update(job, { stage: 'done', message: remoteDeleted ? 'Done. Deleted at YouCam.' : 'Done, but YouCam did not confirm the deletion.', result });
    this.finish(job);
    await this.afterCharge(job);
  }
}
