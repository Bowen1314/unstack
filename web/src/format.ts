/** Pure formatting helpers. No DOM access, so they are unit-tested in node. */
import type { StatusResponse } from '../../shared/api.ts';
import { nextTierCost, skinAnalysisUnits } from '../../shared/pricing.ts';
import type { ProductCategory, ProductSource, ScanQuality, UsageTime, WeeklyFrequency } from '../../shared/types.ts';

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const DATE_FMT = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' });
const DATE_YEAR_FMT = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' });
const TIME_FMT = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' });

/** "2 Oct" this year, "2 Oct 2025" otherwise. */
export function formatDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.getFullYear() === now.getFullYear() ? DATE_FMT.format(d) : DATE_YEAR_FMT.format(d);
}

export function formatDateTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${formatDate(iso, now)}, ${TIME_FMT.format(d)}`;
}

/** Whole days from a to b (b later → positive). */
export function daysBetween(a: Date | string, b: Date | string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function relativeDays(iso: string, now: Date = new Date()): string {
  const d = daysBetween(now, iso);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${plural(d, 'day')}` : `${plural(-d, 'day')} ago`;
}

export function round1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

export function signed(n: number, digits = 1): string {
  const v = Math.round(n * 10 ** digits) / 10 ** digits;
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : v < 0 ? `−${s.slice(1)}` : s;
}

export function usd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export const USAGE_LABEL: Record<UsageTime, string> = {
  am: 'Morning',
  pm: 'Evening',
  both: 'Morning + evening',
  flex: 'Let the plan decide',
};

export const CATEGORY_LABEL: Record<ProductCategory, string> = {
  cleanser: 'Cleanser',
  toner: 'Toner',
  serum: 'Serum',
  treatment: 'Treatment',
  moisturizer: 'Moisturiser',
  sunscreen: 'Sunscreen',
  eye: 'Eye care',
  exfoliant: 'Exfoliant',
  mask: 'Mask',
  oil: 'Face oil',
  other: 'Other',
};

export const SOURCE_LABEL: Record<ProductSource, string> = {
  catalog: 'From demo catalogue',
  paste: 'Pasted list',
  'label-photo': 'Read from label photo',
};

export function frequencyLabel(f: WeeklyFrequency): string {
  return f === 7 ? 'Daily' : `${f}× a week`;
}

export function sessionUnit(session: 'am' | 'pm', n: number): string {
  return session === 'pm' ? (n === 1 ? 'night' : 'nights') : n === 1 ? 'morning' : 'mornings';
}

/** "7 → 4 nights/week" */
export function adjustmentLine(session: 'am' | 'pm', requested: number, scheduled: number): string {
  return `${requested} → ${scheduled} ${sessionUnit(session, scheduled)}/week`;
}

export function qualityLabel(q: ScanQuality): string {
  return q === 'hd' ? 'HD' : 'SD';
}

/**
 * How many more concerns fit in the current price tier, and what the next tier costs.
 * Lets the picker say "2 more concerns at this price" or "one more moves you to 14 units".
 */
export function tierHint(count: number, quality: ScanQuality): { current: number; roomLeft: number; next: { at: number; units: number } | null } | null {
  if (count < 1) return null;
  let current: number;
  try {
    current = skinAnalysisUnits(count, quality);
  } catch {
    return null;
  }
  let roomLeft = 0;
  for (let n = count + 1; n <= 16; n++) {
    try {
      if (skinAnalysisUnits(n, quality) !== current) break;
    } catch {
      break;
    }
    roomLeft++;
  }
  const boundary = count + roomLeft;
  const next = nextTierCost(boundary, quality);
  return { current, roomLeft, next };
}

/** Header pill text for the unit ledger. */
export function unitsPill(status: StatusResponse | null): string {
  if (!status) return 'Units —';
  if (status.mode === 'mock') return 'No real units';
  return `${status.units.available} units left`;
}

/** "12 units · 36 of 200 used this ledger" (live) or the demo-mode line. */
export function ledgerLine(cost: number | null, status: StatusResponse | null): string {
  if (!status) return cost === null ? 'Server not reachable' : `${plural(cost, 'unit')} · ledger unavailable (server not reachable)`;
  if (status.mode === 'mock') return 'Demo mode — no real units are spent';
  const { used, cap, reserved } = status.units;
  const head = cost === null ? '' : `${plural(cost, 'unit')} · `;
  const res = reserved > 0 ? ` (${reserved} reserved)` : '';
  return `${head}${used} of ${cap} used this ledger${res}`;
}

/** Short id for display ("c1f2…9a"). */
export function shortId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 6)}…${id.slice(-3)}`;
}

/** Oxford-comma list: "a, b and c". */
export function listJoin(items: string[]): string {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
