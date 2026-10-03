import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Configuration. Only UNSTACK_* variables and YOUCAM_API_KEY (the name
 * scripts/set-youcam-key.sh writes to .env) are ever read. The machine this
 * runs on may have unrelated, generic keys in its environment (LLM_API_KEY,
 * OPENAI_API_KEY, …) and those must never be picked up or sent anywhere.
 */
export const ENV_PREFIX = 'UNSTACK_';
export const YOUCAM_KEY_NAME = 'YOUCAM_API_KEY';
const allowed = (key: string) => key.startsWith(ENV_PREFIX) || key === YOUCAM_KEY_NAME;
export const HARD_UNIT_CEILING = 1000; // the hackathon grant; no config can exceed it

export interface Config {
  rootDir: string;
  dataDir: string;
  host: string;
  port: number;
  youcamApiKey: string | null;
  forceMock: boolean;
  unitCap: number;
  maxTasksPerHour: number;
  nebiusApiKey: string | null;
  nebiusModel: string;
  llmCapUsd: number;
}

/** Parse a .env file, keeping only allowed keys. Values may be quoted. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    if (!allowed(key)) continue;
    let value = m[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/** Only the allowed subset of an environment (UNSTACK_* and YOUCAM_API_KEY). */
export function projectEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (allowed(k) && v !== undefined) out[k] = v;
  return out;
}

function num(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function loadConfig(rootDir: string, env: NodeJS.ProcessEnv = process.env): Config {
  const dotEnvPath = resolve(rootDir, '.env');
  const fromFile = existsSync(dotEnvPath) ? parseDotEnv(readFileSync(dotEnvPath, 'utf8')) : {};
  // Real environment wins over .env, but both are filtered to the allowed names.
  const e = { ...fromFile, ...projectEnv(env) };
  const key = (name: string) => {
    const v = e[`${ENV_PREFIX}${name}`]?.trim();
    return v ? v : null;
  };
  return {
    rootDir,
    dataDir: resolve(rootDir, e.UNSTACK_DATA_DIR ?? 'data'),
    host: e.UNSTACK_HOST ?? '127.0.0.1',
    port: num(e.UNSTACK_PORT, 8796, 1, 65535),
    youcamApiKey: e[YOUCAM_KEY_NAME]?.trim() || key('YOUCAM_API_KEY'),
    forceMock: e.UNSTACK_FORCE_MOCK === '1',
    unitCap: num(e.UNSTACK_UNIT_CAP, 200, 0, HARD_UNIT_CEILING),
    maxTasksPerHour: num(e.UNSTACK_MAX_TASKS_PER_HOUR, 12, 1, 60),
    nebiusApiKey: key('NEBIUS_API_KEY'),
    nebiusModel: e.UNSTACK_NEBIUS_MODEL ?? 'openbmb/MiniCPM-V-4_5',
    llmCapUsd: num(e.UNSTACK_LLM_CAP_USD, 1, 0, 1),
  };
}

export function isLive(config: Config): boolean {
  return Boolean(config.youcamApiKey) && !config.forceMock;
}
