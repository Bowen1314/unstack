import type { ScanQuality } from './types.ts';

/**
 * Documented unit costs (docs.perfectcorp.com, "Unit Consumption" sections, read 2026-10-02).
 * The live price list from GET /s2s/v2.0/credit/feature-cost may raise these at runtime
 * but never lower them: the ledger always reserves the larger of the two.
 */
const SKIN_TIERS: { maxConcerns: number; sd: number; hd: number }[] = [
  { maxConcerns: 4, sd: 9, hd: 12 },
  { maxConcerns: 8, sd: 12, hd: 16 },
  { maxConcerns: 12, sd: 14, hd: 20 },
  { maxConcerns: 16, sd: 16, hd: 22 },
];

export const FITZPATRICK_UNITS = 10;
export const MAX_CONCERNS = 16;

export type Feature = 'skin-analysis' | 'fitzpatrick';

export function skinAnalysisUnits(concernCount: number, quality: ScanQuality): number {
  if (concernCount < 1) throw new RangeError('Pick at least one concern');
  const tier = SKIN_TIERS.find((t) => concernCount <= t.maxConcerns);
  if (!tier) throw new RangeError(`At most ${MAX_CONCERNS} concerns per scan`);
  return quality === 'hd' ? tier.hd : tier.sd;
}

/** The next tier boundary: lets the UI say "adding one more concern costs +3 units". */
export function nextTierCost(concernCount: number, quality: ScanQuality): { at: number; units: number } | null {
  const i = SKIN_TIERS.findIndex((t) => t.maxConcerns === concernCount);
  const next = i >= 0 ? SKIN_TIERS[i + 1] : undefined;
  return next ? { at: concernCount + 1, units: quality === 'hd' ? next.hd : next.sd } : null;
}

/** Image size rules for SD vs HD skin analysis (short side ≥ 480 / ≥ 1080, < 10 MB). */
export function qualityForImage(width: number, height: number): ScanQuality | null {
  const short = Math.min(width, height);
  if (short >= 1080) return 'hd';
  if (short >= 480) return 'sd';
  return null;
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
