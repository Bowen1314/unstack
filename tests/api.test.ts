import { afterEach, describe, expect, it } from 'vitest';
import type { ApiErrorBody, ConsentResponse, JobCreated, LabelReadResponse, SampleImage, StatusResponse } from '../shared/api.ts';
import type { ScanResult, SunProfile } from '../shared/types.ts';
import { call, dataUrl, jpegBytes, pngBytes, startTestServer, testConfig, waitForJob, type TestServer } from './support.ts';

let srv: TestServer | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
});

async function start(over: Parameters<typeof testConfig>[0] = {}, overrides: Parameters<typeof startTestServer>[1] = {}): Promise<TestServer> {
  srv = await startTestServer(testConfig(over), overrides);
  return srv;
}

async function consent(port: number, purposes = ['skin-analysis', 'sun-profile']): Promise<string> {
  const r = await call(port, 'POST', '/api/consent', { version: '2026-10-02', adult: true, purposes });
  expect(r.status).toBe(201);
  return (r.body as ConsentResponse).consentId;
}

const scan = (consentId: string, extra: Record<string, unknown> = {}) => ({
  consentId,
  sampleId: 'yc-skin-01',
  concerns: ['pore', 'redness'],
  quality: 'sd',
  captureMethod: 'sample',
  ...extra,
});

describe('GET /api/status and /api/samples', () => {
  it('reports demo mode, the in-memory ledger and the consent version', async () => {
    const { port } = await start();
    const r = await call(port, 'GET', '/api/status');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const s = r.body as StatusResponse;
    expect(s).toMatchObject({ mode: 'mock', youcamBalance: null, consentVersion: '2026-10-02', prices: { source: 'docs', fitzpatrick: 10 } });
    expect(s.units).toEqual({ cap: 200, used: 0, reserved: 0, available: 200, ledger: 'mock' });
    expect(s.llm).toMatchObject({ enabled: false, model: null, spentUsd: 0 });
  });

  it('lists the YouCam sample images', async () => {
    const { port } = await start();
    const list = (await call(port, 'GET', '/api/samples')).body as SampleImage[];
    expect(list.map((x) => x.id)).toEqual(['yc-skin-01', 'yc-sample-1', 'yc-sample-7']);
  });
});

describe('consent gate', () => {
  it('refuses a scan without consent, with a code that contains "consent"', async () => {
    const { port } = await start();
    const r = await call(port, 'POST', '/api/scans', scan('00000000-0000-0000-0000-000000000000'));
    expect(r.status).toBe(403);
    expect((r.body as ApiErrorBody).code).toBe('consent-required');
    expect((r.body as ApiErrorBody).code).toMatch(/consent/);
  });

  it('refuses consent for an old text version', async () => {
    const { port } = await start();
    const r = await call(port, 'POST', '/api/consent', { version: '2026-01-01', adult: true, purposes: ['skin-analysis'] });
    expect(r.status).toBe(409);
    expect((r.body as ApiErrorBody).code).toBe('consent-version-mismatch');
  });

  it('withdrawing consent blocks the next scan', async () => {
    const { port } = await start();
    const id = await consent(port);
    expect((await call(port, 'DELETE', `/api/consent/${id}`)).status).toBe(204);
    const r = await call(port, 'POST', '/api/scans', scan(id));
    expect(r.status).toBe(403);
    expect((r.body as ApiErrorBody).code).toBe('consent-withdrawn');
  });

  it('a sun profile needs the sun-profile purpose', async () => {
    const { port } = await start();
    const id = await consent(port, ['skin-analysis']);
    const r = await call(port, 'POST', '/api/sun-profile', { consentId: id, sampleId: 'yc-sample-1' });
    expect((r.body as ApiErrorBody).code).toBe('consent-purpose-missing');
  });
});

