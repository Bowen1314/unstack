import { FAMILY_LABEL } from './ingredients.ts';
import type { ShelfReport } from './rules.ts';
import type { Concern, ConcernScore, Evidence, Family, Product, ScanQuality, ScanResult } from './types.ts';

export type ScoredConcern = Exclude<Concern, 'skin_type'>;

interface ConcernInfo {
  label: string;
  blurb: string;
  sd: string;
  hd: string;
  /** Ingredient families commonly used for this concern, with honest evidence labels. */
  families: { family: Family; evidence: Evidence }[];
  /** Shown instead of product advice where topicals do little. */
  note?: string;
}

export const CONCERNS: Record<Concern, ConcernInfo> = {
  moisture: {
    label: 'Hydration',
    blurb: 'How hydrated the skin surface looks.',
    sd: 'moisture',
    hd: 'hd_moisture',
    families: [
      { family: 'humectant', evidence: 'strong' },
      { family: 'barrier_lipid', evidence: 'moderate' },
      { family: 'occlusive', evidence: 'strong' },
    ],
  },
  oiliness: {
    label: 'Shine',
    blurb: 'Visible oil and shine.',
    sd: 'oiliness',
    hd: 'hd_oiliness',
    families: [
      { family: 'niacinamide', evidence: 'moderate' },
      { family: 'bha', evidence: 'moderate' },
    ],
  },
  pore: {
    label: 'Pores',
    blurb: 'How visible pores are.',
    sd: 'pore',
    hd: 'hd_pore',
    families: [
      { family: 'bha', evidence: 'moderate' },
      { family: 'retinoid', evidence: 'moderate' },
      { family: 'niacinamide', evidence: 'limited' },
    ],
  },
  texture: {
    label: 'Texture',
    blurb: 'Smoothness of the skin surface.',
    sd: 'texture',
    hd: 'hd_texture',
    families: [
      { family: 'aha', evidence: 'moderate' },
      { family: 'retinoid', evidence: 'moderate' },
      { family: 'bha', evidence: 'moderate' },
      { family: 'pha', evidence: 'limited' },
    ],
  },
  acne: {
    label: 'Blemishes',
    blurb: 'Visible spots and breakouts.',
    sd: 'acne',
    hd: 'hd_acne',
    families: [
      { family: 'benzoyl_peroxide', evidence: 'strong' },
      { family: 'retinoid', evidence: 'strong' },
      { family: 'bha', evidence: 'moderate' },
      { family: 'azelaic_acid', evidence: 'moderate' },
      { family: 'sulfur', evidence: 'limited' },
    ],
    note: 'Persistent, painful or scarring breakouts are worth seeing a dermatologist about.',
  },
  radiance: {
    label: 'Radiance',
    blurb: 'Brightness and evenness of glow.',
    sd: 'radiance',
    hd: 'hd_radiance',
    families: [
      { family: 'vitamin_c_laa', evidence: 'moderate' },
      { family: 'vitamin_c_derivative', evidence: 'limited' },
      { family: 'aha', evidence: 'moderate' },
      { family: 'niacinamide', evidence: 'limited' },
    ],
  },
  age_spot: {
    label: 'Dark spots',
    blurb: 'Spots and uneven pigmentation.',
    sd: 'age_spot',
    hd: 'hd_age_spot',
    families: [
      { family: 'sunscreen_filter', evidence: 'strong' },
      { family: 'vitamin_c_laa', evidence: 'moderate' },
      { family: 'azelaic_acid', evidence: 'moderate' },
      { family: 'niacinamide', evidence: 'moderate' },
      { family: 'brightener', evidence: 'moderate' },
      { family: 'retinoid', evidence: 'moderate' },
    ],
  },
  redness: {
    label: 'Redness',
    blurb: 'Visible redness.',
    sd: 'redness',
    hd: 'hd_redness',
    families: [
      { family: 'soothing', evidence: 'limited' },
      { family: 'azelaic_acid', evidence: 'moderate' },
      { family: 'barrier_lipid', evidence: 'limited' },
    ],
    note: 'Persistent redness can have medical causes. If it burns, stings or flushes, see a dermatologist.',
  },
  wrinkle: {
    label: 'Fine lines',
    blurb: 'Visible lines and wrinkles.',
    sd: 'wrinkle',
    hd: 'hd_wrinkle',
    families: [
      { family: 'sunscreen_filter', evidence: 'strong' },
      { family: 'retinoid', evidence: 'strong' },
      { family: 'peptide', evidence: 'limited' },
    ],
  },
  firmness: {
    label: 'Firmness',
    blurb: 'How firm and lifted skin looks.',
    sd: 'firmness',
    hd: 'hd_firmness',
    families: [
      { family: 'sunscreen_filter', evidence: 'moderate' },
      { family: 'retinoid', evidence: 'moderate' },
      { family: 'peptide', evidence: 'limited' },
    ],
  },
  dark_circle: {
    label: 'Dark circles',
    blurb: 'Darkness under the eyes.',
    sd: 'dark_circle_v2',
    hd: 'hd_dark_circle',
    families: [{ family: 'caffeine', evidence: 'limited' }],
    note: 'Under-eye darkness is mostly anatomy, pigment and sleep. No shelf product is likely to change it much, so think twice before buying for it.',
  },
  eye_bag: {
    label: 'Eye bags',
    blurb: 'Puffiness under the eyes.',
    sd: 'eye_bag',
    hd: 'hd_eye_bag',
    families: [{ family: 'caffeine', evidence: 'limited' }],
    note: 'Topical products have limited evidence for puffiness. Effects are temporary at best.',
  },
  tear_trough: {
    label: 'Tear trough',
    blurb: 'Hollowness under the eyes.',
    sd: 'tear_trough',
    hd: 'hd_tear_trough',
    families: [],
    note: 'This is structural. Skincare products won’t change it.',
  },
  droopy_upper_eyelid: {
    label: 'Upper eyelid',
    blurb: 'Upper eyelid droop.',
    sd: 'droopy_upper_eyelid',
    hd: 'hd_droopy_upper_eyelid',
    families: [],
    note: 'This is structural. Skincare products won’t change it.',
  },
  droopy_lower_eyelid: {
    label: 'Lower eyelid',
    blurb: 'Lower eyelid droop.',
    sd: 'droopy_lower_eyelid',
    hd: 'hd_droopy_lower_eyelid',
    families: [],
    note: 'This is structural. Skincare products won’t change it.',
  },
  skin_type: {
    label: 'Skin type',
    blurb: 'Oily, dry, combination or normal, by face zone.',
    sd: 'skin_type',
    hd: 'hd_skin_type',
    families: [],
  },
};

