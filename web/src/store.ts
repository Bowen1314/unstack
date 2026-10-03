/**
 * All user data lives on the device: one state object in localStorage
 * ('unstack:v1'). Masks and photo thumbnails go to IndexedDB (see idb.ts).
 * The reducer is pure and unit-tested; timestamps come in with the action.
 */
import { useSyncExternalStore } from 'react';
import type { ConsentPurpose } from '../../shared/api.ts';
import type { Experiment, Product, ScanResult, SunProfile } from '../../shared/types.ts';
import { isDemoId } from './demo.ts';
import { frequencyLabel, USAGE_LABEL } from './format.ts';

export const STORAGE_KEY = 'unstack:v1';

export interface StoredConsent {
  consentId: string;
  version: string;
  purposes: ConsentPurpose[];
  grantedAt: string;
}

export interface AppState {
  products: Product[];
  /** Scan results with masks stripped (masks live in IndexedDB). */
  scans: ScanResult[];
  experiments: Experiment[];
  sunProfile: SunProfile;
  consent: StoredConsent | null;
  onboarded: boolean;
}

export const initialState: AppState = {
  products: [],
  scans: [],
  experiments: [],
  sunProfile: { scale: null, source: 'unset', updatedAt: null },
  consent: null,
  onboarded: false,
};

export type ProductPatch = Partial<Pick<Product, 'usage' | 'frequency' | 'prescription' | 'rinseOff' | 'category' | 'name'>>;

export type Action =
  | { type: 'onboard'; products: Product[] }
  | { type: 'product/add'; product: Product; at: string }
  | { type: 'product/update'; id: string; patch: ProductPatch; at: string }
  | { type: 'product/remove'; id: string; at: string }
  /** Undo of a removal: puts the product back where it was and drops the matching confounder entry. */
  | { type: 'product/restore'; product: Product; index: number }
  | { type: 'scan/add'; scan: ScanResult; experimentId: string | null }
  | { type: 'scan/remove'; id: string }
  | { type: 'sun/set'; profile: SunProfile }
  | { type: 'consent/set'; consent: StoredConsent }
  | { type: 'consent/clear' }
  | { type: 'experiment/start'; experiment: Experiment; addProduct?: Product }
  | { type: 'experiment/attach'; id: string; scanId: string }
  | { type: 'experiment/status'; id: string; status: Experiment['status'] }
  | { type: 'experiment/remove'; id: string }
  | { type: 'demo/load'; scans: ScanResult[]; experiment: Experiment }
  | { type: 'demo/clear' }
  | { type: 'reset' };

/** Experiments that log shelf edits as confounders. */
export function runningExperiments(state: Pick<AppState, 'experiments'>): Experiment[] {
  return state.experiments.filter((e) => e.status === 'running');
}

const COALESCE_MS = 30 * 60_000;

/**
 * Append a confounder entry to every running experiment. Consecutive edits to
 * the same product within 30 minutes collapse into one entry, so fiddling with
 * a dropdown doesn't flood the log.
 */
export function logConfounder(experiments: Experiment[], description: string, at: string, coalesceKey?: string): Experiment[] {
  return experiments.map((e) => {
    if (e.status !== 'running') return e;
    const last = e.otherChanges.at(-1);
    if (last && last.description === description) return e;
    if (last && coalesceKey && last.description.startsWith(coalesceKey) && new Date(at).getTime() - new Date(last.at).getTime() < COALESCE_MS) {
      return { ...e, otherChanges: [...e.otherChanges.slice(0, -1), { at, description }] };
    }
    return { ...e, otherChanges: [...e.otherChanges, { at, description }] };
  });
}

export function describeProductSettings(p: Pick<Product, 'usage' | 'frequency' | 'prescription' | 'category'>): string {
  const bits = [USAGE_LABEL[p.usage].toLowerCase(), frequencyLabel(p.frequency).toLowerCase()];
  if (p.prescription) bits.push('prescribed');
  return bits.join(', ');
}