describe('POST /api/scans', () => {
  it('runs a sample scan end to end in demo mode', async () => {
    const { port } = await start();
    const id = await consent(port);
    const created = await call(port, 'POST', '/api/scans', scan(id));
    expect(created.status).toBe(202);
    const { jobId, unitsReserved } = created.body as JobCreated;
    expect(unitsReserved).toBe(9);
    const job = await waitForJob(port, jobId);
    expect(job.stage).toBe('done');
    const result = job.result as ScanResult;
    expect(result.scores.map((s) => s.concern).sort()).toEqual(['pore', 'redness']);
    expect(result.remoteDeleted).toBe(true);
    const status = (await call(port, 'GET', '/api/status')).body as StatusResponse;
    expect(status.units).toMatchObject({ used: 9, reserved: 0, available: 191 });
  });

  it('runs an uploaded photo end to end', async () => {
    const { port } = await start();
    const id = await consent(port);
    const image = { dataUrl: dataUrl(pngBytes(720, 960, 2048), 'image/png'), width: 720, height: 960 };
    const created = await call(port, 'POST', '/api/scans', scan(id, { sampleId: undefined, image, captureMethod: 'upload', concerns: ['moisture'] }));
    expect(created.status).toBe(202);
    const job = await waitForJob(port, (created.body as JobCreated).jobId);
    expect((job.result as ScanResult).captureMethod).toBe('upload');
  });

  it('validates concerns, quality and photo size', async () => {
    const { port } = await start();
    const id = await consent(port);
    const codes = await Promise.all([
      call(port, 'POST', '/api/scans', scan(id, { concerns: [] })),
      call(port, 'POST', '/api/scans', scan(id, { concerns: ['freckles'] })),
      call(port, 'POST', '/api/scans', scan(id, { quality: 'uhd' })),
      call(port, 'POST', '/api/scans', scan(id, { sampleId: 'nope' })),
      call(port, 'POST', '/api/scans', scan(id, { quality: 'hd' })), // sample A is 1200x1600: HD-capable
      call(port, 'POST', '/api/scans', scan(id, { sampleId: undefined, image: { dataUrl: dataUrl(jpegBytes(400, 500), 'image/jpeg') } })),
      call(port, 'POST', '/api/scans', scan(id, { sampleId: undefined, image: { dataUrl: dataUrl(jpegBytes(800, 1000), 'image/jpeg') }, quality: 'hd' })),
    ]).then((rs) => rs.map((r) => (r.status === 202 ? 'ok' : (r.body as ApiErrorBody).code)));
    expect(codes).toEqual(['bad-concerns', 'bad-concerns', 'bad-quality', 'unknown-sample', 'ok', 'error_below_min_image_size', 'hd-needs-larger-photo']);
  });

  it('refuses a scan that would exceed the unit cap, before any YouCam call', async () => {
    const s = await start({ unitCap: 10 });
    const id = await consent(s.port);
    const first = await call(s.port, 'POST', '/api/scans', scan(id));
    expect(first.status).toBe(202);
    await waitForJob(s.port, (first.body as JobCreated).jobId);
    const callsBefore = (s.services.client as unknown as { calls: string[] }).calls.length;
    const second = await call(s.port, 'POST', '/api/scans', scan(id));
    expect(second.status).toBe(409);
    expect((second.body as ApiErrorBody).code).toBe('unit-cap-reached');
    expect((s.services.client as unknown as { calls: string[] }).calls.length).toBe(callsBefore);
  });

  it('unknown jobs are 404', async () => {
    const { port } = await start();
    const r = await call(port, 'GET', '/api/jobs/00000000-0000-0000-0000-000000000000');
    expect(r.status).toBe(404);
    expect((r.body as ApiErrorBody).code).toBe('job-not-found');
  });
});

describe('POST /api/sun-profile', () => {
  it('runs on a JPEG sample', async () => {
    const { port } = await start();
    const id = await consent(port);
    const created = await call(port, 'POST', '/api/sun-profile', { consentId: id, sampleId: 'yc-sample-1' });
    expect(created.status).toBe(202);
    expect((created.body as JobCreated).unitsReserved).toBe(10);
    const job = await waitForJob(port, (created.body as JobCreated).jobId);
    expect((job.result as SunProfile).scale).toBe('I');
  });

  it('refuses PNG input, because Fitzpatrick accepts JPEG only', async () => {
    const { port } = await start();
    const id = await consent(port);
    const sample = await call(port, 'POST', '/api/sun-profile', { consentId: id, sampleId: 'yc-skin-01' });
    expect((sample.body as ApiErrorBody).code).toBe('fitzpatrick-needs-jpeg');
    const upload = await call(port, 'POST', '/api/sun-profile', { consentId: id, image: { dataUrl: dataUrl(pngBytes(800, 1000), 'image/png') } });
    expect((upload.body as ApiErrorBody).code).toBe('fitzpatrick-needs-jpeg');
  });
});

