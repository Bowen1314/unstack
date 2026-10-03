// Add the voice-over to the demo video, reusing the frames recorded by scripts/record_demo.mjs (no new take).
//
//   EDGE_TTS=/path/to/venv/bin/edge-tts PARTS_DIR=<record_demo WORK_DIR>/parts node scripts/narrate_demo.mjs
//
// 1. Reads docs/narration.md (one line per scene) and makes one clip per scene with edge-tts
//    (voice en-US-AvaNeural by default; macOS `say` only if edge-tts fails). Clips are cached by text.
// 2. Re-times the frames so each scene lasts at least LEAD + clip + TAIL. Only still frames (nothing on screen
//    moving) are held longer or shortened; actions keep their recorded speed. The total stays within MAX_SECONDS,
//    otherwise it stops and asks for shorter lines.
// 3. Mixes the clips at their scene starts, normalises to -16 LUFS (two-pass loudnorm), and encodes docs/demo.mp4:
//    H.264 CRF 17, 30 fps, yuv420p limited range (BT.709), AAC 160 kbps, faststart. Captions stay burned in.
// ffmpeg runs under `nice -n 10` with 2 threads, and waits while another record_demo.mjs or ffmpeg is running.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PARTS_DIR = process.env.PARTS_DIR;
if (!PARTS_DIR) throw new Error("PARTS_DIR=<record_demo WORK_DIR>/parts is required");
const CLIPS = process.env.CLIPS_DIR || join(PARTS_DIR, "..", "tts");
const EDGE_TTS = process.env.EDGE_TTS || "edge-tts";
const VOICE = process.env.VOICE || "en-US-AvaNeural";
const OUT = process.env.OUT || join(ROOT, "docs", "demo.mp4");
const MAX_SECONDS = Number(process.env.MAX_SECONDS || 174.6); // hard limit 2:55, with a little margin
const LEAD = 0.3, TAIL = 0.45; // seconds before and after each line inside its scene
const W = Number(process.env.VIDEO_W || 2880), H = Math.round((W * 800) / 1280);
const KEEP_MIN = 0.55; // a still stretch is never shortened below this share of its recorded length
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
mkdirSync(CLIPS, { recursive: true });

/* 1. narration lines and clips */
const lines = readFileSync(join(ROOT, "docs", "narration.md"), "utf8").split("\n")
  .filter((l) => /^\|\s*\d+\s*\|/.test(l))
  .map((l) => { const c = l.split("|").map((x) => x.trim()); return { n: Number(c[1]), scene: c[2], text: c[3] }; });
const probe = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
let usedVoice = VOICE;
for (const l of lines) {
  const base = join(CLIPS, `clip${String(l.n).padStart(2, "0")}`);
  const key = `${VOICE}\n${l.text}`;
  if (existsSync(`${base}.txt`) && readFileSync(`${base}.txt`, "utf8") === key && existsSync(`${base}.mp3`)) l.file = `${base}.mp3`;
  else {
    try {
      execFileSync(EDGE_TTS, ["--voice", VOICE, "--text", l.text, "--write-media", `${base}.mp3`], { stdio: ["ignore", "ignore", "pipe"] });
      writeFileSync(`${base}.txt`, key);
      l.file = `${base}.mp3`;
    } catch (e) {
      log(`edge-tts failed for scene ${l.n} (${String(e.stderr || e.message).slice(0, 120)}); falling back to macOS say`);
      execFileSync("say", ["-v", "Samantha", "-o", `${base}.aiff`, l.text]);
      l.file = `${base}.aiff`;
      usedVoice = "macOS say (Samantha) for some lines";
    }
  }
  l.dur = probe(l.file);
}

/* 2. frames, scenes and still stretches */
const frames = [];
const sceneStart = new Map(); // scene number -> global frame index
for (const p of ["a", "b", "c"]) {
  const meta = JSON.parse(readFileSync(join(PARTS_DIR, p, "frames.json"), "utf8"));
  if (!meta.ok) throw new Error(`part ${p} is incomplete`);
  const off = frames.length;
  for (const [name, i] of Object.entries(meta.marks)) { const m = /^(\d+) /.exec(name); if (m) sceneStart.set(Number(m[1]), off + i); }
  meta.frames.forEach((f, i) => {
    const next = meta.frames[i + 1];
    const dur = Math.min(Math.max(!next || f.cut ? 0.3 : (next.t - f.t) / f.speedup, 0.001), 10);
    frames.push({ file: f.file, dur, cut: f.cut || !next });
  });
}
const hash = frames.map((f) => createHash("md5").update(readFileSync(f.file)).digest("hex"));
// Still: the frame matches one of the two before it, and the next frame matches too (the recorder's 2-px tick
// alternates between two near-identical frames, so a still screen is an A/B/A/B run).
frames.forEach((f, i) => {
  const same = (a, b) => a >= 0 && b < frames.length && hash[a] === hash[b];
  f.still = !f.cut && (same(i - 1, i) || same(i - 2, i)) && (same(i - 1, i + 1) || same(i, i + 1));
});
const scenes = lines.map((l) => ({ ...l, from: sceneStart.get(l.n) }));
scenes.forEach((s, k) => {
  if (s.from === undefined) throw new Error(`no mark for scene ${s.n}`);
  s.from = k === 0 ? 0 : s.from;
  s.to = k + 1 < scenes.length ? scenes[k + 1].from : frames.length;
});
const sum = (s, pred = () => true) => { let t = 0; for (let i = s.from; i < s.to; i++) if (pred(frames[i])) t += frames[i].dur; return t; };
const scaleStill = (s, factor) => { for (let i = s.from; i < s.to; i++) if (frames[i].still) frames[i].dur *= factor; };

