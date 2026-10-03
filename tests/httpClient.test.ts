import { describe, expect, it } from 'vitest';
import { HttpYouCamClient, YOUCAM_API_HOST } from '../server/youcam/httpClient.ts';
import { RateLimiter } from '../server/youcam/rateLimiter.ts';
import { YouCamApiError } from '../server/youcam/types.ts';

interface Seen {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

function fakeFetch(respond: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = String(input);
    seen.push({ url, method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? init.body : null });
    return respond(url, init);
  };
  return { impl, seen };
}

const noWait = new RateLimiter(1000, 1000, 300_000, Date.now, async () => undefined);
const client = (impl: typeof fetch) => new HttpYouCamClient({ apiKey: 'k-test', fetchImpl: impl, limiter: noWait, sleep: async () => undefined });

describe('HttpYouCamClient', () => {
  it('sends the key only to the API host, never to presigned storage URLs', async () => {
    const { impl, seen } = fakeFetch((url) => {
      if (url.endsWith('/s2s/v2.0/file')) {
        return Response.json({
          status: 200,
          data: { files: [{ file_id: 'f/1+x', requests: [{ method: 'PUT', url: 'https://yce-us.s3-accelerate.amazonaws.com/u?sig=1', headers: { 'Content-Length': 3, 'Content-Type': 'image/jpeg' } }] }] },
        });
      }
      return new Response(null, { status: 200 });
    });
    const c = client(impl);
    const slot = await c.createUpload({ contentType: 'image/jpeg', fileName: 'a.jpg', size: 3 });
    await c.putUpload(slot, new Uint8Array([1, 2, 3]));
    expect(seen[0]!.url).toBe(`${YOUCAM_API_HOST}/s2s/v2.0/file`);
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer k-test');
    expect(JSON.parse(seen[0]!.body!)).toEqual({ files: [{ content_type: 'image/jpeg', file_name: 'a.jpg', file_size: 3 }] });
    expect(seen[1]!.headers.get('authorization')).toBeNull();
    expect([...seen[1]!.headers.keys()].sort()).toEqual(['content-length', 'content-type']);
    expect(slot.fileId).toBe('f/1+x');
  });

  it('runs skin analysis v2.1 with JSON output and raw masks, and polls with an encoded task id', async () => {
    const { impl, seen } = fakeFetch((url) =>
      url.endsWith('/task/skin-analysis') ? Response.json({ status: 200, data: { task_id: 't/1' } }) : Response.json({ status: 200, data: { task_status: 'running', results: null, error: null } }),
    );
    const c = client(impl);
    const id = await c.startSkinAnalysis({ source: { url: 'https://example.com/a.jpg' }, dstActions: ['pore'], cameraKit: true });
    expect(JSON.parse(seen[0]!.body!)).toEqual({ src_file_url: 'https://example.com/a.jpg', dst_actions: ['pore'], format: 'json', miniserver_args: { enable_mask_overlay: false }, pf_camera_kit: true });
    expect((await c.pollSkinAnalysis(id)).state).toBe('running');
    expect(seen[1]!.url).toBe(`${YOUCAM_API_HOST}/s2s/v2.1/task/skin-analysis/t%2F1`);
  });

  it('sums unexpired balances and follows feature-cost pages', async () => {
    const future = Date.now() + 86_400_000;
    const { impl } = fakeFetch((url) => {
      if (url.includes('client/credit')) return Response.json({ status: 200, results: [{ amount_dec: 1000, expiry: future }, { amount_dec: 14, expiry: future }, { amount_dec: 50, expiry: 1 }] });
      const page2 = url.includes('starting_token=abc');
      return Response.json({ status: 200, result: { skus: [{ description: page2 ? 'B' : 'A', amount: 1, unit: 'result_image', proc_unit: 1, run_task_url: 'x' }], next_token: page2 ? null : 'abc' } });
    });
    const c = client(impl);
    expect(await c.getBalance()).toBe(1014);
    expect((await c.getFeatureCosts()).map((s) => s.description)).toEqual(['A', 'B']);
  });

  it('maps 401, task errors and network failures to codes the app understands', async () => {
    const unauthorized = client(fakeFetch(() => Response.json({ status: 401, error: 'Unauthorized', error_code: 'InvalidAccessToken' }, { status: 401 })).impl);
    await expect(unauthorized.getBalance()).rejects.toMatchObject({ code: 'InvalidAccessToken', status: 401 });
    const failed = client(fakeFetch(() => Response.json({ status: 200, data: { task_status: 'error', error: 'error_no_face', error_message: 'no face' } })).impl);
    expect(await failed.pollFitzpatrick('t')).toMatchObject({ state: 'error', errorCode: 'error_no_face' });
    const down = client(
      fakeFetch(() => {
        throw new TypeError('fetch failed');
      }).impl,
    );
    const err = await down.getBalance().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YouCamApiError);
    expect((err as YouCamApiError).code).toBe('YouCamUnreachable');
  });

  it('retries 429 with back-off, then gives up with RateLimited', async () => {
    const { impl, seen } = fakeFetch(() => new Response('{}', { status: 429 }));
    await expect(client(impl).getBalance()).rejects.toMatchObject({ code: 'RateLimited' });
    expect(seen).toHaveLength(4);
  });
});

describe('RateLimiter', () => {
  it('holds requests to the per-second and per-window limits', async () => {
    let t = 0;
    const waits: number[] = [];
    const rl = new RateLimiter(2, 3, 10_000, () => t, async (ms) => {
      waits.push(ms);
      t += ms;
    });
    for (let i = 0; i < 4; i++) await rl.acquire();
    // 2 per second, 3 per 10 s window: the 3rd waits for the next second, the 4th for the window.
    expect(waits[0]).toBe(1000);
    expect(t).toBeGreaterThanOrEqual(10_000);
    expect(rl.used).toBeLessThanOrEqual(3);
  });
});
