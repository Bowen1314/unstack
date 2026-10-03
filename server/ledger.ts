import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { HARD_UNIT_CEILING } from './config.ts';
import { HttpError } from './http.ts';

/**
 * The unit ledger: a hard cap on YouCam units this server may spend.
 *
 * Units are reserved before a paid task starts, charged when YouCam reports
 * success (YouCam bills only successful tasks) and released otherwise. A
 * reservation is refused if used + reserved + cost would exceed the cap.
 *
 * The live ledger is a JSON file in data/. Entries hold a feature label, a unit
 * count and the account balance around the call, never anything about the
 * person or photo. The demo-mode ledger lives in memory only.
 */

export type EntryState = 'reserved' | 'charged' | 'released';

export interface LedgerEntry {
  id: string;
  at: string;
  feature: string;
  units: number;
  state: EntryState;
  balanceBefore?: number;
  balanceAfter?: number;
  note?: string;
}

interface LedgerFile {
  version: 1;
  entries: LedgerEntry[];
}

export interface LedgerSnapshot {
  cap: number;
  used: number;
  reserved: number;
  available: number;
}

export interface Reservation {
  readonly id: string;
  readonly units: number;
}

export class UnitLedger {
  private readonly entries: LedgerEntry[];
  readonly cap: number;

  constructor(
    private readonly path: string | null,
    cap: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.cap = Math.max(0, Math.min(HARD_UNIT_CEILING, Math.floor(cap)));
    this.entries = path && existsSync(path) ? UnitLedger.load(path) : [];
    // A reservation still open on disk means the server stopped mid-task. YouCam
    // may or may not have charged it, so count it as spent.
    let recovered = false;
    for (const e of this.entries) {
      if (e.state === 'reserved') {
        e.state = 'charged';
        e.note = 'outcome unknown (server stopped during the task); counted as spent';
        recovered = true;
      }
    }
    if (recovered) this.save();
  }

  private static load(path: string): LedgerEntry[] {
    const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<LedgerFile>;
    return Array.isArray(data.entries) ? data.entries : [];
  }

  private save(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, entries: this.entries } satisfies LedgerFile, null, 2) + '\n');
    renameSync(tmp, this.path);
  }

  snapshot(): LedgerSnapshot {
    let used = 0;
    let reserved = 0;
    for (const e of this.entries) {
      if (e.state === 'charged') used += e.units;
      else if (e.state === 'reserved') reserved += e.units;
    }
    return { cap: this.cap, used, reserved, available: Math.max(0, this.cap - used - reserved) };
  }

  /** Reserve units, or throw HttpError 409 `unit-cap-reached` if the cap would be exceeded. */
  reserve(feature: string, units: number, balanceBefore?: number): Reservation {
    if (!Number.isInteger(units) || units <= 0) throw new RangeError('units must be a positive integer');
    const snap = this.snapshot();
    if (units > snap.available) throw capError(units, snap);
    const entry: LedgerEntry = { id: randomUUID(), at: this.now().toISOString(), feature, units, state: 'reserved' };
    if (balanceBefore !== undefined) entry.balanceBefore = balanceBefore;
    this.entries.push(entry);
    this.save();
    return { id: entry.id, units };
  }

  /** Raise (never lower) an open reservation, e.g. when the live price list is higher than the docs. */
  raise(res: Reservation, units: number): Reservation {
    const e = this.open(res);
    if (units <= e.units) return { id: e.id, units: e.units };
    const snap = this.snapshot();
    if (units - e.units > snap.available) throw capError(units, { ...snap, available: snap.available + e.units });
    e.units = units;
    this.save();
    return { id: e.id, units };
  }

  /** The task succeeded: the reserved units are spent. */
  charge(res: Reservation, extra: { balanceBefore?: number; note?: string } = {}): void {
    const e = this.open(res);
    e.state = 'charged';
    if (extra.balanceBefore !== undefined) e.balanceBefore = extra.balanceBefore;
    if (extra.note) e.note = extra.note;
    this.save();
  }

  /** The task failed or never started: give the units back. */
  release(res: Reservation, note?: string): void {
    const e = this.entries.find((x) => x.id === res.id);
    if (!e || e.state !== 'reserved') return;
    e.state = 'released';
    if (note) e.note = note;
    this.save();
  }

  /** Attach the account balance read after a charged task (audit trail only). */
  noteBalanceAfter(res: Reservation, balance: number): void {
    const e = this.entries.find((x) => x.id === res.id);
    if (!e) return;
    e.balanceAfter = balance;
    this.save();
  }

  list(): readonly LedgerEntry[] {
    return this.entries;
  }

  private open(res: Reservation): LedgerEntry {
    const e = this.entries.find((x) => x.id === res.id);
    if (!e || e.state !== 'reserved') throw new Error(`Reservation ${res.id} is not open`);
    return e;
  }
}

function capError(units: number, snap: LedgerSnapshot): HttpError {
  return new HttpError(
    409,
    'unit-cap-reached',
    `This needs ${units} units, but only ${snap.available} of the ${snap.cap}-unit cap are left.`,
    'The server refuses paid calls that would go over its unit cap. Pick fewer concerns, use SD, or raise UNSTACK_UNIT_CAP.',
  );
}
