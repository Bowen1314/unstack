// Record the Unstack demo video (docs/demo.mp4, 1440×900, captions burned in) and its thumbnail
// (docs/demo-thumb.jpg). Drives a throwaway headless Chrome (temporary profile) over the DevTools protocol,
// injects a fake cursor, title cards and a caption bar, captures screencast frames and assembles them with ffmpeg.
//
// The recorder only talks to the local Unstack server. It never reads .env or any key: the server holds them.
//
//   Rehearsal (0 YouCam units). Start the server in demo mode first; without the Nebius key the label read is
//   answered inside the browser with a canned transcript, so nothing leaves the machine:
//     UNSTACK_FORCE_MOCK=1 UNSTACK_NEBIUS_API_KEY= npm start
//     OUT_DIR=/some/scratch node scripts/record_demo.mjs
//   Live take (spends 26 YouCam units: HD scan 16 + sun profile 10, and one Nebius label read):
//     UNSTACK_UNIT_CAP=<units already used + 26> npm start      # the server refuses anything beyond that
//     LIVE=1 node scripts/record_demo.mjs                         # writes docs/demo.mp4 and docs/demo-thumb.jpg
//
// Other settings: PARTS=a,b,c (record only some parts: a = shelf/check/plan, b = the YouCam scan and sun profile,
// c = experiments/privacy/outro), WORK_DIR=… (keep frames and the browser profile between runs, so a failed part
// can be re-recorded alone), ASSEMBLE=dirA,dirB,dirC (only rebuild the video from recorded part folders).
// Needs Node 22+ (global WebSocket), Google Chrome and ffmpeg. ffmpeg runs under `nice -n 10` with 2 threads.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = process.env.LIVE === "1";
const APP = (process.env.APP_URL || "http://127.0.0.1:8796").replace(/\/$/, "");
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(APP)) throw new Error("APP_URL must be the local Unstack server");
const OUT = process.env.OUT_DIR || (LIVE ? join(ROOT, "docs") : join(tmpdir(), "unstack-demo-rehearsal"));
const KEEP_WORK = Boolean(process.env.WORK_DIR);
const WORK = process.env.WORK_DIR || mkdtempSync(join(tmpdir(), "unstack-rec-"));
const PARTS = (process.env.PARTS || "a,b,c").split(",").map((s) => s.trim()).filter(Boolean);
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9351);
// The page is laid out at 1280×800 CSS px and captured at 2.25×, so frames and the video are 2880×1800
// (YouTube serves its better encodes only to uploads 1440 px tall or more). VIDEO_W=1440 gives a 1440×900 file.
const VW = 1280, VH = 800, DSF = 2.25, BAR = 56;
const W = Number(process.env.VIDEO_W || 2880), H = Math.round((W * VH) / VW);
const TIME_SCALE = Number(process.env.TIME_SCALE || 1); // >1 plays the whole take uniformly faster (assembly only)
const SCAN_UNITS = 16; // HD, 8 concerns (YouCam docs + live price list)
const SUN_UNITS = 10;
const SAMPLE_A = "https://plugins-media.makeupar.com/strapi/assets/skin_analysis_01_5b5defd339.png";
const TAG_LIVE = LIVE ? "Live YouCam API" : "Rehearsal · demo mode";

