import { describe, expect, it } from 'vitest';
import type { StatusResponse } from '../../shared/api.ts';
import { qualityForImage } from '../../shared/pricing.ts';
import type { ScanResult } from '../../shared/types.ts';
import { scaleLinear, trendDomain, xTicks, yTicks } from './chart.ts';
import { adjustmentLine, formatDate, ledgerLine, listJoin, plural, signed, tierHint, unitsPill } from './format.ts';
import { asDataUrl, checkPhotoFile, dataUrlBytes, dataUrlMime, fitWithin, LABEL_MAX_LONG_SIDE, SCAN_MAX_LONG_SIDE, THUMB_MAX_LONG_SIDE } from './image.ts';
import { parseRoute } from './route.ts';
import { applyMasks, extractMasks, hasAnyMask, stripMasks } from './scanMedia.ts';

function status(mode: 'mock' | 'live', used = 36, reserved = 0): StatusResponse {
  return {
    mode,
    units: { cap: 200, used, reserved, available: 200 - used - reserved, ledger: mode },
    youcamBalance: mode === 'live' ? 964 : null,
    prices: { source: 'docs', fitzpatrick: 10 },
    llm: { enabled: true, model: 'demo', spentUsd: 0, capUsd: 2 },
    consentVersion: '2026-10-02',
  };
}

