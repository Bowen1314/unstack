import { describe, expect, it } from 'vitest';
import { findSample } from '../server/samples.ts';
import { YouCamApiError } from '../server/youcam/types.ts';
import { HAS_MASKS, mockClient } from './support.ts';

const SAMPLE_A = findSample('yc-skin-01')!.url;

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof YouCamApiError) return e.code;
    throw e;
  }
  return 'no error';
}

describe('MockYouCamClient (recorded fixtures)', () => {
  it('loads the recorded skin-analysis output', () => {
    expect(mockClient().hasFixtures).toBe(true);
  });

  it('replays recorded scores for the requested concerns, with running polls first', async () => {
    const c = mockClient({ runningPolls: 2 });
    const id = await c.startSkinAnalysis({ source: { url: SAMPLE_A }, dstActions: ['pore', 'redness', 'skin_type'], cameraKit: false });
    expect((await c.pollSkinAnalysis(id)).state).toBe('running');
    expect((await c.pollSkinAnalysis(id)).state).toBe('running');
    const done = await c.pollSkinAnalysis(id);
    expect(done.state).toBe('success');
    const out = done.results!.output;
    expect(out.find((e) => e.type === 'pore')).toMatchObject({ ui_score: 79 });
    expect(out.filter((e) => e.type === 'skin_type').map((e) => e.region)).toEqual(['whole', 't_zone', 'u_zone']);
    expect(out.find((e) => e.type === 'all')?.score).toBeCloseTo(75.13, 1);
    expect(out.find((e) => e.type === 'skin_age')?.score).toBe(52);
    expect(out.some((e) => e.type === 'wrinkle')).toBe(false);
  });

  it.skipIf(!HAS_MASKS)('serves real masks only for the yc-skin-01 sample, and not after delete', async () => {
    const c = mockClient();
    const id = await c.startSkinAnalysis({ source: { url: SAMPLE_A }, dstActions: ['pore'], cameraKit: false });
    await c.pollSkinAnalysis(id);
    const out = (await c.pollSkinAnalysis(id)).results!.output;
    const url = out.find((e) => e.type === 'pore')!.mask_urls![0]!;
    const asset = await c.fetchAsset(url);
    expect(asset.contentType).toBe('binary/octet-stream'); // as YouCam's storage serves it
    expect(asset.bytes[1]).toBe(0x50); // "P" of the PNG signature
    await c.deleteTask(id);
    expect(await codeOf(c.fetchAsset(url))).toBe('error_download');
    expect(await codeOf(c.pollSkinAnalysis(id))).toBe('InvalidTaskId');
  });

  it('gives uploaded photos no masks (the masks belong to the sample face)', async () => {
    const c = mockClient();
    const slot = await c.createUpload({ contentType: 'image/jpeg', fileName: 'a.jpg', size: 4 });
    await c.putUpload(slot, new Uint8Array(4));
    const id = await c.startSkinAnalysis({ source: { fileId: slot.fileId }, dstActions: ['pore'], cameraKit: true });
    await c.pollSkinAnalysis(id);
    const out = (await c.pollSkinAnalysis(id)).results!.output;
    expect(out.find((e) => e.type === 'pore')!.mask_urls).toEqual([]);
  });

  it('enforces the rules the live API enforced', async () => {
    const c = mockClient();
    expect(await codeOf(c.startSkinAnalysis({ source: { url: SAMPLE_A }, dstActions: ['pore', 'hd_wrinkle'], cameraKit: false }))).toBe('InvalidParameters');
    expect(await codeOf(c.startSkinAnalysis({ source: { url: SAMPLE_A }, dstActions: ['abc123'], cameraKit: false }))).toBe('InvalidParameters');
    const slot = await c.createUpload({ contentType: 'image/png', fileName: 'a.png', size: 10 });
    expect(await codeOf(c.putUpload(slot, new Uint8Array(9)))).toBe('error_upload');
    expect(await codeOf(c.startSkinAnalysis({ source: { fileId: slot.fileId }, dstActions: ['pore'], cameraKit: false }))).toBe('InvalidParameters');
    const id = await c.startSkinAnalysis({ source: { url: SAMPLE_A }, dstActions: ['pore'], cameraKit: false });
    expect(await codeOf(c.deleteTask(id))).toBe('OperationInvalid'); // still running
  });

  it('maps HD actions onto the recorded SD scores with hd_ names', async () => {
    const c = mockClient({ runningPolls: 0 });
    const id = await c.startSkinAnalysis({ source: { url: SAMPLE_A }, dstActions: ['hd_dark_circle', 'hd_pore'], cameraKit: false });
    const out = (await c.pollSkinAnalysis(id)).results!.output;
    expect(out.map((e) => e.type)).toEqual(['hd_dark_circle', 'hd_pore', 'all', 'skin_age', 'resize_image']);
  });

  it('replays the recorded Fitzpatrick result and can simulate failures', async () => {
    const c = mockClient({ runningPolls: 0 });
    const id = await c.startFitzpatrick({ url: findSample('yc-sample-1')!.url });
    expect((await c.pollFitzpatrick(id)).results).toEqual({ fitzpatrick_scale: 'I', timed: 2325 });
    const failing = mockClient({ runningPolls: 0, failWith: 'error_lighting_dark' });
    const f = await failing.startFitzpatrick({ url: findSample('yc-sample-1')!.url });
    expect(await failing.pollFitzpatrick(f)).toMatchObject({ state: 'error', errorCode: 'error_lighting_dark' });
  });
});
