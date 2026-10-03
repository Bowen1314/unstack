/**
 * The one active YouCam job (a skin scan or a sun profile). It lives outside
 * React so a scan keeps going if the user switches screens; when it finishes,
 * the result is saved here (localStorage + IndexedDB), not in a component.
 */
import { useSyncExternalStore } from 'react';
import type { JobError, JobStage, JobStatus, ScanRequest, SunProfileRequest } from '../../../../shared/api.ts';
import type { ScanResult, SunProfile } from '../../../../shared/types.ts';
import { adviceFor } from '../../../../shared/youcamErrors.ts';
import { api, ApiError, pollJob } from '../../api.ts';
import { putScanMedia } from '../../idb.ts';
import { THUMB_MAX_LONG_SIDE, toJpeg } from '../../image.ts';
import { extractMasks, stripMasks, type MaskMap } from '../../scanMedia.ts';
import { refreshStatus } from '../../serverStatus.ts';
import { dispatch, getState } from '../../store.ts';
import { photoSrc, type PhotoChoice } from './photo.ts';

export interface ActiveJob {
  jobId: string;
  kind: 'scan' | 'sun-profile';
  status: JobStatus | null;
  /** Last non-error stage, so the stepper can show where a failure happened. */
  lastStage: JobStage;
  photo: PhotoChoice;
  experimentId: string | null;
  unitsReserved: number;
  error: JobError | null;
  resultId: string | null;
  startedAt: number;
}

let active: ActiveJob | null = null;
const listeners = new Set<() => void>();
let controller: AbortController | null = null;

/** Full-resolution photo + masks for scans finished in this session (thumbnails live in IndexedDB). */
export const liveMedia = new Map<string, { photo: string; masks: MaskMap }>();

function set(next: ActiveJob | null): void {
  active = next;
  for (const l of listeners) l();
}

function patch(p: Partial<ActiveJob>): void {
  if (active) set({ ...active, ...p });
}

export function useActiveJob(): ActiveJob | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => active,
    () => null,
  );
}

export function dismissJob(): void {
  controller?.abort();
  controller = null;
  set(null);
}

function isScanResult(r: unknown): r is ScanResult {
  return typeof r === 'object' && r !== null && Array.isArray((r as ScanResult).scores);
}

function isSunProfile(r: unknown): r is SunProfile {
  return typeof r === 'object' && r !== null && 'scale' in r && 'source' in r;
}

async function saveScan(result: ScanResult, photo: PhotoChoice, experimentId: string | null): Promise<void> {
  const masks = extractMasks(result);
  let thumb: string | null = null;
  if (photo.kind === 'sample') thumb = photo.sample.url;
  else {
    try {
      thumb = (await toJpeg(photo.dataUrl, THUMB_MAX_LONG_SIDE, 0.82)).dataUrl;
    } catch {
      thumb = null;
    }
  }
  await putScanMedia({ id: result.id, thumb, masks });
  liveMedia.set(result.id, { photo: photoSrc(photo), masks });
  // Only attach if that experiment is still running.
  const exp = experimentId ? getState().experiments.find((e) => e.id === experimentId && e.status === 'running') : undefined;
  dispatch({ type: 'scan/add', scan: stripMasks(result), experimentId: exp ? exp.id : null });
}

function failFrom(status: JobStatus | null, fallbackCode: string): JobError {
  if (status?.error) return status.error;
  const a = adviceFor(fallbackCode);
  return { code: fallbackCode, title: a.title, advice: a.advice, retake: a.retake };
}

async function follow(jobId: string): Promise<void> {
  controller?.abort();
  const ctrl = new AbortController();
  controller = ctrl;
  try {
    const final = await pollJob(jobId, {
      signal: ctrl.signal,
      onUpdate: (status) => {
        if (!active || active.jobId !== jobId) return;
        patch({ status, lastStage: status.stage === 'error' ? active.lastStage : status.stage, unitsReserved: status.unitsReserved });
      },
    });
    if (!active || active.jobId !== jobId) return;
    if (final.stage === 'error') {
      patch({ error: failFrom(final, final.error?.code ?? 'unknown') });
    } else if (active.kind === 'scan' && isScanResult(final.result)) {
      await saveScan(final.result, active.photo, active.experimentId);
      patch({ resultId: final.result.id });
    } else if (active.kind === 'sun-profile' && isSunProfile(final.result)) {
      dispatch({ type: 'sun/set', profile: final.result });
      patch({ resultId: 'sun' });
    } else {
      patch({ error: { code: 'bad-result', title: 'Unexpected result', advice: 'The server finished the job but sent a result we could not read.', retake: false } });
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    if (!active || active.jobId !== jobId) return;
    const unreachable = err instanceof ApiError && err.unreachable;
    patch({
      error: {
        code: unreachable ? 'unreachable' : 'poll-failed',
        title: unreachable ? 'Lost contact with the server' : 'Could not follow the scan',
        advice: unreachable ? 'The Unstack server stopped answering. Your photo was only ever held in its memory.' : err instanceof Error ? err.message : 'Please try again.',
        retake: false,
      },
    });
  } finally {
    if (controller === ctrl) controller = null;
    void refreshStatus();
  }
}

/** Create a scan job. Throws ApiError if the server refuses (consent, ledger cap, rate limit). */
export async function startScan(req: ScanRequest, photo: PhotoChoice, experimentId: string | null): Promise<void> {
  const created = await api.createScan(req);
  set({
    jobId: created.jobId,
    kind: 'scan',
    status: null,
    lastStage: 'queued',
    photo,
    experimentId,
    unitsReserved: created.unitsReserved,
    error: null,
    resultId: null,
    startedAt: Date.now(),
  });
  void refreshStatus();
  void follow(created.jobId);
}

export async function startSunProfile(req: SunProfileRequest, photo: PhotoChoice): Promise<void> {
  const created = await api.createSunProfile(req);
  set({
    jobId: created.jobId,
    kind: 'sun-profile',
    status: null,
    lastStage: 'queued',
    photo,
    experimentId: null,
    unitsReserved: created.unitsReserved,
    error: null,
    resultId: null,
    startedAt: Date.now(),
  });
  void refreshStatus();
  void follow(created.jobId);
}

/** True when the server rejected a request because consent is missing or outdated. */
export function isConsentError(err: unknown): boolean {
  return err instanceof ApiError && /consent/i.test(err.code);
}
