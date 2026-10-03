import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { ConsentPurpose, StatusResponse } from '../shared/api.ts';
import { CONSENT_VERSION } from '../shared/api.ts';
import { ALL_CONCERNS } from '../shared/concerns.ts';
import { MAX_CONCERNS, qualityForImage } from '../shared/pricing.ts';
import type { CaptureMethod, Concern, ScanQuality } from '../shared/types.ts';
import { type Config, isLive } from './config.ts';
import { ConsentStore } from './consent.ts';
import { checkRequestOrigin, HttpError, isRecord, readJson, sendError, sendJson, sendNoContent } from './http.ts';
import { decodeImage } from './images.ts';
import { JobManager, type PhotoSource, type ScanInput } from './jobs.ts';
import { LabelReader } from './labelReader.ts';
import { UnitLedger } from './ledger.ts';
import { PriceBook } from './prices.ts';
import { findSample, SAMPLES } from './samples.ts';
import { TaskLimiter } from './taskLimiter.ts';
import { HttpYouCamClient } from './youcam/httpClient.ts';
import { MockYouCamClient } from './youcam/mockClient.ts';
import { RateLimiter } from './youcam/rateLimiter.ts';
import type { YouCamClient } from './youcam/types.ts';

const IMAGE_BODY_LIMIT = 15 * 1024 * 1024; // a 10 MB photo as base64 plus JSON
const SMALL_BODY_LIMIT = 16 * 1024;
const MAX_CONCURRENT_JOBS = 2;
const LABEL_READS_PER_HOUR = 30;
const BALANCE_MAX_AGE_MS = 60_000;
const CAPTURE_METHODS: readonly CaptureMethod[] = ['upload', 'camera-kit', 'sample'];

export interface Services {
  mode: 'mock' | 'live';
  port: number;
  client: YouCamClient;
  ledger: UnitLedger;
  prices: PriceBook;
  consent: ConsentStore;
  labels: LabelReader;
  jobs: JobManager;
  tasks: TaskLimiter;
  labelLimiter: TaskLimiter;
  balance: { value: number | null; at: number };
  log: (line: string) => void;
}

export interface ServiceOverrides {
  client?: YouCamClient;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  nebiusBaseUrl?: string;
}

/** Wire everything from config. Live mode needs a YouCam key and no UNSTACK_FORCE_MOCK=1. */
export function createServices(config: Config, o: ServiceOverrides = {}): Services {
  const live = isLive(config);
  const log = o.log ?? ((line: string) => console.log(line));
  // One limiter for every YouCam request this process makes (4 QPS, 200 per 300 s).
  const client: YouCamClient =
    o.client ??
    (live
      ? new HttpYouCamClient({ apiKey: config.youcamApiKey!, limiter: new RateLimiter(), ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}) })
      : new MockYouCamClient({ fixturesDir: resolve(config.rootDir, 'fixtures/recorded') }));
  const mode = client.mode;
  const ledger = new UnitLedger(mode === 'live' ? resolve(config.dataDir, 'unit-ledger.json') : null, config.unitCap);
  const prices = new PriceBook();
  const balance = { value: null as number | null, at: 0 };
  const labels = new LabelReader({
    apiKey: config.nebiusApiKey,
    model: config.nebiusModel,
    capUsd: config.llmCapUsd,
    ledgerPath: resolve(config.dataDir, 'llm-spend.json'),
    ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
    ...(o.nebiusBaseUrl ? { baseUrl: o.nebiusBaseUrl } : {}),
  });
  const jobs = new JobManager({
    client,
    ledger,
    prices,
    ...(o.sleep ? { sleep: o.sleep } : {}),
    log,
    onBalance: (units) => {
      balance.value = units;
      balance.at = Date.now();
    },
  });
  return {
    mode,
    port: config.port,
    client,
    ledger,
    prices,
    consent: new ConsentStore(resolve(config.dataDir, 'consent-receipts.json')),
    labels,
    jobs,
    tasks: new TaskLimiter(config.maxTasksPerHour),
    labelLimiter: new TaskLimiter(LABEL_READS_PER_HOUR),
    balance,
    log,
  };
}

/** Free calls made at start-up in live mode: the price list and the balance. */
export async function warmUp(s: Services): Promise<void> {
  if (s.mode !== 'live') return;
  await Promise.allSettled([s.prices.refresh(s.client), refreshBalance(s)]);
}

async function refreshBalance(s: Services): Promise<void> {
  if (s.mode !== 'live') return;
  const units = await s.client.getBalance();
  s.balance.value = units;
  s.balance.at = Date.now();
}

