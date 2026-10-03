import { describe, expect, it } from 'vitest';
import type { Experiment, Product, ScanResult } from '../../shared/types.ts';
import { makeDemoHistory } from './demo.ts';
import { hydrate, initialState, logConfounder, reducer, type AppState } from './store.ts';

const T0 = '2026-10-01T10:00:00.000Z';
const T1 = '2026-10-01T10:05:00.000Z';
const T2 = '2026-10-01T12:00:00.000Z';

function product(id: string, name: string, extra: Partial<Product> = {}): Product {
  return {
    id,
    name,
    category: 'serum',
    ingredientsRaw: 'Aqua, Niacinamide',
    usage: 'am',
    frequency: 7,
    rinseOff: false,
    prescription: false,
    source: 'paste',
    addedAt: T0,
    ...extra,
  };
}

function experiment(extra: Partial<Experiment> = {}): Experiment {
  return {
    id: 'exp-1',
    title: 'Stop Toner',
    change: { kind: 'remove', productId: 'toner', productName: 'Toner' },
    targetConcerns: ['redness'],
    startedAt: T0,
    weeks: 6,
    scanIds: [],
    otherChanges: [],
    status: 'running',
    ...extra,
  };
}

function scan(id: string, takenAt: string): ScanResult {
  return {
    id,
    takenAt,
    quality: 'sd',
    captureMethod: 'upload',
    concerns: ['redness'],
    scores: [{ concern: 'redness', region: 'whole', raw: 50, ui: 70, mask: null }],
    skinType: [],
    skinAge: null,
    overall: null,
    unitsCharged: 9,
    mode: 'mock',
    remoteDeleted: true,
  };
}

const withRunning = (s: Partial<AppState> = {}): AppState => ({ ...initialState, onboarded: true, experiments: [experiment()], ...s });

describe('shelf edits during an experiment', () => {
  it('logs added and removed products as confounders', () => {
    let s = withRunning({ products: [product('a', 'Serum A')] });
    s = reducer(s, { type: 'product/add', product: product('b', 'Serum B'), at: T0 });
    s = reducer(s, { type: 'product/remove', id: 'a', at: T1 });
    expect(s.products.map((p) => p.id)).toEqual(['b']);
    expect(s.experiments[0]!.otherChanges.map((c) => c.description)).toEqual(['Added Serum B', 'Removed Serum A']);
  });

  it('does not log anything when no experiment is running', () => {
    let s: AppState = { ...initialState, experiments: [experiment({ status: 'finished' })] };
    s = reducer(s, { type: 'product/add', product: product('b', 'Serum B'), at: T0 });
    expect(s.experiments[0]!.otherChanges).toEqual([]);
  });

  it('coalesces repeated setting changes to one product within 30 minutes', () => {
    let s = withRunning({ products: [product('a', 'Serum A')] });
    s = reducer(s, { type: 'product/update', id: 'a', patch: { frequency: 4 }, at: T0 });
    s = reducer(s, { type: 'product/update', id: 'a', patch: { usage: 'pm' }, at: T1 });
    const log = s.experiments[0]!.otherChanges;
    expect(log).toHaveLength(1);
    expect(log[0]!.description).toBe('Changed Serum A: now evening, 4× a week');
    s = reducer(s, { type: 'product/update', id: 'a', patch: { frequency: 2 }, at: T2 });
    expect(s.experiments[0]!.otherChanges).toHaveLength(2);
  });

  it('ignores renames and category edits (not a routine change)', () => {
    let s = withRunning({ products: [product('a', 'Serum A')] });
    s = reducer(s, { type: 'product/update', id: 'a', patch: { category: 'treatment' }, at: T0 });
    expect(s.experiments[0]!.otherChanges).toEqual([]);
  });

  it('undo of a removal restores the product in place and drops its log entry', () => {
    const a = product('a', 'Serum A');
    let s = withRunning({ products: [a, product('b', 'Serum B')] });
    s = reducer(s, { type: 'product/remove', id: 'a', at: T0 });
    s = reducer(s, { type: 'product/restore', product: a, index: 0 });
    expect(s.products.map((p) => p.id)).toEqual(['a', 'b']);
    expect(s.experiments[0]!.otherChanges).toEqual([]);
  });

  it("starting an experiment applies its own change without logging it", () => {
    const running = experiment({ id: 'old', change: { kind: 'add', productId: 'x', productName: 'X' } });
    let s: AppState = { ...initialState, products: [product('toner', 'Toner')], experiments: [running] };
    s = reducer(s, { type: 'experiment/start', experiment: experiment({ id: 'new' }) });
    expect(s.products).toEqual([]);
    expect(s.experiments.find((e) => e.id === 'old')!.otherChanges).toEqual([]);

    const added = product('cat-1', 'Copper Serum');
    s = reducer(s, { type: 'experiment/start', experiment: experiment({ id: 'add', change: { kind: 'add', productId: 'cat-1', productName: 'Copper Serum' } }), addProduct: added });
    expect(s.products.map((p) => p.id)).toEqual(['cat-1']);
  });
});

