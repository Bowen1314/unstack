import { describe, expect, it } from 'vitest';
import type { JobStatus } from '../shared/api.ts';
import type { ScanResult, SunProfile } from '../shared/types.ts';
import { decodeImage } from '../server/images.ts';
import { JobManager, normaliseSkinOutput, type ScanInput } from '../server/jobs.ts';
import { UnitLedger } from '../server/ledger.ts';
import { PriceBook } from '../server/prices.ts';
import { findSample } from '../server/samples.ts';
import type { MockYouCamClient } from '../server/youcam/mockClient.ts';
import { YouCamApiError } from '../server/youcam/types.ts';
import { dataUrl, fakeClock, HAS_MASKS, jpegBytes, mockClient } from './support.ts';

const transitions = new Map<string, string[]>();

function setup(client: MockYouCamClient = mockClient(), cap = 60, extra: { taskTimeoutMs?: number } = {}) {
  const clock = fakeClock();
  const ledger = new UnitLedger(null, cap);
  const prices = new PriceBook();
  const balances: number[] = [];
  const jobs = new JobManager({
    client,
    ledger,
    prices,
    sleep: clock.sleep,
    now: clock.now,
    onBalance: (b) => balances.push(b),
    onStage: (id, stage) => transitions.set(id, [...(transitions.get(id) ?? ['queued']), stage]),
    ...extra,
  });
  return { client, ledger, prices, jobs, balances };
}