export function statusOf(s: Services): StatusResponse {
  if (s.mode === 'live' && Date.now() - s.balance.at > BALANCE_MAX_AGE_MS) {
    s.balance.at = Date.now(); // one refresh at a time; status answers from the cache
    void refreshBalance(s).catch(() => undefined);
  }
  const snap = s.ledger.snapshot();
  return {
    mode: s.mode,
    units: { ...snap, ledger: s.mode },
    youcamBalance: s.mode === 'live' ? s.balance.value : null,
    prices: { source: s.mode === 'live' && s.prices.hasLive ? 'docs+live' : 'docs', fitzpatrick: s.prices.fitzpatrickUnits() },
    llm: {
      enabled: s.labels.enabled,
      model: s.labels.enabled ? s.labels.model : null,
      spentUsd: s.labels.spentUsd,
      capUsd: s.labels.capUsd,
      price: s.labels.enabled ? s.labels.price : null,
    },
    consentVersion: CONSENT_VERSION,
  };
}

// ---------- request parsing ----------

function parseConcerns(v: unknown): Concern[] {
  if (!Array.isArray(v)) throw new HttpError(400, 'bad-concerns', 'Pick at least one concern.');
  const list = [...new Set(v)];
  if (list.length === 0) throw new HttpError(400, 'bad-concerns', 'Pick at least one concern.');
  if (list.length > MAX_CONCERNS) throw new HttpError(400, 'bad-concerns', `At most ${MAX_CONCERNS} concerns per scan.`);
  if (!list.every((c): c is Concern => (ALL_CONCERNS as unknown[]).includes(c))) throw new HttpError(400, 'bad-concerns', 'Unknown concern.');
  return list;
}

function tooSmall(): HttpError {
  return new HttpError(400, 'error_below_min_image_size', 'Photo too small', 'Use a photo at least 480 px on its short side (1080 px for HD).');
}

function parseScan(body: Record<string, unknown>): ScanInput {
  const concerns = parseConcerns(body.concerns);
  if (body.quality !== 'sd' && body.quality !== 'hd') throw new HttpError(400, 'bad-quality', 'Quality must be sd or hd.');
  const quality: ScanQuality = body.quality;
  const captureMethod = body.captureMethod as CaptureMethod;
  if (!CAPTURE_METHODS.includes(captureMethod)) throw new HttpError(400, 'bad-capture-method', 'Unknown capture method.');
  const photo = parsePhoto(body);
  const size = photo.kind === 'sample' ? findSample(body.sampleId as string)! : photo.image;
  const max = qualityForImage(size.width, size.height);
  if (!max) throw tooSmall();
  if (quality === 'hd' && max !== 'hd') throw new HttpError(400, 'hd-needs-larger-photo', 'HD needs a photo at least 1080 px on its short side.', 'Use SD for this photo.');
  return { photo, concerns, quality, captureMethod: photo.kind === 'sample' ? 'sample' : captureMethod === 'sample' ? 'upload' : captureMethod };
}

function parsePhoto(body: Record<string, unknown>): PhotoSource {
  const hasImage = body.image !== undefined;
  const hasSample = body.sampleId !== undefined;
  if (hasImage === hasSample) throw new HttpError(400, 'bad-photo', 'Send either an image or a sample id.');
  if (hasSample) {
    const sample = findSample(typeof body.sampleId === 'string' ? body.sampleId : undefined);
    if (!sample) throw new HttpError(400, 'unknown-sample', 'Unknown sample image.');
    return { kind: 'sample', url: sample.url };
  }
  return { kind: 'upload', image: decodeImage(body.image) };
}

/** Fitzpatrick accepts JPEG only: short side ≥ 320 px, long side ≤ 4096 px (docs, §7). */
function parseSunPhoto(body: Record<string, unknown>): PhotoSource {
  const photo = parsePhoto(body);
  const jpegAdvice = 'YouCam’s Fitzpatrick analyser accepts JPEG only. Send the photo as a JPEG upload (the app converts PNG samples and photos for you).';
  if (photo.kind === 'sample') {
    if (!/\.jpe?g$/i.test(photo.url)) throw new HttpError(400, 'fitzpatrick-needs-jpeg', 'This sample is a PNG.', jpegAdvice);
    return photo;
  }
  const { image } = photo;
  if (image.contentType !== 'image/jpeg') throw new HttpError(400, 'fitzpatrick-needs-jpeg', 'The sun profile needs a JPEG photo.', jpegAdvice);
  if (Math.min(image.width, image.height) < 320) throw new HttpError(400, 'error_below_min_image_size', 'Photo too small', 'Use a photo at least 320 px on its short side.');
  if (Math.max(image.width, image.height) > 4096) throw new HttpError(400, 'error_exceed_max_image_size', 'Photo too large', 'Use a photo under 4096 px on its long side.');
  return photo;
}