describe('image downscale math', () => {
  it('never upscales and keeps the aspect ratio when shrinking', () => {
    expect(fitWithin(1200, 1600, LABEL_MAX_LONG_SIDE)).toEqual({ width: 1200, height: 1600, scale: 1 });
    expect(fitWithin(3024, 4032, LABEL_MAX_LONG_SIDE)).toEqual({ width: 1200, height: 1600, scale: 1600 / 4032 });
    expect(fitWithin(4000, 3000, THUMB_MAX_LONG_SIDE)).toMatchObject({ width: 480, height: 360 });
    expect(fitWithin(0, 100, 480).width).toBe(0);
  });

  it('a 12 MP phone photo downscaled for YouCam is still HD-capable', () => {
    const { width, height } = fitWithin(3024, 4032, SCAN_MAX_LONG_SIDE);
    expect(Math.max(width, height)).toBe(2560);
    expect(qualityForImage(width, height)).toBe('hd');
  });

  it('measures base64 payloads', () => {
    expect(dataUrlBytes('data:image/png;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:image/png;base64,AAA=')).toBe(2);
    expect(dataUrlBytes('nonsense')).toBe(0);
    expect(dataUrlMime('data:image/jpeg;base64,xx')).toBe('image/jpeg');
    expect(asDataUrl('abc')).toBe('data:image/jpeg;base64,abc');
    expect(asDataUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
  });

  it('rejects unsupported types and files over 10 MB', () => {
    expect(checkPhotoFile({ type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(checkPhotoFile({ type: 'image/heic', size: 1000 })).toMatch(/JPG or PNG/);
    expect(checkPhotoFile({ type: 'image/png', size: 11 * 1024 * 1024 })).toMatch(/under 10 MB/);
  });
});

describe('formatting', () => {
  it('pluralises and joins', () => {
    expect(plural(1, 'unit')).toBe('1 unit');
    expect(plural(12, 'unit')).toBe('12 units');
    expect(listJoin(['a', 'b', 'c'])).toBe('a, b and c');
    expect(signed(3.25)).toBe('+3.3');
    expect(signed(-2)).toBe('−2.0');
    expect(signed(0)).toBe('0.0');
  });

  it('describes plan reductions', () => {
    expect(adjustmentLine('pm', 7, 4)).toBe('7 → 4 nights/week');
    expect(adjustmentLine('am', 7, 1)).toBe('7 → 1 morning/week');
  });

  it('formats dates relative to the current year', () => {
    const now = new Date('2026-10-02T12:00:00Z');
    expect(formatDate('2026-10-02T12:00:00Z', now)).toBe('Oct 2');
    expect(formatDate('2025-03-01T12:00:00Z', now)).toBe('Mar 1, 2025');
    expect(formatDate('garbage', now)).toBe('—');
  });

  it('writes the ledger line for live and demo mode', () => {
    expect(ledgerLine(12, status('live'))).toBe('12 units · 36 of 200 used this ledger');
    expect(ledgerLine(12, status('live', 36, 9))).toBe('12 units · 36 of 200 used this ledger (9 reserved)');
    expect(ledgerLine(12, status('mock'))).toMatch(/^Demo mode/);
    expect(ledgerLine(12, null)).toMatch(/not reachable/);
    expect(unitsPill(status('live'))).toBe('164 units left');
    expect(unitsPill(status('mock'))).toBe('No real units');
  });

  it('explains the price tiers', () => {
    expect(tierHint(5, 'sd')).toEqual({ current: 12, roomLeft: 3, next: { at: 9, units: 14 } });
    expect(tierHint(4, 'hd')).toEqual({ current: 12, roomLeft: 0, next: { at: 5, units: 16 } });
    expect(tierHint(16, 'sd')).toEqual({ current: 16, roomLeft: 0, next: null });
    expect(tierHint(0, 'sd')).toBeNull();
  });
});

describe('chart scales', () => {
  it('covers the experiment length, the data and the noise band', () => {
    const d = trendDomain(
      [
        { weeks: 0, raw: 52 },
        { weeks: 6, raw: 66 },
      ],
      53,
      3,
      8,
    );
    expect(d.x0).toBe(0);
    expect(d.x1).toBe(8);
    expect(d.y0).toBeLessThanOrEqual(46);
    expect(d.y1).toBeGreaterThanOrEqual(70);
    expect(d.y0 % 5).toBe(0);
    expect(d.y1 % 5).toBe(0);
  });

  it('keeps a readable minimum height and stays inside 0–100', () => {
    const flat = trendDomain([{ weeks: 0, raw: 98 }], null, 4, 4);
    expect(flat.y1).toBe(100);
    expect(flat.y1 - flat.y0).toBeGreaterThanOrEqual(15);
    const neg = trendDomain([{ weeks: -0.3, raw: 50 }], 50, 4, 6);
    expect(neg.x0).toBeCloseTo(-0.3);
  });

  it('produces tidy ticks', () => {
    expect(yTicks(40, 70)).toEqual([40, 50, 60, 70]);
    expect(xTicks(0, 6)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(xTicks(0, 12)).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(scaleLinear(0, 10, 0, 100)(2.5)).toBe(25);
  });
});

describe('scan media split', () => {
  const scan: ScanResult = {
    id: 's1',
    takenAt: '2026-10-02T10:00:00Z',
    quality: 'hd',
    captureMethod: 'upload',
    concerns: ['pore', 'skin_type'],
    scores: [
      { concern: 'pore', region: 'whole', raw: 50, ui: 70, mask: 'data:image/png;base64,AAAA' },
      { concern: 'pore', region: 'nose', raw: 40, ui: 62, mask: 'data:image/png;base64,BBBB' },
    ],
    skinType: [{ region: 't_zone', value: 'Oily', mask: 'data:image/png;base64,CCCC' }],
    skinAge: 30,
    overall: 70,
    unitsCharged: 16,
    mode: 'live',
    remoteDeleted: true,
  };

  it('strips masks for localStorage and restores them from the IndexedDB map', () => {
    const masks = extractMasks(scan);
    expect(Object.keys(masks)).toHaveLength(3);
    const slim = stripMasks(scan);
    expect(hasAnyMask(slim)).toBe(false);
    expect(JSON.stringify(slim)).not.toContain('base64');
    expect(applyMasks(slim, masks)).toEqual(scan);
    expect(applyMasks(slim, null)).toEqual(slim);
  });
});

describe('routes', () => {
  it('parses hashes and falls back to the shelf', () => {
    expect(parseRoute('#/check')).toBe('check');
    expect(parseRoute('#/scan/abc')).toBe('scan');
    expect(parseRoute('#experiments')).toBe('experiments');
    expect(parseRoute('')).toBe('shelf');
    expect(parseRoute('#/nope')).toBe('shelf');
  });
});