/** Wait for a job to end; `stages` is every stage it went through, in order. */
async function run(jobs: JobManager, jobId: string): Promise<{ final: JobStatus; stages: string[] }> {
  for (let i = 0; i < 500; i++) {
    const s = jobs.get(jobId)!;
    if (s.stage === 'done' || s.stage === 'error') return { final: s, stages: transitions.get(jobId) ?? ['queued'] };
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('job stuck');
}

const sampleScan = (concerns: ScanInput['concerns'] = ['pore', 'redness', 'moisture', 'skin_type']): ScanInput => ({
  photo: { kind: 'sample', url: findSample('yc-skin-01')!.url },
  concerns,
  quality: 'sd',
  captureMethod: 'sample',
});

describe('scan pipeline (mock client)', () => {
  it('runs every stage, copies masks, deletes the task and charges the reservation', async () => {
    const { jobs, ledger, client } = setup();
    const res = ledger.reserve('skin-analysis v2.1 SD x4', 9);
    const { jobId, unitsReserved } = jobs.startScan(sampleScan(), res);
    expect(unitsReserved).toBe(9);
    const { final, stages } = await run(jobs, jobId);
    expect(final.error).toBeUndefined();
    expect(stages).toEqual(['queued', 'uploading', 'analysing', 'copying-results', 'deleting', 'done']);
    const r = final.result as ScanResult;
    expect(r.mode).toBe('mock');
    expect(r.remoteDeleted).toBe(true);
    expect(r.unitsCharged).toBe(9);
    expect(r.scores.map((s) => s.concern).sort()).toEqual(['moisture', 'pore', 'redness']);
    expect(r.scores.find((s) => s.concern === 'pore')).toMatchObject({ region: 'whole', ui: 79 });
    expect(r.skinType.map((t) => `${t.region}:${t.value}`)).toEqual(['whole:Oily', 't_zone:Oily', 'u_zone:Oily']);
    expect(r.skinAge).toBe(52);
    expect(r.overall).toBeCloseTo(75.13, 1);
    if (HAS_MASKS) expect(r.scores.every((s) => s.mask?.startsWith('data:image/png;base64,'))).toBe(true);
    expect(ledger.snapshot()).toMatchObject({ used: 9, reserved: 0 });
    // Free checks first, then the paid task, and task/delete after the masks were copied.
    expect(client.calls.slice(0, 3)).toEqual(['getFeatureCosts', 'getBalance', 'startSkinAnalysis']);
    const del = client.calls.lastIndexOf('deleteTask');
    expect(del).toBeGreaterThan(client.calls.lastIndexOf('fetchAsset'));
  });

  it('uploads a browser photo through the File API and keeps no copy', async () => {
    const { jobs, ledger, client } = setup();
    const image = decodeImage({ dataUrl: dataUrl(jpegBytes(1080, 1440, 4096), 'image/jpeg') });
    const { jobId } = jobs.startScan({ photo: { kind: 'upload', image }, concerns: ['texture'], quality: 'hd', captureMethod: 'camera-kit' }, ledger.reserve('x', 12));
    const { final } = await run(jobs, jobId);
    const r = final.result as ScanResult;
    expect(client.calls).toContain('createUpload');
    expect(client.calls).toContain('putUpload');
    expect(r.captureMethod).toBe('camera-kit');
    expect(r.scores).toEqual([expect.objectContaining({ concern: 'texture', mask: null })]);
  });

  it('a failed task refunds the units, deletes the task and maps the error to retake advice', async () => {
    const { jobs, ledger, client } = setup(mockClient({ failWith: 'error_src_face_too_small' }));
    const { jobId } = jobs.startScan(sampleScan(), ledger.reserve('x', 9));
    const { final } = await run(jobs, jobId);
    expect(final.stage).toBe('error');
    expect(final.error).toMatchObject({ code: 'error_src_face_too_small', title: 'Face too small', retake: true });
    expect(final.unitsCharged).toBe(0);
    expect(ledger.snapshot()).toMatchObject({ used: 0, reserved: 0 });
    expect(client.calls).toContain('deleteTask');
  });

  it('raises the reservation when the live price list is higher', async () => {
    const client = mockClient();
    const skus = await client.getFeatureCosts();
    client.getFeatureCosts = async () => skus.map((s) => (s.description === 'AI Skin Analysis V2.1 SD (1-4 concerns)' ? { ...s, amount: 11 } : s));
    const { jobs, ledger } = setup(client);
    const { jobId } = jobs.startScan(sampleScan(), ledger.reserve('x', 9));
    const { final } = await run(jobs, jobId);
    expect(final.unitsCharged).toBe(11);
    expect(ledger.snapshot().used).toBe(11);
  });

  it('refuses before the paid call if the higher live price would break the cap', async () => {
    const client = mockClient();
    client.getFeatureCosts = async () => [{ description: 'AI Skin Analysis V2.1 SD (1-4 concerns)', amount: 50, unit: 'result_image', proc_unit: 1, run_task_url: 'https://yce-api-01.makeupar.com/s2s/v2.1/task/skin-analysis' }];
    const { jobs, ledger } = setup(client, 20);
    const { jobId } = jobs.startScan(sampleScan(), ledger.reserve('x', 9));
    const { final } = await run(jobs, jobId);
    expect(final.error?.code).toBe('unit-cap-reached');
    expect(client.calls).not.toContain('startSkinAnalysis');
    expect(ledger.snapshot()).toMatchObject({ used: 0, reserved: 0 });
  });

  it('refuses before the paid call if the account balance is too low', async () => {
    const client = mockClient();
    client.getBalance = async () => 5;
    const { jobs, ledger, balances } = setup(client);
    const { jobId } = jobs.startScan(sampleScan(), ledger.reserve('x', 9));
    const { final } = await run(jobs, jobId);
    expect(final.error?.code).toBe('CreditInsufficiency');
    expect(balances).toEqual([5]);
    expect(client.calls).not.toContain('startSkinAnalysis');
    expect(ledger.snapshot().used).toBe(0);
  });

  it('when polling gives up, the units stay counted as spent', async () => {
    const { jobs, ledger } = setup(mockClient({ runningPolls: 1000 }), 60, { taskTimeoutMs: 20_000 });
    const { jobId } = jobs.startScan(sampleScan(), ledger.reserve('x', 9));
    const { final } = await run(jobs, jobId);
    expect(final.error?.code).toBe('PollTimeout');
    expect(ledger.snapshot().used).toBe(9);
    expect(ledger.list()[0]!.note).toMatch(/outcome unknown/);
  });

  it('when the run request gets no answer, the units stay counted as spent', async () => {
    const client = mockClient();
    client.startSkinAnalysis = async () => {
      throw new YouCamApiError(503, 'YouCamUnreachable', 'YouCam did not answer');
    };
    const { jobs, ledger } = setup(client);
    const { final } = await run(jobs, jobs.startScan(sampleScan(), ledger.reserve('x', 9)).jobId);
    expect(final.error?.code).toBe('YouCamUnreachable');
    expect(ledger.snapshot().used).toBe(9);
  });

  it('a failed upload is refunded', async () => {
    const client = mockClient();
    client.putUpload = async () => {
      throw new YouCamApiError(403, 'error_upload', 'Upload failed');
    };
    const { jobs, ledger } = setup(client);
    const image = decodeImage({ dataUrl: dataUrl(jpegBytes(600, 800), 'image/jpeg') });
    const { final } = await run(jobs, jobs.startScan({ photo: { kind: 'upload', image }, concerns: ['pore'], quality: 'sd', captureMethod: 'upload' }, ledger.reserve('x', 9)).jobId);
    expect(final.error?.code).toBe('error_upload');
    expect(ledger.snapshot().used).toBe(0);
  });

  it('runs a sun profile through Fitzpatrick and deletes it', async () => {
    const { jobs, ledger, client } = setup();
    const { jobId } = jobs.startSunProfile({ kind: 'sample', url: findSample('yc-sample-1')!.url }, ledger.reserve('fitzpatrick v1.0', 10));
    const { final, stages } = await run(jobs, jobId);
    expect(stages.at(-1)).toBe('done');
    expect(final.result as SunProfile).toMatchObject({ scale: 'I', source: 'youcam' });
    expect(client.calls).toContain('deleteTask');
    expect(ledger.snapshot().used).toBe(10);
  });
});

describe('normaliseSkinOutput', () => {
  it('handles HD regional entries and ignores types it does not model', () => {
    const r = normaliseSkinOutput(
      [
        { type: 'hd_pore', region: 'nose', raw_score: 45.7, ui_score: 46, mask_urls: ['x'] },
        { type: 'hd_pore', region: 'whole', raw_score: 60, ui_score: 66 },
        { type: 'hd_dark_circle', raw_score: 70.2 },
        { type: 'hd_skin_type', region: 't_zone', skin_type: 'Oily' },
        { type: 'resize_image', mask_urls: ['y'] },
        { type: 'something_new', raw_score: 1 },
      ],
      new Map([[0, 'data:image/png;base64,AA']]),
    );
    expect(r.scores).toEqual([
      { concern: 'pore', region: 'nose', raw: 45.7, ui: 46, mask: 'data:image/png;base64,AA' },
      { concern: 'pore', region: 'whole', raw: 60, ui: 66, mask: null },
      { concern: 'dark_circle', region: 'whole', raw: 70.2, ui: 70, mask: null },
    ]);
    expect(r.skinType).toEqual([{ region: 't_zone', value: 'Oily', mask: null }]);
    expect(r.skinAge).toBeNull();
    expect(r.overall).toBeNull();
  });
});