export const ALL_CONCERNS = Object.keys(CONCERNS) as Concern[];
export const DEFAULT_CONCERNS: Concern[] = ['moisture', 'oiliness', 'pore', 'texture', 'acne', 'redness', 'age_spot', 'wrinkle'];

/** Map our concern ids to YouCam dst_actions for the requested quality. SD and HD never mix. */
export function toDstActions(concerns: Concern[], quality: ScanQuality): string[] {
  return [...new Set(concerns)].map((c) => (quality === 'hd' ? CONCERNS[c].hd : CONCERNS[c].sd));
}

/** Inverse of toDstActions; returns null for anything we don't model (e.g. 'all', 'resize_image'). */
export function fromDstAction(action: string): Concern | null {
  const bare = action.replace(/^hd_/, '');
  if (bare === 'dark_circle_v2' || bare === 'dark_circle') return 'dark_circle';
  return (ALL_CONCERNS as string[]).includes(bare) ? (bare as Concern) : null;
}

/** One score per concern: the 'whole' region if present, otherwise the mean over regions. */
export function headlineScores(scan: Pick<ScanResult, 'scores'>): Map<ScoredConcern, ConcernScore> {
  const out = new Map<ScoredConcern, ConcernScore>();
  const grouped = new Map<ScoredConcern, ConcernScore[]>();
  for (const s of scan.scores) grouped.set(s.concern, [...(grouped.get(s.concern) ?? []), s]);
  for (const [concern, list] of grouped) {
    const whole = list.find((s) => s.region === 'whole');
    if (whole) out.set(concern, whole);
    else {
      const raw = list.reduce((t, s) => t + s.raw, 0) / list.length;
      const ui = Math.round(list.reduce((t, s) => t + s.ui, 0) / list.length);
      out.set(concern, { concern, region: 'whole', raw, ui, mask: list[0]?.mask ?? null });
    }
  }
  return out;
}

/**
 * Concerns worth focusing on: raw score under 65, up to four, lowest first.
 * If nothing is under 65, the two lowest. The threshold is our own heuristic
 * (YouCam doesn't publish score bands) and is labelled as such in the UI.
 */
export const FOCUS_THRESHOLD = 65;
export function pickFocus(scan: Pick<ScanResult, 'scores'>): ScoredConcern[] {
  const ranked = [...headlineScores(scan).values()].sort((a, b) => a.raw - b.raw);
  const low = ranked.filter((s) => s.raw < FOCUS_THRESHOLD).slice(0, 4);
  return (low.length > 0 ? low : ranked.slice(0, 2)).map((s) => s.concern);
}

export interface CoverageRow {
  concern: ScoredConcern;
  status: 'covered' | 'weak' | 'gap' | 'not-topical';
  products: { productId: string; family: Family; evidence: Evidence }[];
  note?: string;
}

export interface CoverageReport {
  rows: CoverageRow[];
  /** Products with actives that don't target any focus concern (candidates to not re-buy). */
  offFocus: { productId: string; families: Family[] }[];
}

const BASIC_CATEGORIES = new Set(['cleanser', 'moisturizer', 'sunscreen']);

export function coverage(products: Product[], report: ShelfReport, focus: ScoredConcern[]): CoverageReport {
  const rows: CoverageRow[] = focus.map((concern) => {
    const info = CONCERNS[concern];
    const hits: CoverageRow['products'] = [];
    for (const p of products) {
      const fams = report.analyses[p.id]?.families ?? [];
      const best = info.families.find((f) => fams.includes(f.family));
      if (best) hits.push({ productId: p.id, family: best.family, evidence: best.evidence });
    }
    let status: CoverageRow['status'];
    if (info.families.length === 0 || info.families.every((f) => f.evidence === 'limited')) status = hits.length > 0 ? 'weak' : 'not-topical';
    else if (hits.some((h) => h.evidence !== 'limited')) status = 'covered';
    else status = hits.length > 0 ? 'weak' : 'gap';
    const row: CoverageRow = { concern, status, products: hits };
    if (info.note) row.note = info.note;
    return row;
  });

  const focusFamilies = new Set(focus.flatMap((c) => CONCERNS[c].families.map((f) => f.family)));
  const offFocus = products
    .filter((p) => !BASIC_CATEGORIES.has(p.category) && !p.prescription)
    .map((p) => ({ productId: p.id, families: report.analyses[p.id]?.actives ?? [] }))
    .filter((x) => x.families.length > 0 && !x.families.some((f) => focusFamilies.has(f)));
  return { rows, offFocus };
}

export function familyList(fams: Family[]): string {
  return fams.map((f) => FAMILY_LABEL[f]).join(', ');
}