describe('scans', () => {
  it('keeps scans in time order and attaches to an experiment once', () => {
    let s = withRunning();
    s = reducer(s, { type: 'scan/add', scan: scan('s2', T2), experimentId: 'exp-1' });
    s = reducer(s, { type: 'scan/add', scan: scan('s1', T0), experimentId: 'exp-1' });
    s = reducer(s, { type: 'scan/add', scan: scan('s1', T0), experimentId: 'exp-1' });
    expect(s.scans.map((x) => x.id)).toEqual(['s1', 's2']);
    expect(s.experiments[0]!.scanIds).toEqual(['s2', 's1']);
  });

  it('removing a scan also detaches it from experiments', () => {
    let s = withRunning();
    s = reducer(s, { type: 'scan/add', scan: scan('s1', T0), experimentId: 'exp-1' });
    s = reducer(s, { type: 'scan/remove', id: 's1' });
    expect(s.scans).toEqual([]);
    expect(s.experiments[0]!.scanIds).toEqual([]);
  });
});

describe('demo history', () => {
  it('loading twice replaces the previous demo data instead of duplicating it', () => {
    const now = new Date('2026-10-02T12:00:00Z');
    let s: AppState = { ...initialState, scans: [scan('real', T0)] };
    const first = makeDemoHistory(now);
    s = reducer(s, { type: 'demo/load', ...first });
    s = reducer(s, { type: 'demo/load', ...makeDemoHistory(now) });
    expect(s.scans.filter((x) => x.id.startsWith('demo-'))).toHaveLength(4);
    expect(s.experiments).toHaveLength(1);
    s = reducer(s, { type: 'demo/clear' });
    expect(s.scans.map((x) => x.id)).toEqual(['real']);
    expect(s.experiments).toEqual([]);
  });
});

describe('persistence', () => {
  it('falls back to the initial state for missing or malformed data', () => {
    expect(hydrate(null)).toEqual(initialState);
    expect(hydrate('not json')).toEqual(initialState);
    expect(hydrate('[1,2]')).toEqual(initialState);
    expect(hydrate('{"products":"nope","onboarded":"yes"}')).toEqual(initialState);
  });

  it('round-trips a saved state', () => {
    const s = withRunning({ products: [product('a', 'Serum A')], scans: [scan('s1', T0)] });
    expect(hydrate(JSON.stringify(s))).toEqual(s);
  });

  it('reset returns to the initial state', () => {
    expect(reducer(withRunning(), { type: 'reset' })).toEqual(initialState);
  });
});

describe('logConfounder', () => {
  it('skips an exact repeat of the last entry', () => {
    const exps = logConfounder(logConfounder([experiment()], 'Added X', T0), 'Added X', T1);
    expect(exps[0]!.otherChanges).toHaveLength(1);
  });
});
