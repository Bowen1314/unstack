/**
 * Live verification against the real YouCam API, with a hard unit cap.
 *
 *   npm run record-fixtures            # free calls only (balance, feature-cost)
 *   npm run record-fixtures -- --tasks # plus one skin-analysis and one Fitzpatrick task
 *
 * - Reads the key from .env (YOUCAM_API_KEY) via the normal config loader.
 * - The key is sent only to yce-api-01.makeupar.com and is never printed.
 * - Units spent here are tracked in data/verify-ledger.json across runs and can
 *   never exceed VERIFY_CAP in total.
 * - Raw responses are saved to fixtures/recorded/ with every URL, file id and
 *   task id replaced by a placeholder. Masks for YouCam's own sample face are
 *   saved so demo mode can show real overlays.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.ts';
import { HttpYouCamClient, YOUCAM_API_HOST } from '../server/youcam/httpClient.ts';
import { RateLimiter } from '../server/youcam/rateLimiter.ts';
import type { TaskPoll } from '../server/youcam/types.ts';
import { skinAnalysisUnits, FITZPATRICK_UNITS } from '../shared/pricing.ts';
import { SAMPLES } from '../server/samples.ts';
import { ALL_CONCERNS, toDstActions } from '../shared/concerns.ts';

const VERIFY_CAP = 60;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'fixtures/recorded');
const ledgerPath = resolve(root, 'data/verify-ledger.json');
const runTasks = process.argv.includes('--tasks');

const SD_ALL = toDstActions(ALL_CONCERNS, 'sd');

interface VerifyLedger { spent: number; entries: { at: string; what: string; units: number }[] }
function readLedger(): VerifyLedger {
  return existsSync(ledgerPath) ? (JSON.parse(readFileSync(ledgerPath, 'utf8')) as VerifyLedger) : { spent: 0, entries: [] };
}
function spend(what: string, units: number): void {
  const l = readLedger();
  if (l.spent + units > VERIFY_CAP) throw new Error(`Verification cap: ${l.spent} + ${units} > ${VERIFY_CAP} units. Refusing.`);
  l.spent += units;
  l.entries.push({ at: new Date().toISOString(), what, units });
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, JSON.stringify(l, null, 2));
}

/** Replace anything account- or session-specific in a recorded body. */
function redact(text: string): string {
  return text
    .replace(/https?:\/\/[^"\s]+/g, (u) => (u.startsWith(YOUCAM_API_HOST) ? u : '<redacted-url>'))
    .replace(/("(?:file_id|task_id|target_id)"\s*:\s*")[^"]+"/g, '$1<redacted>"')
    .replace(/("id"\s*:\s*)\d{6,}/g, '$10');
}

const recorded: { method: string; path: string; status: number; body: unknown }[] = [];
const recordingFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const res = await fetch(input, init);
  if (url.startsWith(YOUCAM_API_HOST)) {
    const text = await res.clone().text();
    let body: unknown = text;
    try { body = JSON.parse(redact(text)); } catch { body = redact(text).slice(0, 500); }
    recorded.push({ method: init?.method ?? 'GET', path: url.slice(YOUCAM_API_HOST.length).replace(/(\/task\/[a-z0-9-]+\/)[^/?]+$/, '$1<task_id>'), status: res.status, body });
  }
  return res;
};

function save(name: string, data: unknown): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, name), JSON.stringify(data, null, 2) + '\n');
  console.log(`  saved fixtures/recorded/${name}`);
}

async function pollUntilDone<R>(poll: () => Promise<TaskPoll<R>>, label: string): Promise<{ result: TaskPoll<R>; polls: number; seconds: number }> {
  const t0 = Date.now();
  for (let i = 1; i <= 40; i++) {
    const r = await poll();
    if (r.state !== 'running') return { result: r, polls: i, seconds: (Date.now() - t0) / 1000 };
    await new Promise((res) => setTimeout(res, i < 4 ? 2000 : 5000));
  }
  throw new Error(`${label}: still running after 40 polls`);
}