mkdirSync(OUT, { recursive: true });
mkdirSync(WORK, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ───────────── label image (rendered text, no photo of anything real) ───────────── */

const LABEL_INCI =
  "Aqua, Centella Asiatica Leaf Extract, Glycerin, Butylene Glycol, Panthenol, Madecassoside, Sodium Hyaluronate, " +
  "Allantoin, Ceramide NP, Cholesterol, Carbomer, Tromethamine, Ethylhexylglycerin, Phenoxyethanol.";
const LABEL_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#cfd6cf}
  .lab{position:absolute;left:40px;top:40px;width:820px;padding:34px 40px 30px;background:#fbfaf6;border-radius:18px;
    box-shadow:0 8px 30px rgba(0,0,0,.18);font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1d2a22}
  .top{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #2f6b4f;padding-bottom:12px}
  h1{margin:0;font-size:38px;letter-spacing:.01em;color:#2f6b4f} .vol{font-size:22px;color:#43524a}
  .sub{font-size:19px;color:#43524a;margin:10px 0 18px}
  h2{font-size:20px;margin:0 0 6px;letter-spacing:.08em}
  p.inci{font-size:23px;line-height:1.42;margin:0 0 18px}
  .small{font-size:15px;color:#5b6a62;line-height:1.4}
</style></head><body><div class="lab" id="lab">
  <div class="top"><h1>Centella Soothing Gel</h1><span class="vol">50 mL / 1.7 fl oz</span></div>
  <div class="sub">Lightweight gel moisturiser · fragrance free</div>
  <h2>INGREDIENTS:</h2>
  <p class="inci">${LABEL_INCI}</p>
  <div class="small">Directions: apply morning and evening after serums. Avoid contact with eyes. Test print made for the Unstack demo.</div>
</div></body></html>`;

/* ───────────── Chrome + CDP ───────────── */

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  "--use-mock-keychain", "--password-store=basic", "--hide-scrollbars", "--mute-audio", "--disable-sync",
  "--disable-background-networking", "--disable-component-update", "--disable-features=Translate,MediaRouter",
  // A real device scale factor (not an Emulation override), so screencast frames come at device pixels (2880 wide).
  // The window is taller than the page by the headless window frame (87 px); main() checks the result.
  `--force-device-scale-factor=${DSF}`, `--window-size=${VW},${VH + 87}`,
  `--user-data-dir=${join(WORK, "profile")}`, `--remote-debugging-port=${PORT}`, "about:blank",
], { stdio: "ignore" });

let ws, nextId = 1;
const pending = new Map();
let part = null; // { name, dir, frames: [], marks: {} }
let recording = false, speedup = 1;
let mockLabel = false;
const captionsLog = [];
const results = { scan: null, sun: null, sunPath: null, labelText: null, notes: [] };

async function connect() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("Chrome did not start");
}
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function js(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "eval failed");
  return r.result.value;
}
async function status() {
  const r = await fetch(`${APP}/api/status`);
  if (!r.ok) throw new Error(`GET /api/status answered ${r.status}`);
  return r.json();
}

/* ───────────── injected overlays (video only, not part of the app) ───────────── */

const OVERLAY_JS = `(() => {
  if (document.getElementById('__cap')) return true;
  const css = \`
    body{padding-bottom:${BAR}px!important}
    .toast{bottom:${BAR + 20}px!important}
    #__cap{position:fixed;left:0;right:0;bottom:0;height:${BAR}px;z-index:99998;display:flex;align-items:center;justify-content:center;
      background:#1b1f1c;color:#fff;font:600 18px/1.3 -apple-system,'Helvetica Neue',Helvetica,sans-serif;padding:0 32px;text-align:center;
      pointer-events:none;border-top:1px solid #2c332e;transition:opacity .25s}
    #__cap small{flex:none;font-weight:700;color:#9fd9b8;margin-right:12px;letter-spacing:.05em;text-transform:uppercase;font-size:11.5px;
      border:1px solid #4f7d63;border-radius:999px;padding:3px 9px}
    #__cap small.demo{color:#f3cf8c;border-color:#8a7140}
    #__cur{position:fixed;left:0;top:0;z-index:99999;pointer-events:none;transition:transform .55s cubic-bezier(.3,.7,.3,1);transform:translate(640px,400px)}
    #__card{position:fixed;inset:0;z-index:99997;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
      background:radial-gradient(1000px 640px at 50% 40%,#24392d,#121a15);color:#fff;font-family:-apple-system,'Helvetica Neue',Helvetica,sans-serif;
      text-align:center;padding:0 80px;transition:opacity .6s}
    #__card h1{font-size:60px;margin:0;letter-spacing:-.02em}
    #__card p{font-size:24px;margin:0;color:#d7e6dc;max-width:900px;line-height:1.35}
    #__card small{font-size:16px;color:#9db8a7;margin-top:8px;max-width:900px;line-height:1.4}
    #__tick{position:fixed;right:0;bottom:0;width:2px;height:2px;z-index:99999;pointer-events:none;animation:__t .2s steps(1) infinite}
    @keyframes __t{0%{background:#1b1f1c}50%{background:#1b1f1d}}
  \`;
  const sheet = new CSSStyleSheet(); sheet.replaceSync(css);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const de = document.documentElement;
  const cap = document.createElement('div'); cap.id = '__cap'; cap.style.opacity = 0; de.appendChild(cap);
  const cur = document.createElement('div'); cur.id = '__cur';
  cur.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M4 2l15 9.5-6.6 1.3 3.9 7.4-2.7 1.4-3.9-7.4L4 19z" fill="#111" stroke="#fff" stroke-width="1.5"/></svg>';
  de.appendChild(cur);
  const card = document.createElement('div'); card.id = '__card'; card.style.opacity = 0; card.style.display = 'none'; de.appendChild(card);
  const tick = document.createElement('div'); tick.id = '__tick'; de.appendChild(tick); // keeps frames flowing during static holds
  return true;
})()`;
const ensureOverlays = () => js(OVERLAY_JS);

function videoTime() {
  // Rough position within the current part, for the log only.
  if (!part || part.frames.length < 2) return 0;
  let t = 0;
  for (let i = 0; i < part.frames.length - 1; i++) t += (part.frames[i + 1].t - part.frames[i].t) / part.frames[i].speedup;
  return t;
}
async function caption(t, tag) {
  const cls = /demo history|rehearsal/i.test(tag || "") ? "demo" : "";
  await js(`(()=>{const c=document.getElementById('__cap'); c.innerHTML=${JSON.stringify((tag ? `<small class="${cls}">${tag}</small>` : "") + "<span></span>")}; c.lastChild.textContent=${JSON.stringify(t)}; c.style.opacity=${t ? 1 : 0};})()`);
  if (t) captionsLog.push({ part: part?.name, at: videoTime().toFixed(1), tag: tag || "", text: t });
}
// Read time: about 16 characters a second plus a beat, never under 2.6 s.
const readMs = (t) => Math.max(2600, 1000 + t.length * 58);
async function say(t, opts = {}) {
  await caption(t, opts.tag);
  await sleep(opts.ms ?? readMs(t));
}
const setCursorVisible = (on) => js(`(()=>{const e=document.getElementById('__cur'); if(e) e.style.visibility=${on ? "'visible'" : "'hidden'"}})()`);

async function moveTo(x, y, wait = 650) {
  await js(`document.getElementById('__cur').style.transform='translate(${Math.round(x - 3)}px,${Math.round(y - 2)}px)'`);
  await sleep(wait);
}
const byText = (sel, text, exact = false) =>
  `[...document.querySelectorAll(${JSON.stringify(sel)})].find(e=>{const t=e.textContent.replace(/\\s+/g,' ').trim(); return ${exact ? "t===" : "t.startsWith("}${JSON.stringify(text)}${exact ? "" : ")"} && !e.disabled;})`;
// Bring an element into the visible band (below the sticky header, above the caption bar), smoothly if it moves.
async function reveal(finder, where = "nearest", ms = 900) {
  const moved = await js(`(()=>{const e=(${finder}); if(!e) return null; const r=e.getBoundingClientRect(); const top=68, bottom=innerHeight-${BAR}-12;
    let y=null; const where=${JSON.stringify(where)};
    if(where==='top') y=scrollY+r.top-top;
    else if(where==='center') y=scrollY+r.top+r.height/2-(top+bottom)/2;
    else if(r.top<top) y=scrollY+r.top-top; else if(r.bottom>bottom) y=scrollY+Math.min(r.bottom-bottom, r.top-top);
    if(y===null||Math.abs(y-scrollY)<4) return false; scrollTo({top:Math.max(0,y),behavior:'smooth'}); return true;})()`);
  if (moved === null) return null;
  if (moved) await sleep(ms);
  return true;
}
const rectOf = (finder) => js(`(()=>{const e=(${finder}); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,l:r.left,t:r.top,w:r.width,h:r.height};})()`);
async function mouse(type, x, y, buttons = 1) {
  await send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 });
}
async function clickEl(finder, { where = "nearest", dx = 0 } = {}) {
  if ((await reveal(finder, where)) === null) throw new Error("not found: " + finder.slice(0, 140));
  const p = await rectOf(finder);
  const x = dx ? p.l + dx : p.x;
  await moveTo(x, p.y);
  await mouse("mousePressed", x, p.y);
  await sleep(70);
  await mouse("mouseReleased", x, p.y, 0);
  await sleep(300);
}
async function pointAt(finder, { wait = 700, where = "nearest", dx = null } = {}) {
  if ((await reveal(finder, where)) === null) return null;
  const p = await rectOf(finder);
  if (p) await moveTo(dx === null ? p.x : p.l + dx, p.y, wait);
  return p;
}
async function scrollToY(y, ms = 1000) {
  await js(`scrollTo({top:${y},behavior:'smooth'})`);
  await sleep(ms);
}
async function waitFor(expr, timeoutMs = 60000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await js(`!!(${expr})`)) return Date.now() - t0;
    await sleep(200);
  }
  throw new Error("timeout waiting for " + label.slice(0, 160));
}
async function typeText(text, perChar = 45) {
  for (const ch of text) {
    await send("Input.insertText", { text: ch });
    await sleep(perChar);
  }
}
// Set a React-controlled <select> the way a user change would.
const selectValue = (finder, value) =>
  js(`(()=>{const e=(${finder}); const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('change',{bubbles:true})); return e.value;})()`);
// Put a file into an <input type=file> (what the OS file picker would do), from a URL or base64 bytes.
async function setFile(inputFinder, { url, b64, name, type }) {
  return js(`(async()=>{const input=(${inputFinder}); if(!input) throw new Error('file input not found');
    let blob; ${url ? `const r=await fetch(${JSON.stringify(url)},{mode:'cors',cache:'no-store'}); if(!r.ok) throw new Error('download '+r.status); blob=await r.blob();`
      : `const bin=atob(${JSON.stringify(b64 || "")}); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); blob=new Blob([u]);`}
    const f=new File([blob], ${JSON.stringify(name)}, {type:${JSON.stringify(type)}}); const dt=new DataTransfer(); dt.items.add(f);
    input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true})); return f.size;})()`);
}
async function titleCard(on, html) {
  if (on) await js(`(()=>{const c=document.getElementById('__card'); c.innerHTML=${JSON.stringify(html)}; c.style.display='flex'; requestAnimationFrame(()=>{c.style.opacity=1});})()`);
  else await js(`(()=>{const c=document.getElementById('__card'); c.style.opacity=0; setTimeout(()=>{c.style.display='none'},650)})()`);
}
const nav = (label) => clickEl(`[...document.querySelectorAll('.nav a')].find(a=>a.textContent.trim().startsWith(${JSON.stringify(label)}))`);
const mark = (name) => { part.marks[name] = part.frames.length; };
const pageText = () => js("document.body.innerText");

/* ───────────── parts (frames per part, so a part can be re-recorded alone) ───────────── */

function beginPart(name) {
  const dir = join(WORK, "parts", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  part = { name, dir, frames: [], marks: {} };
}
function savePart(ok) {
  if (!part) return;
  writeFileSync(join(part.dir, "frames.json"), JSON.stringify({ ok, frames: part.frames, marks: part.marks }));
  log(`part ${part.name}: ${part.frames.length} frames, ${ok ? "complete" : "INCOMPLETE"} -> ${part.dir}`);
}
async function startRec() {
  recording = true;
  await sleep(150);
}
async function cut() {
  // Stop recording; the last frame is held briefly and the next recorded frame follows directly.
  recording = false;
  if (part.frames.length) part.frames[part.frames.length - 1].cut = true;
}

async function partA() {
  beginPart("a");
  // A fresh device: welcome screen, no consent.
  await send("Page.navigate", { url: `${APP}/#/shelf` });
  await waitFor(`!!document.querySelector('.site-header') && !!document.querySelector('.header-pills .pill--live, .header-pills .pill--demo')`, 30000, "app header with mode pill");
  await ensureOverlays();
  await js(`scrollTo(0,0)`);
  await sleep(800);
  await startRec();

  /* 1. title */
  mark("1 title");
  await titleCard(true, `<h1>Unstack</h1><p>Check your skincare shelf before you layer it, then change one thing at a time.</p>` +
    `<small>Built on the YouCam Skin Analysis API · ${LIVE ? "recorded against the live YouCam API" : "rehearsal in demo mode"} · no voice-over</small>`);
  await sleep(2600);
  await titleCard(false);
  await sleep(500);
  await pointAt(`document.querySelector('.header-pills .pill')`, { wait: 400 });
  await say(LIVE ? "Live · YouCam: scans in this video are real YouCam API calls, made by the Unstack server, which holds the key" : "Rehearsal: demo mode replays recorded YouCam responses", { ms: LIVE ? 3800 : 2400 });
  await clickEl(byText("button", "Load demo shelf"));
  await waitFor(`!!document.querySelector('.product-list')`, 8000, "shelf list");
  await sleep(300);

  /* 2. shelf + label photo */
  mark("2 shelf");
  await caption("A demo shelf of nine generic products (three exfoliants, a retinoid, no sunscreen), each with the ingredient families Unstack recognised");
  await pointAt(`document.querySelector('.product-list li:nth-child(2)')`, { wait: 300 });
  await scrollToY(360, 1500);
  await sleep(900);
  await scrollToY(0, 700);
  await clickEl(`[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.trim()==='Label photo')`);
  await say("Add a product from a photo of its label (a test print made for this demo)", { ms: 2600 });

  const labelB64 = await renderLabel();
  const before = await status();
  if (LIVE && !before.llm.enabled) throw new Error("LIVE take needs the label reader (UNSTACK_NEBIUS_API_KEY on the server)");
  await pointAt(`document.querySelector('label.dropzone')`, { wait: 500 });
  const tagNebius = mockLabel ? "Rehearsal · canned transcript" : "Live · Nebius";
  await caption("The photo goes once to a vision model, MiniCPM-V on Nebius Token Factory, which transcribes the ingredient list (wait sped up 2×)", tagNebius);
  await setFile(`document.querySelector('label.dropzone input[type=file]')`, { b64: labelB64, name: "label.jpg", type: "image/jpeg" });
  const t0 = Date.now();
  await sleep(1200);
  speedup = 2;
  await waitFor(`!!document.querySelector('textarea.textarea') && document.querySelector('textarea.textarea').value.length>20 || /Label reading|out of credit|returned an error|could be read|did not answer|spending cap/.test(document.body.innerText)`, 120000, "label transcript");
  speedup = 1;
  const readMsTook = Date.now() - t0;
  const transcript = await js(`(document.querySelector('textarea.textarea')||{}).value||''`);
  if (!transcript) {
    const err = await js(`(document.querySelector('.banner[role=alert]')||{}).innerText||''`);
    throw new Error("label read failed: " + err.replace(/\s+/g, " ").slice(0, 200));
  }
  results.labelText = transcript;
  log(`label read in ${(readMsTook / 1000).toFixed(1)} s${mockLabel ? " (canned, rehearsal)" : " (Nebius)"}: ${transcript.slice(0, 140)}`);
  await sleep(300);
  await pointAt(`document.querySelector('form .banner')`, { wait: 400 });
  await say("The transcript comes back for review, with the model and the cost of the read. Nothing is saved until you add it", { ms: 3900 });
  await clickEl(`document.querySelector('form input.input')`);
  await caption("Recognised families update as you review: here humectants, soothing agents and barrier lipids");
  await typeText("Centella Soothing Gel", 30);
  await selectValue(`[...document.querySelectorAll('form select')][0]`, "moisturizer");
  await selectValue(`[...document.querySelectorAll('form select')][1]`, "both");
  await pointAt(`[...document.querySelectorAll('form .eyebrow')].find(e=>e.textContent.startsWith('Recognised'))`, { wait: 1800, where: "center" });
  await clickEl(byText("form button[type=submit]", "Add to shelf"));
  await sleep(900);

  /* 3. check */
  mark("3 check");
  await nav("Check");
  await waitFor(`!!document.querySelector('.summary-strip')`, 8000, "check summary");
  await sleep(300);
  await pointAt(`document.querySelector('.summary-strip')`, { wait: 400 });
  await say("The shelf check flags layering conflicts, duplicate actives and missing sunscreen, by priority", { ms: 3000 });
  await reveal(`document.querySelector('.finding--high')`, "top", 800);
  await pointAt(`document.querySelector('.finding--high .sources a')`, { wait: 400 });
  await say("Each finding states how strong the evidence is and links its sources (FDA, DailyMed, AAD and others)", { ms: 3300 });
  await reveal(`document.querySelector('.finding--cleared')`, "top", 1200);
  await pointAt(`document.querySelector('.finding--cleared h3')`, { wait: 300 });
  await say("It also says which popular worries are not conflicts. Cosmetic guidance, not medical advice", { ms: 3100 });

  /* 4. plan */
  mark("4 plan");
  await nav("Plan");
  await waitFor(`!!document.querySelector('.plan-week')`, 8000, "plan grid");
  await sleep(300);
  await pointAt(`document.querySelector('.plan-week .plan-day:nth-child(2) .plan-cell--pm')`, { wait: 400 });
  await say("The weekly plan: conflicting actives never share a session, the retinoid stays at night, with rest nights in between", { ms: 3800 });
  savePart(true);
}

async function partB() {
  beginPart("b");
  await ensureOverlays();
  await js(`scrollTo(0,0)`);
  await startRec();

  /* 5. consent, photo, concerns, cost */
  mark("5 scan setup");
  await nav("Scan");
  await waitFor(`!!document.querySelector('.consent')`, 8000, "consent card (fresh profile expected)");
  await sleep(300);
  await pointAt(`document.querySelector('.consent h2')`, { wait: 400 });
  await say("Before any photo can be chosen, Unstack asks for consent: what is sent, why, and where it is deleted", { ms: 3600 });
  await clickEl(`document.querySelector('.consent label.check input')`);
  await clickEl(byText(".consent button", "I agree"));
  await waitFor(`!!document.querySelector('.scan-layout')`, 10000, "scan form after consent");
  await sleep(300);
  await clickEl(`[...document.querySelectorAll('.seg label')].find(l=>l.textContent.trim()==='Upload')`);
  await pointAt(`document.querySelector('label.dropzone')`, { wait: 300 });
  await caption("Sample A, a face from YouCam's own documentation (loaded from YouCam's CDN), sent as a file upload");
  await setFile(`document.querySelector('label.dropzone input[type=file]')`, { url: SAMPLE_A, name: "youcam-sample-a.png", type: "image/png" });
  await waitFor(`!!document.querySelector('.photo-chosen')`, 20000, "chosen photo");
  await sleep(2200);
  await reveal(`document.querySelector('.cost-box')`, "top", 800);
  await waitFor(`document.querySelector('.cost-n') && document.querySelector('.cost-n').textContent.trim()!=='—'`, 5000, "cost figure");
  const cost = await js(`document.querySelector('.cost-n').textContent.trim()`);
  const hd = await js(`!!document.querySelector('input[name=scan-quality][value=hd]:checked')`);
  log(`cost panel: ${cost} units, HD ${hd}`);
  if (Number(cost) !== SCAN_UNITS || !hd) throw new Error(`expected an HD scan at ${SCAN_UNITS} units, the panel says ${cost} (HD ${hd}); not pressing the button`);
  await pointAt(`document.querySelector('.cost-figure')`, { wait: 400 });
  await say(`Eight concerns at HD: ${SCAN_UNITS} units. Cost, live price list and YouCam balance are shown before you press the button`, { ms: 4200 });

  /* 6. the live scan */
  mark("6 scan");
  if (LIVE) {
    const s = await status();
    if (s.mode !== "live") throw new Error("server is not in live mode");
    if (s.units.available < SCAN_UNITS + SUN_UNITS) throw new Error(`unit ledger has ${s.units.available} available, need ${SCAN_UNITS + SUN_UNITS}`);
    log(`before the scan: YouCam balance ${s.youcamBalance}, ledger ${s.units.used} used / ${s.units.cap} cap`);
    results.balanceBefore = s.youcamBalance;
  }
  await clickEl(byText(".cost-box button", "Analyse with YouCam"));
  const scanStart = Date.now();
  await waitFor(`!!document.querySelector('.stepper')`, 15000, "progress stepper");
  await caption("Each step is a real YouCam API call: an upload slot and presigned PUT, then the skin-analysis task, polled until it finishes", TAG_LIVE);
  await sleep(700);
  await pointAt(`document.querySelector('.stepper .is-current, .stepper li:nth-child(2)')`, { wait: 400 });
  await waitFor(`!!document.querySelector('.results-top') || !!document.querySelector('.stepper .is-error')`, 200000, "scan result or error");
  const scanMs = Date.now() - scanStart;
  if (await js(`!!document.querySelector('.stepper .is-error')`)) {
    const err = await js(`(document.querySelector('.banner[role=alert]')||{}).innerText||''`);
    throw new Error(`scan failed after ${(scanMs / 1000).toFixed(1)} s (YouCam charges nothing for failed tasks): ${err.replace(/\s+/g, " ").slice(0, 200)}`);
  }
  log(`scan finished in ${(scanMs / 1000).toFixed(1)} s`);
  await sleep(300);

  /* 7. results */
  mark("7 results");
  await js(`scrollTo(0,0)`);
  const tags = await js(`[...document.querySelectorAll('.page-head ~ .stack-lg .tag, .stack-sm .row .tag')].map(t=>t.textContent.trim()).join(' | ')`);
  const summary = await js(`(()=>{const n=[...document.querySelectorAll('.big-stat .big-n')].map(e=>e.childNodes[0].textContent.trim()); return {overall:n[0], age:n[1], masked:(document.querySelector('.photo-panel .xs.subtle')||{}).textContent}})()`);
  results.scan = { ms: scanMs, tags, ...summary };
  log("result tags:", tags, "| overall", summary.overall, "| skin age", summary.age, "|", summary.masked);
  if (LIVE && !/Deleted at YouCam/.test(tags)) results.notes.push("result did not show 'Deleted at YouCam'");
  await pointAt(byText(".tag", "Deleted at YouCam"), { wait: 300 });
  await say(`Done in ${Math.round(scanMs / 1000)} s. Masks copied, then task/delete removed the photo and results at YouCam (“Deleted at YouCam”). Units are charged only on success`, { tag: TAG_LIVE, ms: 5400 });
  await reveal(`document.querySelector('.results-top')`, "top", 800);
  for (const label of ["Hydration", "Pores", "Redness"]) {
    const btn = `[...document.querySelectorAll('.overlay-picker button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
    if (!(await js(`!!(${btn})`))) continue;
    await clickEl(btn);
    if (label === "Hydration") await caption(`YouCam's own masks for this photo, drawn by Unstack over it: ${label.toLowerCase()}, pores, redness`, TAG_LIVE);
    await sleep(label === "Hydration" ? 2000 : 1600);
    if (label === (process.env.THUMB_MASK || "Redness")) await thumbnail();
  }
  await pointAt(`document.querySelector('.headline-scores')`, { wait: 400 });
  await say(`Overall ${summary.overall}/100 and skin age ${summary.age}, shown as appearance scores, with skin type by zone`, { ms: 3000 });
  await reveal(`document.getElementById('cov-h')`, "top", 1100);
  await pointAt(`document.getElementById('cov-h')`, { wait: 300 });
  await say("The concerns the scan flagged are mapped to your shelf, including products that target none of them", { ms: 3400 });

  /* 8. sun profile */
  mark("8 sun profile");
  await clickEl(byText(".page-head button", "New scan"));
  await waitFor(`!!document.querySelector('.scan-layout')`, 5000, "scan setup");
  const sunCard = `[...document.querySelectorAll('section.card')].find(s=>s.querySelector('h2') && s.querySelector('h2').textContent.trim()==='Sun profile')`;
  await reveal(sunCard, "top", 1000);
  const sunBtn = `[...(${sunCard}).querySelectorAll('button')].find(b=>b.textContent.includes('Analyse with YouCam'))`;
  const sunLabel = await js(`(${sunBtn}).textContent`);
  if (LIVE && !sunLabel.includes(`${SUN_UNITS} units`)) throw new Error("unexpected sun profile price: " + sunLabel);
  await pointAt(sunBtn, { wait: 400 });
  await caption(`Optional sun profile: YouCam's Fitzpatrick analyser, ${SUN_UNITS} units. Sample A is re-encoded to JPEG in the browser and uploaded`, TAG_LIVE);
  let sun = await runSun(sunCard, sunBtn);
  results.sunPath = "Sample A, JPEG upload (src_file_id)";
  if (!sun.ok && process.env.FITZ_FALLBACK !== "0") {
    log("sun profile by upload failed:", sun.error, "-> fallback: Sample B by URL");
    results.notes.push("Fitzpatrick by upload failed: " + sun.error);
    await cut();
    await js(`(()=>{const b=[...(${sunCard}).querySelectorAll('button.link-btn')].find(b=>b.textContent.trim()==='Dismiss'); if(b) b.click();})()`);
    await js(`scrollTo(0,0)`);
    await js(`[...document.querySelectorAll('.seg label')].find(l=>l.textContent.includes('YouCam samples')).querySelector('input').click()`);
    await waitFor(`[...document.querySelectorAll('.sample')].some(b=>b.textContent.includes('Sample B'))`, 15000, "sample list");
    await js(`[...document.querySelectorAll('.sample')].find(b=>b.textContent.includes('Sample B')).click()`);
    await sleep(800);
    await reveal(sunCard, "top", 0);
    await sleep(500);
    await startRec();
    await pointAt(sunBtn, { wait: 400 });
    await caption(`Optional sun profile: YouCam's Fitzpatrick analyser, ${SUN_UNITS} units, on Sample B (a JPEG sent by URL)`, TAG_LIVE);
    sun = await runSun(sunCard, sunBtn);
    results.sunPath = "Sample B by URL (src_file_url), after the upload path failed";
  }
  if (!sun.ok) throw new Error("sun profile failed: " + sun.error);
  results.sun = sun;
  log(`sun profile: ${sun.title} in ${(sun.ms / 1000).toFixed(1)} s via ${results.sunPath}`);
  await say(`${sun.title}. It only raises the priority of the sunscreen finding and is never used as a diagnosis`, { ms: 3600 });
  await nav("Check");
  await waitFor(`!!document.querySelector('.context-line')`, 8000, "check context line");
  await sleep(300);
  const cites = await js(`/Fitzpatrick type \\(/.test((document.querySelector('.finding--high')||{}).textContent||'')`);
  if (cites) {
    await reveal(`document.querySelector('.finding--high')`, "top", 800);
    await pointAt(`document.querySelector('.finding--high p.small')`, { wait: 300, dx: 220 });
  } else await pointAt(`[...document.querySelectorAll('.context-line > span')][1]`, { wait: 300 });
  await say(cites ? "Back on Check: the no-sunscreen finding now cites the Fitzpatrick type from YouCam" : "Back on Check: the sun profile from YouCam is now in use", { ms: 3000 });
  if (LIVE) {
    await sleep(500);
    const s = await status();
    results.ledgerAfter = s.units;
  }
  savePart(true);
}

async function runSun(sunCard, sunBtn) {
  await clickEl(sunBtn);
  const t0 = Date.now();
  await waitFor(`[...(${sunCard}).querySelectorAll('.banner')].some(b=>/Sun profile saved|stopped|failed|error|Error|JPEG|Photo/.test(b.textContent)) || !!(${sunCard}).querySelector('.banner[role=alert]')`, 200000, "sun profile result");
  const ms = Date.now() - t0;
  const ok = await js(`[...(${sunCard}).querySelectorAll('.banner')].some(b=>/Sun profile saved/.test(b.textContent))`);
  if (ok) {
    const title = await js(`[...(${sunCard}).querySelectorAll('.banner')].find(b=>/Sun profile saved/.test(b.textContent)).querySelector('strong, .banner-title, h3, p').textContent.trim()`).catch(() => "Sun profile saved");
    await pointAt(`[...(${sunCard}).querySelectorAll('.banner')].find(b=>/Sun profile saved/.test(b.textContent))`, { wait: 300 });
    return { ok: true, ms, title: /Sun profile saved/.test(title) ? title : "Sun profile saved" };
  }
  const error = await js(`(${sunCard}).querySelector('.banner[role=alert]') ? (${sunCard}).querySelector('.banner[role=alert]').innerText.replace(/\\s+/g,' ') : ''`);
  return { ok: false, ms, error };
}

async function partC() {
  beginPart("c");
  await ensureOverlays();
  await js(`scrollTo(0,0)`);
  await startRec();

  /* 9. experiments (demo history) */
  mark("9 experiments");
  await nav("Experiments");
  await waitFor(`!!document.querySelector('.page-head')`, 5000, "experiments head");
  await sleep(400);
  const loadBtn = byText("button", "Load demo history");
  if (await js(`!!(${loadBtn})`)) await clickEl(loadBtn);
  await waitFor(`!!document.querySelector('.chart-grid')`, 8000, "experiment charts");
  await sleep(300);
  await pointAt(byText(".ribbon, .demo-ribbon, span", "Demo data", true), { wait: 400 });
  await say("Experiments, shown with synthetic demo history (not real scans), so you can see six weeks without waiting", { tag: "Demo history", ms: 3400 });
  await reveal(`document.querySelector('.chart-grid')`, "top", 1100);
  await say("Change one product, rescan every two weeks, compare with the baseline inside a noise band measured from two baseline scans", { tag: "Demo history", ms: 4200 });
  await reveal(`document.querySelector('.confounders')`, "center", 1100);
  await pointAt(`document.querySelector('.confounders li')`, { wait: 300 });
  await say("Unstack also warns when something else changed during the experiment", { tag: "Demo history", ms: 2600 });

  /* 10. privacy */
  mark("10 privacy");
  await nav("Privacy");
  await waitFor(`!!document.querySelector('.flow')`, 5000, "privacy flow");
  await sleep(300);
  await pointAt(`document.querySelector('.flow li:nth-child(3)')`, { wait: 400 });
  await say("No accounts. The photo is held in server memory, analysed at YouCam, then deleted there; scores stay in this browser", { ms: 4000 });
  await reveal(`document.querySelector('.meter')`, "center", 1000);
  await pointAt(`document.querySelector('.meter')`, { wait: 300 });
  await say("The server keeps only a unit ledger with a hard cap and anonymous consent receipts", { ms: 3000 });
  await pointAt(byText("button", "Withdraw consent"), { wait: 300 });
  await caption("Consent can be withdrawn, and one button deletes everything stored on this device");
  await sleep(1500);
  await pointAt(byText("button", "Delete everything"), { wait: 1900, where: "center" });

  /* 11. outro */
  mark("11 outro");
  await caption("");
  await titleCard(true, `<h1>Unstack</h1><p>Built on the YouCam Skin Analysis API, the Fitzpatrick Skin Type API and the JS Camera Kit</p><small>github.com/Bowen1314/unstack</small>`);
  await sleep(3400);
  mark("end");
  await cut();
  savePart(true);
}

/* ───────────── helpers that run outside the recording ───────────── */

async function renderLabel() {
  // Render the label in a second tab and screenshot it as a JPEG "photo" (rendered text, nothing real).
  const { targetId } = await send("Target.createTarget", { url: "about:blank", newWindow: false, background: true });
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const t = list.find((x) => x.id === targetId);
  const tw = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (tw.onopen = r));
  let id = 1;
  const pend = new Map();
  tw.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const s2 = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); tw.send(JSON.stringify({ id: i, method, params })); });
  await s2("Emulation.setDeviceMetricsOverride", { width: 940, height: 640, deviceScaleFactor: 1.5, mobile: false });
  await s2("Page.navigate", { url: "data:text/html;base64," + Buffer.from(LABEL_HTML).toString("base64") });
  await sleep(700);
  const shot = await s2("Page.captureScreenshot", { format: "jpeg", quality: 88, clip: { x: 0, y: 0, width: 940, height: 600, scale: 1 } });
  tw.close();
  await send("Target.closeTarget", { targetId });
  const b64 = shot.result.data;
  writeFileSync(join(WORK, "label.jpg"), Buffer.from(b64, "base64"));
  return b64;
}

