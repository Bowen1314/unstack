import { isSunscreen } from './ingredients.ts';
import type { ShelfReport } from './rules.ts';
import type { SourceId } from './sources.ts';
import type { Product, ProductCategory } from './types.ts';

/**
 * Weekly planner: places every product into AM/PM sessions over 7 days so
 * that no session contains a conflicting pair, retinoids stay at night,
 * sunscreen stays in the morning, and actives are spread out.
 *
 * It is a deterministic greedy search that places products round-robin (one
 * application each per round, most constrained first), so a high-frequency
 * product can't starve another one. Non-prescribed retinoids and exfoliants
 * are capped by published guidance before placement; every reduction is
 * reported with its reason.
 */

export type Session = 'am' | 'pm';
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MAX_ACTIVES_PER_SESSION = 2;
export const RETINOID_START_CAP = 4; // "every other night to start" (AAD)
export const EXFOLIANT_NIGHTS_CAP = 3; // 2–3 times a week; fewer the stronger it is (AAD)

export interface PlanAdjustment {
  productId: string;
  session: Session;
  requested: number;
  scheduled: number;
  kind: 'guidance' | 'conflict';
  reason: string;
  sourceIds: SourceId[];
}

export interface WeeklyPlan {
  days: { am: string[]; pm: string[] }[];
  adjustments: PlanAdjustment[];
  /** Evenings with no active ingredient: recovery time for the skin. */
  restNights: number[];
}

const LAYER_ORDER: Record<ProductCategory, number> = {
  cleanser: 0,
  exfoliant: 1,
  toner: 2,
  mask: 3,
  treatment: 4,
  serum: 5,
  eye: 6,
  moisturizer: 7,
  oil: 8,
  sunscreen: 9,
  other: 5,
};

const EXFOLIANT_FAMILIES = ['aha', 'bha', 'pha', 'physical_exfoliant'] as const;

interface Demand {
  product: Product;
  sessions: Session[]; // allowed sessions, preferred first
  requested: number;
  target: number;
  placed: { day: number; session: Session }[];
  active: boolean;
  exfoliant: boolean;
  priority: number;
  capReason?: { reason: string; sourceIds: SourceId[] };
  lastFailure: string;
}

function allowedSessions(p: Product, report: ShelfReport, shelfHasRetinoid: boolean): Session[] {
  const a = report.analyses[p.id]!;
  if (isSunscreen(p, a)) return ['am'];
  if (a.families.includes('retinoid')) return ['pm'];
  if (p.usage === 'am') return ['am'];
  if (p.usage === 'pm') return ['pm'];
  if (a.families.includes('vitamin_c_laa')) return ['am', 'pm'];
  if (a.families.includes('benzoyl_peroxide') && shelfHasRetinoid) return ['am', 'pm'];
  if (a.actives.length > 0) return ['pm', 'am'];
  return ['am', 'pm'];
}

function buildDemands(products: Product[], report: ShelfReport): Demand[] {
  const shelfHasRetinoid = products.some((p) => !p.rinseOff && report.analyses[p.id]!.families.includes('retinoid'));
  const conflictCount = (id: string) => report.sessionConflicts.filter((c) => c.a === id || c.b === id).length;
  const demands: Demand[] = [];
  for (const p of products) {
    const a = report.analyses[p.id]!;
    const active = a.actives.length > 0;
    const exfoliant = !p.rinseOff && EXFOLIANT_FAMILIES.some((f) => a.families.includes(f));
    const sessions = allowedSessions(p, report, shelfHasRetinoid);
    const isRetinoid = a.families.includes('retinoid');
    // Retinoids first, then products pinned to one session (so flexible products route around them).
    const priority = (isRetinoid ? 100 : 0) + conflictCount(p.id) * 10 + (active ? 5 : 0) + (sessions.length === 1 ? 15 : 0);
    const base = { product: p, placed: [], active, exfoliant, priority, lastFailure: '' };

    let target = p.frequency as number;
    let capReason: Demand['capReason'];
    if (!p.prescription && isRetinoid && target > RETINOID_START_CAP) {
      target = RETINOID_START_CAP;
      capReason = { reason: 'Retinoids: every other night to start, at night only.', sourceIds: ['aad-retinoid'] };
    } else if (!p.prescription && exfoliant && target > EXFOLIANT_NIGHTS_CAP) {
      target = EXFOLIANT_NIGHTS_CAP;
      capReason = { reason: 'Exfoliants: 2–3 times a week at most, and never on retinoid nights.', sourceIds: ['aad-exfoliate'] };
    }

    if (p.usage === 'both' && sessions.length === 2) {
      for (const s of ['am', 'pm'] as const) demands.push({ ...base, placed: [], sessions: [s], requested: p.frequency, target, ...(capReason ? { capReason } : {}) });
    } else {
      demands.push({ ...base, sessions, requested: p.frequency, target, ...(capReason ? { capReason } : {}) });
    }
  }
  return demands.sort((x, y) => y.priority - x.priority || y.target - x.target || x.product.id.localeCompare(y.product.id));
}

function circularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 7;
  return Math.min(d, 7 - d);
}