async function main(): Promise<void> {
  const config = loadConfig(root);
  if (!config.youcamApiKey) {
    console.error('No YOUCAM_API_KEY in .env. Run scripts/set-youcam-key.sh first.');
    process.exit(1);
  }
  const client = new HttpYouCamClient({ apiKey: config.youcamApiKey, fetchImpl: recordingFetch, limiter: new RateLimiter(2, 100) });
  console.log(`Verification ledger: ${readLedger().spent}/${VERIFY_CAP} units used so far.`);

  console.log('1. Free calls');
  const before = await client.getBalance();
  console.log(`  balance: ${before}`);
  const skus = await client.getFeatureCosts();
  save('feature-cost.json', { recordedAt: new Date().toISOString(), skus });
  const relevant = skus.filter((s) => /skin-analysis|fitzpatrick|cloth/.test(s.run_task_url));
  for (const s of relevant) console.log(`  ${s.amount} units / ${s.proc_unit} ${s.unit}: ${s.description} -> ${s.run_task_url.replace(YOUCAM_API_HOST, '')}`);

  save('free-calls.json', recorded.splice(0));
  if (!runTasks) {
    console.log('Done (free calls only). Re-run with --tasks to spend units.');
    return;
  }

  // ---- Skin analysis: SD, all 16 concerns, via File API upload of YouCam's sample face.
  const sample = SAMPLES.find((s) => s.id === 'yc-skin-01')!;
  const docCost = skinAnalysisUnits(SD_ALL.length, 'sd');
  const liveCost = Math.max(0, ...relevant.filter((s) => s.run_task_url.includes('skin-analysis') && /SD/i.test(s.description) && /13/.test(s.description)).map((s) => s.amount));
  const skinCost = Math.max(docCost, liveCost);
  spend('skin-analysis v2.1 SD x16', skinCost);
  console.log(`2. Skin analysis SD (16 concerns), reserved ${skinCost} units`);
  const img = new Uint8Array(await (await fetch(sample.url)).arrayBuffer());
  const slot = await client.createUpload({ contentType: 'image/png', fileName: 'youcam_sample_skin_01.png', size: img.byteLength });
  await client.putUpload(slot, img);
  const taskId = await client.startSkinAnalysis({ source: { fileId: slot.fileId }, dstActions: SD_ALL, cameraKit: false });
  const skin = await pollUntilDone(() => client.pollSkinAnalysis(taskId), 'skin');
  console.log(`  ${skin.result.state} after ${skin.polls} polls, ${skin.seconds.toFixed(1)} s`);
  if (skin.result.state === 'success' && skin.result.results) {
    const masksDir = resolve(outDir, 'masks/yc-skin-01');
    mkdirSync(masksDir, { recursive: true });
    for (const e of skin.result.results.output) {
      const url = e.mask_urls?.[0];
      if (!url || e.type === 'resize_image') continue;
      const asset = await client.fetchAsset(url);
      const ext = asset.contentType.includes('jpeg') ? 'jpg' : 'png';
      writeFileSync(resolve(masksDir, `${e.type}${e.region && e.region !== 'whole' ? '-' + e.region : ''}.${ext}`), asset.bytes);
    }
    console.log(`  saved masks to fixtures/recorded/masks/yc-skin-01/`);
  }
  const firstMask = skin.result.results?.output.find((e) => e.mask_urls?.[0] && e.type !== 'resize_image')?.mask_urls?.[0];
  await client.deleteTask(taskId);
  let maskAfterDelete = 'not checked';
  if (firstMask) {
    const r = await fetch(firstMask);
    maskAfterDelete = `HTTP ${r.status}`;
  }
  console.log(`  task deleted; mask URL after delete: ${maskAfterDelete}`);
  save('skin-analysis-sd.json', { recordedAt: new Date().toISOString(), sample: sample.id, dstActions: SD_ALL, polls: skin.polls, seconds: skin.seconds, maskAfterDelete, calls: recorded.splice(0) });

  // ---- Fitzpatrick: JPEG sample via public URL.
  spend('fitzpatrick v1.0', FITZPATRICK_UNITS);
  console.log(`3. Fitzpatrick, reserved ${FITZPATRICK_UNITS} units`);
  const jpg = SAMPLES.find((s) => s.id === 'yc-sample-1')!;
  const fTask = await client.startFitzpatrick({ url: jpg.url });
  const fitz = await pollUntilDone(() => client.pollFitzpatrick(fTask), 'fitzpatrick');
  console.log(`  ${fitz.result.state}: ${JSON.stringify(fitz.result.results ?? fitz.result.errorCode)}`);
  await client.deleteTask(fTask);
  save('fitzpatrick.json', { recordedAt: new Date().toISOString(), sample: jpg.id, polls: fitz.polls, seconds: fitz.seconds, calls: recorded.splice(0) });

  const after = await client.getBalance();
  console.log(`4. Balance ${before} -> ${after} (spent ${Math.round((before - after) * 100) / 100})`);
  save('balance-delta.json', { before, after, spent: before - after, tasks: ['skin-analysis v2.1 SD x16 (upload)', 'fitzpatrick v1.0 (url)'] });
  console.log(`Verification ledger now ${readLedger().spent}/${VERIFY_CAP}.`);
}

main().catch((err: unknown) => {
  // Never print request headers; errors from the client carry only status/code/message.
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : 'failed');
  process.exit(1);
});