async function thumbnail() {
  // A sharp 3:2 frame of the scan result (photo with mask + summary), without cursor or caption.
  // Recording pauses meanwhile, so the hidden caption never reaches the video.
  await cut();
  await setCursorVisible(false);
  await js(`document.getElementById('__cap').style.visibility='hidden'`);
  await sleep(250);
  const r = await rectOf(`document.querySelector('.results-top')`);
  const top = Math.max(r.t - 14, 64), bottom = VH - BAR - 6;
  let h = bottom - top, w = h * 1.5;
  if (w > r.w + 28) { w = r.w + 28; h = w / 1.5; }
  const x = Math.max(0, r.x - w / 2);
  const shot = await send("Page.captureScreenshot", { format: "png", clip: { x, y: top, width: w, height: h, scale: 1 } });
  const png = join(WORK, "thumb.png");
  writeFileSync(png, Buffer.from(shot.data, "base64"));
  await js(`document.getElementById('__cap').style.visibility='visible'`);
  await setCursorVisible(true);
  await sleep(150);
  await startRec();
  results.thumbPng = png;
}
function writeThumb() {
  if (!results.thumbPng) return;
  const out = join(OUT, "demo-thumb.jpg");
  execFileSync("nice", ["-n", "10", "ffmpeg", "-y", "-loglevel", "error", "-threads", "2", "-i", results.thumbPng, "-vf", "scale=1500:1000:flags=lanczos", "-q:v", "2", out]);
  log("thumbnail ->", out);
}

