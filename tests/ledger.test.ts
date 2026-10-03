import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../server/http.ts';
import { UnitLedger } from '../server/ledger.ts';
import { tempDir } from './support.ts';

describe('unit ledger', () => {
  it('reserves, charges and releases against the cap', () => {
    const l = new UnitLedger(null, 30);
    const a = l.reserve('skin-analysis v2.1 SD x4', 9);
    expect(l.snapshot()).toEqual({ cap: 30, used: 0, reserved: 9, available: 21 });
    l.charge(a);
    const b = l.reserve('fitzpatrick v1.0', 10);
    l.release(b, 'task failed');
    expect(l.snapshot()).toEqual({ cap: 30, used: 9, reserved: 0, available: 21 });
  });

  it('refuses a reservation that would exceed the cap, and records nothing', () => {
    const l = new UnitLedger(null, 20);
    l.charge(l.reserve('a', 12));
    let err: unknown;
    try {
      l.reserve('b', 9);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).code).toBe('unit-cap-reached');
    expect((err as HttpError).status).toBe(409);
    expect(l.list()).toHaveLength(1);
    expect(l.snapshot().available).toBe(8);
  });

  it('counts open reservations against the cap', () => {
    const l = new UnitLedger(null, 20);
    l.reserve('a', 12);
    expect(() => l.reserve('b', 9)).toThrow(/units/);
  });

  it('raises a reservation only within the cap', () => {
    const l = new UnitLedger(null, 20);
    const r = l.reserve('a', 9);
    expect(l.raise(r, 12).units).toBe(12);
    expect(l.raise(r, 5).units).toBe(12); // never lowers
    expect(() => l.raise(r, 21)).toThrow(HttpError);
    expect(l.snapshot().reserved).toBe(12);
  });

  it('a zero cap refuses everything', () => {
    expect(() => new UnitLedger(null, 0).reserve('a', 1)).toThrow(HttpError);
  });

  it('persists to disk and counts a reservation left open by a crash as spent', () => {
    const path = join(tempDir(), 'unit-ledger.json');
    const l = new UnitLedger(path, 60);
    l.charge(l.reserve('skin-analysis v2.1 SD x4', 9), { balanceBefore: 1014 });
    l.reserve('fitzpatrick v1.0', 10); // never settled
    const reloaded = new UnitLedger(path, 60);
    expect(reloaded.snapshot()).toEqual({ cap: 60, used: 19, reserved: 0, available: 41 });
    expect(reloaded.list()[1]!.note).toMatch(/counted as spent/);
  });

  it('stores nothing about the person or photo', () => {
    const path = join(tempDir(), 'unit-ledger.json');
    const l = new UnitLedger(path, 60);
    const r = l.reserve('skin-analysis v2.1 SD x4', 9, 1014);
    l.charge(r);
    l.noteBalanceAfter(r, 1005);
    const file = JSON.parse(readFileSync(path, 'utf8')) as { entries: Record<string, unknown>[] };
    const allowed = ['id', 'at', 'feature', 'units', 'state', 'balanceBefore', 'balanceAfter', 'note'];
    for (const e of file.entries) for (const k of Object.keys(e)) expect(allowed).toContain(k);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it('reads an existing ledger file', () => {
    const path = join(tempDir(), 'unit-ledger.json');
    writeFileSync(path, JSON.stringify({ version: 1, entries: [{ id: 'x', at: '2026-10-02T00:00:00Z', feature: 'f', units: 16, state: 'charged' }] }));
    expect(new UnitLedger(path, 60).snapshot().used).toBe(16);
  });
});
