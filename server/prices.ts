import { FITZPATRICK_UNITS, MAX_CONCERNS, skinAnalysisUnits } from '../shared/pricing.ts';
import type { ScanQuality } from '../shared/types.ts';
import type { FeatureCostSku, YouCamClient } from './youcam/types.ts';

/**
 * Unit prices: the documented table (shared/pricing.ts) combined with the live
 * list from GET /s2s/v2.0/credit/feature-cost (free). The live list may raise
 * a price but never lower it, so the ledger always reserves the larger figure.
 *
 * SKU descriptions seen on 2026-10-02: "AI Skin Analysis V2.1 SD (1-4 concerns)",
 * "AI Fitzpatrick Skin Type Analysis V1.0" (fixtures/recorded/feature-cost.json).
 */

const SKIN_SKU = /skin analysis v2\.1 (sd|hd) \((\d+)\s*-\s*(\d+) concerns?\)/i;

export interface LivePrices {
  skin: { quality: ScanQuality; min: number; max: number; units: number }[];
  fitzpatrick: number | null;
}

export function parseFeatureCosts(skus: FeatureCostSku[]): LivePrices {
  const skin: LivePrices['skin'] = [];
  let fitzpatrick: number | null = null;
  for (const s of skus) {
    if (typeof s.amount !== 'number' || typeof s.run_task_url !== 'string') continue;
    // amount is per proc_unit result images; every task here returns one result.
    const units = s.amount;
    const m = SKIN_SKU.exec(s.description ?? '');
    if (m && s.run_task_url.includes('/v2.1/task/skin-analysis')) {
      skin.push({ quality: m[1]!.toLowerCase() as ScanQuality, min: Number(m[2]), max: Number(m[3]), units });
    } else if (s.run_task_url.includes('/task/fitzpatrick-scale-analyzer') && !s.run_task_url.includes('pre-process')) {
      fitzpatrick = Math.max(fitzpatrick ?? 0, units);
    }
  }
  return { skin, fitzpatrick };
}

export class PriceBook {
  private live: LivePrices | null = null;
  private loadedAt: number | null = null;
  private inflight: Promise<void> | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  /** Re-read the live price list. Errors leave the previous list in place. */
  refresh(client: YouCamClient): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = client
      .getFeatureCosts()
      .then((skus) => {
        const parsed = parseFeatureCosts(skus);
        if (parsed.skin.length > 0 || parsed.fitzpatrick !== null) {
          this.live = parsed;
          this.loadedAt = this.now();
        }
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  get hasLive(): boolean {
    return this.live !== null;
  }

  get liveLoadedAt(): number | null {
    return this.loadedAt;
  }

  skinUnits(concernCount: number, quality: ScanQuality): number {
    const docs = skinAnalysisUnits(Math.min(concernCount, MAX_CONCERNS), quality);
    const tier = this.live?.skin.find((t) => t.quality === quality && concernCount >= t.min && concernCount <= t.max);
    return Math.max(docs, tier?.units ?? 0);
  }

  fitzpatrickUnits(): number {
    return Math.max(FITZPATRICK_UNITS, this.live?.fitzpatrick ?? 0);
  }
}