function sortScans(scans: ScanResult[]): ScanResult[] {
  return [...scans].sort((a, b) => a.takenAt.localeCompare(b.takenAt));
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'onboard':
      return { ...state, onboarded: true, products: [...state.products, ...action.products] };

    case 'product/add':
      return {
        ...state,
        onboarded: true,
        products: [...state.products, action.product],
        experiments: logConfounder(state.experiments, `Added ${action.product.name}`, action.at),
      };

    case 'product/update': {
      const before = state.products.find((p) => p.id === action.id);
      if (!before) return state;
      const after = { ...before, ...action.patch };
      const settingsChanged =
        before.usage !== after.usage || before.frequency !== after.frequency || before.prescription !== after.prescription || before.rinseOff !== after.rinseOff;
      const key = `Changed ${after.name}:`;
      return {
        ...state,
        products: state.products.map((p) => (p.id === action.id ? after : p)),
        experiments: settingsChanged ? logConfounder(state.experiments, `${key} now ${describeProductSettings(after)}`, action.at, key) : state.experiments,
      };
    }

    case 'product/remove': {
      const gone = state.products.find((p) => p.id === action.id);
      if (!gone) return state;
      return {
        ...state,
        products: state.products.filter((p) => p.id !== action.id),
        experiments: logConfounder(state.experiments, `Removed ${gone.name}`, action.at),
      };
    }

    case 'product/restore': {
      if (state.products.some((p) => p.id === action.product.id)) return state;
      const products = [...state.products];
      products.splice(Math.max(0, Math.min(action.index, products.length)), 0, action.product);
      const removed = `Removed ${action.product.name}`;
      return {
        ...state,
        products,
        experiments: state.experiments.map((e) =>
          e.status === 'running' && e.otherChanges.at(-1)?.description === removed ? { ...e, otherChanges: e.otherChanges.slice(0, -1) } : e,
        ),
      };
    }

    case 'scan/add': {
      const scans = sortScans([...state.scans.filter((s) => s.id !== action.scan.id), action.scan]);
      const experiments = action.experimentId
        ? state.experiments.map((e) => (e.id === action.experimentId && !e.scanIds.includes(action.scan.id) ? { ...e, scanIds: [...e.scanIds, action.scan.id] } : e))
        : state.experiments;
      return { ...state, scans, experiments };
    }

    case 'scan/remove':
      return {
        ...state,
        scans: state.scans.filter((s) => s.id !== action.id),
        experiments: state.experiments.map((e) => (e.scanIds.includes(action.id) ? { ...e, scanIds: e.scanIds.filter((id) => id !== action.id) } : e)),
      };

    case 'sun/set':
      return { ...state, sunProfile: action.profile };

    case 'consent/set':
      return { ...state, consent: action.consent };

    case 'consent/clear':
      return { ...state, consent: null };

    case 'experiment/start': {
      // The experiment's own change is applied here, atomically, so it is never logged as a confounder.
      const { experiment, addProduct } = action;
      let products = state.products;
      if (experiment.change.kind === 'remove') products = products.filter((p) => p.id !== experiment.change.productId);
      else if (addProduct && !products.some((p) => p.id === addProduct.id)) products = [...products, addProduct];
      return { ...state, onboarded: true, products, experiments: [...state.experiments, experiment] };
    }

    case 'experiment/attach':
      return {
        ...state,
        experiments: state.experiments.map((e) => (e.id === action.id && !e.scanIds.includes(action.scanId) ? { ...e, scanIds: [...e.scanIds, action.scanId] } : e)),
      };

    case 'experiment/status':
      return { ...state, experiments: state.experiments.map((e) => (e.id === action.id ? { ...e, status: action.status } : e)) };

    case 'experiment/remove':
      return { ...state, experiments: state.experiments.filter((e) => e.id !== action.id) };

    case 'demo/load': {
      const cleared = reducer(state, { type: 'demo/clear' });
      return {
        ...cleared,
        scans: sortScans([...cleared.scans, ...action.scans]),
        experiments: [...cleared.experiments, action.experiment],
      };
    }

    case 'demo/clear':
      return {
        ...state,
        scans: state.scans.filter((s) => !isDemoId(s.id)),
        experiments: state.experiments.filter((e) => !isDemoId(e.id)),
      };

    case 'reset':
      return initialState;
  }
}

// ---------- Persistence ----------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Parse whatever is in storage; anything malformed falls back to the initial state. */
export function hydrate(raw: string | null): AppState {
  if (!raw) return initialState;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return initialState;
    const sun = isObject(parsed.sunProfile) ? (parsed.sunProfile as unknown as SunProfile) : initialState.sunProfile;
    const consent = isObject(parsed.consent) && typeof parsed.consent.consentId === 'string' ? (parsed.consent as unknown as StoredConsent) : null;
    return {
      products: Array.isArray(parsed.products) ? (parsed.products as Product[]) : [],
      scans: Array.isArray(parsed.scans) ? sortScans(parsed.scans as ScanResult[]) : [],
      experiments: Array.isArray(parsed.experiments) ? (parsed.experiments as Experiment[]) : [],
      sunProfile: sun,
      consent,
      onboarded: parsed.onboarded === true,
    };
  } catch {
    return initialState;
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readStored(): AppState {
  try {
    return hydrate(storage()?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return initialState;
  }
}

let persistOk = true;
function persist(s: AppState): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(s));
    persistOk = true;
  } catch {
    // Private mode or quota: keep working in memory.
    persistOk = false;
  }
}

/** False when the last write to localStorage failed (private mode, quota). */
export function isPersisting(): boolean {
  return persistOk;
}

export function clearStoredState(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ---------- Runtime store ----------

let current: AppState = readStored();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function getState(): AppState {
  return current;
}

export function dispatch(action: Action): void {
  const next = reducer(current, action);
  if (next === current) return;
  current = next;
  persist(current);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Keep several open tabs in sync.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    current = hydrate(e.newValue);
    emit();
  });
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState, getState);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