export function planWeek(products: Product[], report: ShelfReport): WeeklyPlan {
  const days = Array.from({ length: 7 }, () => ({ am: [] as string[], pm: [] as string[] }));
  const activeIds = new Set(products.filter((p) => report.analyses[p.id]!.actives.length > 0).map((p) => p.id));
  const blockedBy = new Map<string, Set<string>>();
  for (const c of report.sessionConflicts) {
    blockedBy.set(c.a, (blockedBy.get(c.a) ?? new Set()).add(c.b));
    blockedBy.set(c.b, (blockedBy.get(c.b) ?? new Set()).add(c.a));
  }
  const demands = buildDemands(products, report);
  const shelfHasRetinoid = demands.some((d) => report.analyses[d.product.id]!.families.includes('retinoid') && !d.product.rinseOff);
  let exfoliantBudget = shelfHasRetinoid ? 7 - RETINOID_START_CAP : EXFOLIANT_NIGHTS_CAP + 1;
  const exfoliantDemands = demands.filter((d) => d.exfoliant);

  const placeOne = (d: Demand): boolean => {
    const id = d.product.id;
    const blocked = blockedBy.get(id) ?? new Set<string>();
    const k = d.placed.length;
    const ideal = Math.ceil((k * 7) / d.target) % 7;
    let best: { day: number; session: Session; score: number } | null = null;
    let failure = '';
    for (const [si, session] of d.sessions.entries()) {
      for (let day = 0; day < 7; day++) {
        const slot = days[day]![session];
        if (slot.includes(id)) continue;
        if (slot.some((other) => blocked.has(other))) {
          failure = 'conflicts with another active in every free session';
          continue;
        }
        const activesHere = slot.filter((x) => activeIds.has(x)).length;
        if (d.active && activesHere >= MAX_ACTIVES_PER_SESSION) {
          failure ||= `would put more than ${MAX_ACTIVES_PER_SESSION} actives in one session`;
          continue;
        }
        const mine = d.placed.filter((p) => p.session === session).map((p) => p.day);
        const adjacency = d.target <= 3 && mine.some((m) => circularDistance(m, day) === 1) ? 4 : 0;
        const score = si * 20 + (d.active ? activesHere * 6 : 0) + circularDistance(day, ideal) * 2 + adjacency;
        if (!best || score < best.score) best = { day, session, score };
      }
    }
    if (!best) {
      d.lastFailure = failure || 'no free session';
      return false;
    }
    days[best.day]![best.session].push(id);
    d.placed.push({ day: best.day, session: best.session });
    return true;
  };

  // Phase 1: anchors (retinoids, prescriptions, and non-exfoliant actives pinned to one
  // session) are placed completely, so everything else routes around them.
  const isAnchor = (d: Demand) =>
    !d.exfoliant && (d.priority >= 100 || d.product.prescription || (d.active && d.sessions.length === 1));
  for (const d of demands.filter(isAnchor)) {
    while (d.placed.length < d.target && placeOne(d));
  }

  // Phase 2: round-robin, so each pass gives every other demand one more application.
  let progress = true;
  while (progress) {
    progress = false;
    for (const d of demands) {
      if (isAnchor(d)) continue;
      if (d.placed.length >= d.target) continue;
      if (d.exfoliant && exfoliantBudget <= 0) continue;
      if (placeOne(d)) {
        progress = true;
        if (d.exfoliant) exfoliantBudget--;
      } else {
        d.target = d.placed.length; // can't place more; stop trying
      }
    }
  }

  const adjustments: PlanAdjustment[] = [];
  const sharedNights = shelfHasRetinoid ? 7 - RETINOID_START_CAP : EXFOLIANT_NIGHTS_CAP + 1;
  for (const d of demands) {
    const scheduled = d.placed.length;
    if (scheduled >= d.requested) continue;
    const base = { productId: d.product.id, session: d.sessions[0]!, requested: d.requested, scheduled };
    if (d.lastFailure) {
      adjustments.push({ ...base, kind: 'conflict', reason: d.lastFailure, sourceIds: [] });
    } else if (d.exfoliant && exfoliantDemands.length > 1) {
      adjustments.push({
        ...base,
        kind: 'guidance',
        reason: `Exfoliants: 2–3 times a week, never on retinoid nights. Your ${exfoliantDemands.length} exfoliants share ${sharedNights} nights.`,
        sourceIds: ['aad-exfoliate'],
      });
    } else if (d.capReason) {
      adjustments.push({ ...base, kind: 'guidance', reason: d.capReason.reason, sourceIds: d.capReason.sourceIds });
    } else {
      adjustments.push({ ...base, kind: 'conflict', reason: 'no free session', sourceIds: [] });
    }
  }

  const byId = new Map(products.map((p) => [p.id, p]));
  for (const d of days) {
    for (const s of ['am', 'pm'] as const) {
      d[s].sort((a, b) => LAYER_ORDER[byId.get(a)!.category] - LAYER_ORDER[byId.get(b)!.category] || a.localeCompare(b));
    }
  }
  const restNights = days.flatMap((d, i) => (d.pm.some((id) => activeIds.has(id)) ? [] : [i]));
  return { days, adjustments, restNights };
}

/** Verifies a plan against the report's constraints. Used by tests and as a runtime assertion. */
export function planViolations(plan: WeeklyPlan, products: Product[], report: ShelfReport): string[] {
  const out: string[] = [];
  plan.days.forEach((d, day) => {
    for (const s of ['am', 'pm'] as const) {
      for (const c of report.sessionConflicts) {
        if (d[s].includes(c.a) && d[s].includes(c.b)) out.push(`${DAY_NAMES[day]} ${s}: ${c.a} with ${c.b} (${c.ruleId})`);
      }
      for (const id of d[s]) {
        const p = products.find((x) => x.id === id)!;
        const a = report.analyses[id]!;
        if (s === 'am' && a.families.includes('retinoid')) out.push(`${DAY_NAMES[day]} am: retinoid ${id}`);
        if (s === 'pm' && isSunscreen(p, a)) out.push(`${DAY_NAMES[day]} pm: sunscreen ${id}`);
      }
    }
  });
  return out;
}
