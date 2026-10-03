import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HARD_UNIT_CEILING, isLive, loadConfig, parseDotEnv, projectEnv } from '../server/config.ts';
import { tempDir } from './support.ts';

describe('config only reads project-specific names', () => {
  it('drops generic keys from .env', () => {
    const env = parseDotEnv(['LLM_API_KEY=ambient', 'OPENAI_API_KEY=sk-x', 'NEBIUS_API_KEY=n', 'YOUCAM_API_KEY="yc"', 'export UNSTACK_UNIT_CAP=50'].join('\n'));
    expect(env).toEqual({ YOUCAM_API_KEY: 'yc', UNSTACK_UNIT_CAP: '50' });
  });

  it('drops generic keys from the process environment', () => {
    expect(projectEnv({ LLM_API_KEY: 'a', OPENAI_API_KEY: 'b', UNSTACK_PORT: '9000', PATH: '/bin' })).toEqual({ UNSTACK_PORT: '9000' });
  });

  it('never uses an ambient LLM key for the label reader', () => {
    const root = tempDir();
    const c = loadConfig(root, { LLM_API_KEY: 'ambient', OPENAI_API_KEY: 'ambient', NEBIUS_API_KEY: 'ambient' });
    expect(c.nebiusApiKey).toBeNull();
    expect(c.youcamApiKey).toBeNull();
    expect(isLive(c)).toBe(false);
  });

  it('reads UNSTACK_NEBIUS_API_KEY and YOUCAM_API_KEY from .env', () => {
    const root = tempDir();
    writeFileSync(join(root, '.env'), 'YOUCAM_API_KEY=abc\nUNSTACK_NEBIUS_API_KEY=neb\n');
    const c = loadConfig(root, {});
    expect(c.youcamApiKey).toBe('abc');
    expect(c.nebiusApiKey).toBe('neb');
    expect(isLive(c)).toBe(true);
  });

  it('UNSTACK_FORCE_MOCK=1 keeps a configured key in demo mode', () => {
    const root = tempDir();
    writeFileSync(join(root, '.env'), 'YOUCAM_API_KEY=abc\n');
    expect(isLive(loadConfig(root, { UNSTACK_FORCE_MOCK: '1' }))).toBe(false);
  });

  it('clamps the unit cap to the hackathon grant', () => {
    const c = loadConfig(tempDir(), { UNSTACK_UNIT_CAP: '99999' });
    expect(c.unitCap).toBe(HARD_UNIT_CEILING);
    expect(loadConfig(tempDir(), {}).port).toBe(8796);
    expect(loadConfig(tempDir(), {}).host).toBe('127.0.0.1');
  });
});
