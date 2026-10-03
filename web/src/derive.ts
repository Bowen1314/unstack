/** Derived views over the stored state, shared across screens. */
import { useMemo } from 'react';
import { pickFocus, type ScoredConcern } from '../../shared/concerns.ts';
import { evaluateShelf, type ShelfReport } from '../../shared/rules.ts';
import { planWeek, type WeeklyPlan } from '../../shared/schedule.ts';
import type { Product, ScanResult } from '../../shared/types.ts';
import { useAppState, type AppState } from './store.ts';

export function latestScan(scans: ScanResult[]): ScanResult | null {
  let best: ScanResult | null = null;
  for (const s of scans) if (!best || s.takenAt > best.takenAt) best = s;
  return best;
}

export function focusFromScans(scans: ScanResult[]): ScoredConcern[] {
  const latest = latestScan(scans);
  return latest && latest.scores.length > 0 ? pickFocus(latest) : [];
}

export interface ShelfView {
  state: AppState;
  report: ShelfReport;
  focus: ScoredConcern[];
  focusScan: ScanResult | null;
  byId: Map<string, Product>;
}

export function useShelf(): ShelfView {
  const state = useAppState();
  const { products, scans, sunProfile } = state;
  const focusScan = useMemo(() => latestScan(scans), [scans]);
  const focus = useMemo(() => focusFromScans(scans), [scans]);
  const report = useMemo(() => evaluateShelf(products, { sun: sunProfile, focus, now: new Date() }), [products, sunProfile, focus]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  return { state, report, focus, focusScan, byId };
}

export function usePlan(products: Product[], report: ShelfReport): WeeklyPlan {
  return useMemo(() => planWeek(products, report), [products, report]);
}

export function productName(byId: Map<string, Product>, id: string): string {
  return byId.get(id)?.name ?? 'Removed product';
}
