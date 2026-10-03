/** Shared helpers for the server tests. Nothing here touches the network. */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';
import { createApiHandler, createServices, type ServiceOverrides, type Services } from '../server/app.ts';
import type { Config } from '../server/config.ts';
import { MockYouCamClient, type MockClientOptions } from '../server/youcam/mockClient.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = resolve(ROOT, 'fixtures/recorded');
/** Recorded masks are git-ignored, so a fresh clone may not have them. */
export const HAS_MASKS = existsSync(resolve(FIXTURES, 'masks/yc-skin-01/pore.png'));

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'unstack-test-'));
  tmpDirs.push(dir);
  return dir;
}

export function testConfig(over: Partial<Config> = {}): Config {
  const dataDir = tempDir();
  return {
    rootDir: ROOT,
    dataDir,
    host: '127.0.0.1',
    port: 0,
    youcamApiKey: null,
    forceMock: false,
    unitCap: 200,
    maxTasksPerHour: 12,
    nebiusApiKey: null,
    nebiusModel: 'openbmb/MiniCPM-V-4_5',
    llmCapUsd: 1,
    ...over,
  };
}

export function mockClient(opts: Partial<MockClientOptions> = {}): MockYouCamClient {
  return new MockYouCamClient({ fixturesDir: FIXTURES, runningPolls: 1, ...opts });
}

/** A fake clock: sleep() advances now() instantly. */
export function fakeClock(start = Date.parse('2026-10-02T12:00:00Z')) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

export interface TestServer {
  services: Services;
  port: number;
  server: Server;
  close: () => Promise<void>;
}

export async function startTestServer(config: Config, overrides: ServiceOverrides = {}): Promise<TestServer> {
  const clock = fakeClock();
  const services = createServices(config, { client: mockClient(), sleep: clock.sleep, log: () => undefined, ...overrides });
  const api = createApiHandler(services);
  const server = createServer((req, res) => {
    void api(req, res).then((handled) => {
      if (!handled) res.writeHead(404).end('not api');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  services.port = port;
  return { services, port, server, close: () => new Promise((r) => server.close(() => r())) };
}

export interface CallResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

/** Raw HTTP call with full control over Host/Origin/Content-Type. */
export function call(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<CallResult> {
  const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  const h: Record<string, string> = { Host: `127.0.0.1:${port}`, ...headers };
  if (payload !== undefined && !Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['Content-Type'] = 'application/json';
  if (payload !== undefined) h['Content-Length'] = String(Buffer.byteLength(payload));
  return new Promise((resolvePromise, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: h }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed: unknown = text;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = text;
        }
        resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/** A header-only PNG (signature + IHDR) of the given size: enough for type and size sniffing. */
export function pngBytes(width: number, height: number, padTo = 64): Uint8Array {
  const b = new Uint8Array(Math.max(33, padTo));
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  b.set([8, 6, 0, 0, 0], 24);
  return b;
}

/** A minimal JPEG prefix: SOI, APP0 (JFIF) and a SOF0 frame header with the given size. */
export function jpegBytes(width: number, height: number, padTo = 64): Uint8Array {
  const head = [
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  ];
  const b = new Uint8Array(Math.max(head.length + 2, padTo));
  b.set(head);
  return b;
}

export function dataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

export async function waitForJob(port: number, jobId: string, tries = 200): Promise<Record<string, unknown>> {
  for (let i = 0; i < tries; i++) {
    const r = await call(port, 'GET', `/api/jobs/${jobId}`);
    const job = r.body as Record<string, unknown>;
    if (job.stage === 'done' || job.stage === 'error') return job;
    await new Promise((res) => setTimeout(res, 5));
  }
  throw new Error('job did not finish');
}