for (const s of scenes) {
  s.recorded = sum(s);
  s.need = LEAD + s.dur + TAIL;
  if (s.recorded < s.need) {
    const still = sum(s, (f) => f.still), extra = s.need - s.recorded;
    if (still > 0.2) scaleStill(s, (still + extra) / still);
    else frames[s.to - 1].dur += extra;
  }
}
let total = scenes.reduce((t, s) => t + sum(s), 0);
if (total > MAX_SECONDS) {
  // Take the excess from still stretches in scenes that are longer than their line needs.
  for (const s of scenes) { const still = sum(s, (f) => f.still); s.room = Math.max(0, Math.min(sum(s) - s.need, still * (1 - KEEP_MIN))); }
  const room = scenes.reduce((t, s) => t + s.room, 0), cut = total - MAX_SECONDS;
  if (room < cut) throw new Error(`video would be ${total.toFixed(1)} s; only ${room.toFixed(1)} s of still frames can go. Shorten the narration.`);
  for (const s of scenes) if (s.room > 0) { const still = sum(s, (f) => f.still); scaleStill(s, (still - (s.room * cut) / room) / still); }
  total = scenes.reduce((t, s) => t + sum(s), 0);
}
let t = 0;
for (const s of scenes) { s.start = t; s.len = sum(s); t += s.len; }
log(`video ${total.toFixed(2)} s, voice ${usedVoice}`);
for (const s of scenes) log(`  ${Math.floor(s.start / 60)}:${(s.start % 60).toFixed(1).padStart(4, "0")}  ${String(s.n).padStart(2)} ${s.scene.padEnd(22)} scene ${s.len.toFixed(1)} s (recorded ${s.recorded.toFixed(1)}), line ${s.dur.toFixed(1)} s`);

if (process.env.DRY_RUN === "1") process.exit(0);

/* 3. wait for the encoding slot, then audio and video */
function waitForSlot() {
  for (let i = 0; ; i++) {
    const busy = execFileSync("ps", ["-axo", "pid=,command="]).toString().split("\n")
      .filter((l) => /record_demo\.mjs|(^|\/|\s)ffmpeg\s/.test(l) && !l.includes(String(process.pid)));
    if (busy.length === 0) return;
    if (i % 4 === 0) log(`waiting: another recorder or ffmpeg is running (${busy.length})`);
    sleepSync(15000);
  }
}
const work = join(CLIPS, "mix");
mkdirSync(work, { recursive: true });
const ff = (args) => execFileSync("nice", ["-n", "10", "ffmpeg", "-y", "-hide_banner", "-threads", "2", ...args], { stdio: ["ignore", "pipe", "pipe"] });
waitForSlot();
const inputs = scenes.flatMap((s) => ["-i", s.file]);
const chains = scenes.map((s, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${Math.round((s.start + LEAD) * 1000)}:all=1[a${i}]`);
const mixed = join(work, "voice.wav");
ff([...inputs, "-filter_complex", `${chains.join(";")};${scenes.map((_, i) => `[a${i}]`).join("")}amix=inputs=${scenes.length}:normalize=0:duration=longest,apad=whole_dur=${total.toFixed(3)}[out]`,
  "-map", "[out]", "-t", total.toFixed(3), "-c:a", "pcm_s16le", mixed]);
const LN = "I=-16:TP=-1.5:LRA=11";
const pass1 = spawnSync("nice", ["-n", "10", "ffmpeg", "-hide_banner", "-threads", "2", "-i", mixed, "-af", `loudnorm=${LN}:print_format=json`, "-f", "null", "-"], { encoding: "utf8" });
if (pass1.status !== 0) throw new Error("loudnorm measurement failed");
const stats = pass1.stderr;
const j0 = stats.lastIndexOf("{");
const m = JSON.parse(stats.slice(j0, stats.indexOf("}", j0) + 1));
const normed = join(work, "voice-norm.wav");
ff(["-i", mixed, "-af", `loudnorm=${LN}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`,
  "-ac", "2", "-c:a", "pcm_s16le", normed]);

const concat = join(work, "frames.txt");
const kept = [];
for (const f of frames) { if (f.dur < 0.012 && kept.length) kept[kept.length - 1].dur += f.dur; else kept.push({ file: f.file, dur: f.dur }); }
writeFileSync(concat, kept.map((k) => `file '${k.file}'\nduration ${k.dur.toFixed(4)}`).join("\n") + `\nfile '${kept[kept.length - 1].file}'\n`);
waitForSlot();
ff(["-f", "concat", "-safe", "0", "-i", concat, "-i", normed,
  "-vf", `fps=30,scale=${W}:${H}:flags=lanczos:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p`,
  "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-color_range", "tv",
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
  "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
  "-map", "0:v", "-map", "1:a", "-t", total.toFixed(3), "-movflags", "+faststart", OUT]);
writeFileSync(join(work, "timing.json"), JSON.stringify({ total, voice: usedVoice, scenes: scenes.map(({ n, scene, start, len, recorded, dur }) => ({ n, scene, start, len, recorded, line: dur })) }, null, 2));
log("->", OUT);