function admitTask(s: Services): void {
  if (s.jobs.running >= MAX_CONCURRENT_JOBS) throw new HttpError(429, 'busy', 'Another scan is still running.', 'Wait for it to finish, then try again.');
  if (s.mode === 'live') s.tasks.take();
}

function reserve(s: Services, feature: string, units: number) {
  try {
    return s.ledger.reserve(feature, units, s.balance.value ?? undefined);
  } catch (err) {
    if (s.mode === 'live') s.tasks.giveBack();
    throw err;
  }
}

async function bodyWithConsent(req: IncomingMessage, s: Services, purpose: ConsentPurpose): Promise<Record<string, unknown>> {
  const body = await readJson(req, IMAGE_BODY_LIMIT);
  if (!isRecord(body)) throw new HttpError(400, 'bad-json', 'Expected a JSON object.');
  s.consent.require(body.consentId, purpose);
  return body;
}

// ---------- routes ----------

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[]) => Promise<void> | void;

function routes(s: Services): { method: string; pattern: RegExp; handler: Handler }[] {
  return [
    { method: 'GET', pattern: /^\/api\/status$/, handler: (_q, res) => sendJson(res, 200, statusOf(s)) },
    { method: 'GET', pattern: /^\/api\/samples$/, handler: (_q, res) => sendJson(res, 200, SAMPLES) },
    {
      method: 'POST',
      pattern: /^\/api\/consent$/,
      handler: async (req, res) => sendJson(res, 201, s.consent.grant(await readJson(req, SMALL_BODY_LIMIT))),
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/consent\/([0-9a-f-]{36})$/,
      handler: (_q, res, [id]) => {
        s.consent.withdraw(id!);
        sendNoContent(res);
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/scans$/,
      handler: async (req, res) => {
        const body = await bodyWithConsent(req, s, 'skin-analysis');
        const input = parseScan(body);
        admitTask(s);
        const units = s.prices.skinUnits(input.concerns.length, input.quality);
        const reservation = reserve(s, `skin-analysis v2.1 ${input.quality.toUpperCase()} x${input.concerns.length}`, units);
        sendJson(res, 202, s.jobs.startScan(input, reservation));
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/sun-profile$/,
      handler: async (req, res) => {
        const body = await bodyWithConsent(req, s, 'sun-profile');
        const photo = parseSunPhoto(body);
        admitTask(s);
        const reservation = reserve(s, 'fitzpatrick v1.0', s.prices.fitzpatrickUnits());
        sendJson(res, 202, s.jobs.startSunProfile(photo, reservation));
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/jobs\/([0-9a-f-]{36})$/,
      handler: (_q, res, [id]) => {
        const job = s.jobs.get(id!);
        if (!job) throw new HttpError(404, 'job-not-found', 'That scan is no longer on the server.', 'Results are kept for 10 minutes. Start a new scan.');
        sendJson(res, 200, job);
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/label-read$/,
      handler: async (req, res) => {
        if (!s.labels.enabled) await s.labels.read(null); // throws the 503 before reading the body
        const body = await readJson(req, IMAGE_BODY_LIMIT);
        s.labelLimiter.take();
        sendJson(res, 200, await s.labels.read(isRecord(body) ? body.image : null));
      },
    },
  ];
}

/** The /api handler. Returns false for paths it doesn't own, so static/Vite serving can take them. */
export function createApiHandler(s: Services): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const table = routes(s);
  return async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== '/api' && !path.startsWith('/api/')) return false;
    const started = Date.now();
    try {
      checkRequestOrigin(req, s.port);
      const pathMatches = table.filter((r) => r.pattern.test(path));
      const route = pathMatches.find((r) => r.method === req.method);
      if (!route) {
        if (pathMatches.length > 0) throw new HttpError(405, 'method-not-allowed', 'Method not allowed.');
        throw new HttpError(404, 'not-found', 'No such API route.');
      }
      await route.handler(req, res, route.pattern.exec(path)!.slice(1));
    } catch (err) {
      if (res.headersSent) return true;
      if (err instanceof HttpError) sendError(res, err);
      else {
        s.log(`error on ${req.method} ${path}: ${err instanceof Error ? err.name : 'unknown'}`);
        sendError(res, new HttpError(500, 'internal', 'Something went wrong on the server.'));
      }
    } finally {
      if (path !== '/api/status' && !path.startsWith('/api/jobs/')) s.log(`${req.method} ${path.replace(/[0-9a-f-]{36}/, ':id')} ${res.statusCode} ${Date.now() - started}ms`);
    }
    return true;
  };
}