describe('POST /api/label-read', () => {
  it('is 503 when no Nebius key is configured', async () => {
    const { port } = await start();
    const r = await call(port, 'POST', '/api/label-read', { image: { dataUrl: dataUrl(jpegBytes(800, 600), 'image/jpeg') } });
    expect(r.status).toBe(503);
    expect((r.body as ApiErrorBody).code).toBe('llm-disabled');
    expect((r.body as ApiErrorBody).advice).toMatch(/Paste/);
  });

  it('forwards the photo to the configured Nebius model and books the cost', async () => {
    const seen: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(input), auth: headers.get('authorization'), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return Response.json({ choices: [{ message: { content: 'Ingredients: Aqua, Glycerin, Niacinamide' } }], usage: { prompt_tokens: 1200, completion_tokens: 20 } });
    };
    const s = await start({ nebiusApiKey: 'test-nebius-key' }, { fetchImpl });
    const r = await call(s.port, 'POST', '/api/label-read', { image: { dataUrl: dataUrl(jpegBytes(800, 600), 'image/jpeg') } });
    expect(r.status).toBe(200);
    const body = r.body as LabelReadResponse;
    expect(body).toMatchObject({ text: 'Aqua, Glycerin, Niacinamide', model: 'openbmb/MiniCPM-V-4_5', mock: false });
    expect(body.costUsd).toBeCloseTo((1200 * 0.658 + 20 * 1.11) / 1e6, 9);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://api.tokenfactory.nebius.com/v1/chat/completions');
    expect(seen[0]!.auth).toBe('Bearer test-nebius-key');
    expect(seen[0]!.body.model).toBe('openbmb/MiniCPM-V-4_5');
    const status = (await call(s.port, 'GET', '/api/status')).body as StatusResponse;
    expect(status.llm).toMatchObject({ enabled: true, model: 'openbmb/MiniCPM-V-4_5', price: { inputPer1M: 0.658, outputPer1M: 1.11 } });
    expect(status.llm.spentUsd).toBeCloseTo(body.costUsd, 9);
  });
});

describe('request hardening', () => {
  it('rejects cross-site and non-JSON writes, and foreign Host headers', async () => {
    const { port } = await start();
    const body = { version: '2026-10-02', adult: true, purposes: ['skin-analysis'] };
    const textPlain = await call(port, 'POST', '/api/consent', JSON.stringify(body), { 'Content-Type': 'text/plain' });
    expect(textPlain.status).toBe(415);
    const evilOrigin = await call(port, 'POST', '/api/consent', body, { Origin: 'https://evil.example' });
    expect(evilOrigin.status).toBe(403);
    expect((evilOrigin.body as ApiErrorBody).code).toBe('cross-origin');
    const rebinding = await call(port, 'GET', '/api/status', undefined, { Host: `evil.example:${port}` });
    expect(rebinding.status).toBe(403);
    const sameOrigin = await call(port, 'POST', '/api/consent', body, { Origin: `http://127.0.0.1:${port}` });
    expect(sameOrigin.status).toBe(201);
  });

  it('answers unknown routes and wrong methods with JSON errors', async () => {
    const { port } = await start();
    expect((await call(port, 'GET', '/api/nope')).body).toMatchObject({ code: 'not-found' });
    expect((await call(port, 'GET', '/api/scans')).status).toBe(405);
    expect((await call(port, 'POST', '/api/consent', '{not json')).body).toMatchObject({ code: 'bad-json' });
  });

  it('leaves non-API paths to the web app', async () => {
    const { port } = await start();
    const r = await call(port, 'GET', '/scan');
    expect(r.body).toBe('not api');
  });
});