/* ───────────── main ───────────── */

async function main() {
  const s0 = await status();
  log(`server: mode ${s0.mode}, label reader ${s0.llm.enabled ? "on" : "off"}, ledger ${s0.units.used}/${s0.units.cap} (available ${s0.units.available}), YouCam balance ${s0.youcamBalance}`);
  if (LIVE && s0.mode !== "live") throw new Error("LIVE=1 needs the server in live mode");
  if (!LIVE && s0.mode !== "mock") throw new Error("rehearsal needs the server in demo mode (UNSTACK_FORCE_MOCK=1); refusing to spend units");
  mockLabel = !LIVE && !s0.llm.enabled;
  if (LIVE && PARTS.includes("b") && s0.units.available < SCAN_UNITS + SUN_UNITS) throw new Error("the unit ledger cannot cover one take");

  ws = new WebSocket(await connect());
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    } else if (msg.method === "Page.screencastFrame") {
      const { data, sessionId, metadata } = msg.params;
      send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      if (recording && part) {
        const file = join(part.dir, `f${String(part.frames.length).padStart(6, "0")}.jpg`);
        writeFileSync(file, Buffer.from(data, "base64"));
        part.frames.push({ t: metadata.timestamp, file, speedup, cut: false });
      }
    } else if (msg.method === "Fetch.requestPaused") {
      // Rehearsal only: answer the label read in the browser so nothing goes to Nebius.
      const body = JSON.stringify({ text: LABEL_INCI.replace(/\.$/, ""), model: "openbmb/MiniCPM-V-4_5", costUsd: 0.0012, mock: true });
      setTimeout(() => send("Fetch.fulfillRequest", { requestId: msg.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(body).toString("base64") }).catch(() => {}), 3500);
    }
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  if (mockLabel) await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/label-read*", requestStage: "Request" }] });
  await send("Page.navigate", { url: `${APP}/#/shelf` });
  await waitFor(`!!document.querySelector('.site-header')`, 30000, "app");
  const vp = await js(`[innerWidth, innerHeight, devicePixelRatio]`);
  if (vp[0] !== VW || vp[1] !== VH || vp[2] !== DSF) {
    log(`viewport ${vp.join(" × ")}, correcting to ${VW}×${VH}`);
    await send("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: 0, mobile: false });
  }
  await send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 2 });

  if (PARTS.includes("a")) await partA();
  if (PARTS.includes("b")) await partB();
  if (PARTS.includes("c")) await partC();
  await send("Page.stopScreencast");
  if (LIVE) {
    await sleep(2000);
    const s = await status();
    results.balanceAfter = s.youcamBalance;
    results.ledgerAfter = s.units;
  }
}

