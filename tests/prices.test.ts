import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFeatureCosts, PriceBook } from '../server/prices.ts';
import type { FeatureCostSku, YouCamClient } from '../server/youcam/types.ts';
import { FIXTURES, mockClient } from './support.ts';

const recorded = (JSON.parse(readFileSync(resolve(FIXTURES, 'feature-cost.json'), 'utf8')) as { skus: FeatureCostSku[] }).skus;

function clientWith(skus: FeatureCostSku[]): YouCamClient {
  const c = mockClient();
  c.getFeatureCosts = async () => skus;
  return c;
}

const sku = (description: string, amount: number, path: string): FeatureCostSku => ({
  description,
  amount,
  unit: 'result_image',
  proc_unit: 1,
  run_task_url: `https://yce-api-01.makeupar.com${path}`,
});

describe('live price list', () => {
  it('parses the recorded feature-cost list (v2.1 tiers and Fitzpatrick)', () => {
    const p = parseFeatureCosts(recorded);
    expect(p.fitzpatrick).toBe(10);
    expect(p.skin).toHaveLength(8);
    expect(p.skin).toContainEqual({ quality: 'sd', min: 1, max: 4, units: 9 });
    expect(p.skin).toContainEqual({ quality: 'hd', min: 13, max: 16, units: 22 });
  });

  it('matches the documented table for every tier', async () => {
    const book = new PriceBook();
    const before = [1, 4, 5, 8, 9, 12, 13, 16].map((n) => [book.skinUnits(n, 'sd'), book.skinUnits(n, 'hd')]);
    await book.refresh(mockClient());
    expect(book.hasLive).toBe(true);
    expect([1, 4, 5, 8, 9, 12, 13, 16].map((n) => [book.skinUnits(n, 'sd'), book.skinUnits(n, 'hd')])).toEqual(before);
    expect(book.fitzpatrickUnits()).toBe(10);
  });

  it('a higher live price wins; a lower one never does', async () => {
    const book = new PriceBook();
    await book.refresh(
      clientWith([
        sku('AI Skin Analysis V2.1 SD (1-4 concerns)', 11, '/s2s/v2.1/task/skin-analysis'),
        sku('AI Skin Analysis V2.1 SD (5-8 concerns)', 3, '/s2s/v2.1/task/skin-analysis'),
        sku('AI Skin Analysis V2.0 SD (1-4 concerns)', 99, '/s2s/v2.0/task/skin-analysis'), // other version: ignored
        sku('AI Fitzpatrick Skin Type Analysis V1.0', 12, '/s2s/v2.0/task/fitzpatrick-scale-analyzer'),
      ]),
    );
    expect(book.skinUnits(3, 'sd')).toBe(11);
    expect(book.skinUnits(6, 'sd')).toBe(12);
    expect(book.fitzpatrickUnits()).toBe(12);
  });

  it('keeps the documented prices when the list is empty or fails', async () => {
    const book = new PriceBook();
    await book.refresh(clientWith([]));
    expect(book.hasLive).toBe(false);
    const failing = mockClient();
    failing.getFeatureCosts = async () => {
      throw new Error('down');
    };
    await expect(book.refresh(failing)).rejects.toThrow('down');
    expect(book.skinUnits(4, 'sd')).toBe(9);
  });
});