/* ───────────── assemble ───────────── */

function assemble(dirs) {
  const kept = [];
  const scenes = [];
  let t = 0;
  for (const dir of dirs) {
    const meta = JSON.parse(readFileSync(join(dir, "frames.json"), "utf8"));
    if (!meta.ok) log(`warning: ${dir} is an incomplete part`);
    const byIndex = new Map(Object.entries(meta.marks).map(([k, i]) => [i, k]));
    const fr = meta.frames;
    for (let i = 0; i < fr.length; i++) {
      for (const [idx, name] of byIndex) if (idx === i) scenes.push([name, t]);
      const f = fr[i], next = fr[i + 1];
      let dur = (!next || f.cut ? 0.3 : (next.t - f.t) / f.speedup) / TIME_SCALE;
      dur = Math.min(Math.max(dur, 0.001), 10);
      t += dur;
      if (dur < 0.012 && kept.length) kept[kept.length - 1].dur += dur;
      else kept.push({ file: f.file, dur });
    }
    for (const [idx, name] of byIndex) if (idx >= fr.length) scenes.push([name, t]);
  }
  const lines = kept.map((k) => `file '${k.file}'\nduration ${k.dur.toFixed(4)}`);
  lines.push(`file '${kept[kept.length - 1].file}'`);
  const concat = join(WORK, "frames.txt");
  writeFileSync(concat, lines.join("\n") + "\n");
  const mp4 = join(OUT, "demo.mp4");
  execFileSync("nice", ["-n", "10", "ffmpeg", "-y", "-loglevel", "error", "-threads", "2", "-f", "concat", "-safe", "0", "-i", concat,
    "-vf", `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", W >= 2880 ? "17" : "20", "-threads", "2",
    "-movflags", "+faststart", "-an", mp4]);
  log(`video ${t.toFixed(1)} s (${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}) -> ${mp4}`);
  for (const [name, at] of scenes) log(`  ${Math.floor(at / 60)}:${(at % 60).toFixed(1).padStart(4, "0")}  ${name}`);
  if (t < 60 || t > 175) log(`!! length ${t.toFixed(1)} s is outside 1:00–2:55`);
  writeFileSync(join(WORK, "scenes.json"), JSON.stringify({ length: t, scenes, captions: captionsLog, results }, null, 2));
  return t;
}

let failed = false;
try {
  if (process.env.ASSEMBLE) {
    chrome.kill("SIGKILL");
    assemble(process.env.ASSEMBLE.split(","));
  } else {
    await main();
    const dirs = ["a", "b", "c"].map((p) => join(WORK, "parts", p)).filter((d) => existsSync(join(d, "frames.json")));
    writeThumb();
    assemble(dirs);
  }
  log("results:", JSON.stringify(results));
} catch (e) {
  failed = true;
  console.error("FAILED:", e.stack || e.message);
  try { savePart(false); } catch {}
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  chrome.kill("SIGKILL");
  await sleep(300);
  if (!KEEP_WORK) rmSync(WORK, { recursive: true, force: true });
  else log("work dir kept:", WORK);
  if (failed) log("failed take: see the log above");
}
