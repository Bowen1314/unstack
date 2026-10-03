/**
 * Scan results travel with masks (data URLs) that are too large for
 * localStorage. These pure helpers split a ScanResult into the slim record kept
 * in localStorage and the mask map kept in IndexedDB, and join them back.
 */
import type { ScanResult } from '../../shared/types.ts';

export type MaskMap = Record<string, string>;

export function maskKey(kind: 'score' | 'skin', name: string, region: string): string {
  return `${kind}:${name}:${region}`;
}

export function extractMasks(scan: ScanResult): MaskMap {
  const out: MaskMap = {};
  for (const s of scan.scores) if (s.mask) out[maskKey('score', s.concern, s.region)] = s.mask;
  for (const t of scan.skinType) if (t.mask) out[maskKey('skin', t.value, t.region)] = t.mask;
  return out;
}

export function stripMasks(scan: ScanResult): ScanResult {
  return {
    ...scan,
    scores: scan.scores.map((s) => ({ ...s, mask: null })),
    skinType: scan.skinType.map((t) => ({ ...t, mask: null })),
  };
}

export function applyMasks(scan: ScanResult, masks: MaskMap | null | undefined): ScanResult {
  if (!masks) return scan;
  return {
    ...scan,
    scores: scan.scores.map((s) => ({ ...s, mask: masks[maskKey('score', s.concern, s.region)] ?? s.mask })),
    skinType: scan.skinType.map((t) => ({ ...t, mask: masks[maskKey('skin', t.value, t.region)] ?? t.mask })),
  };
}

export function hasAnyMask(scan: ScanResult): boolean {
  return scan.scores.some((s) => s.mask) || scan.skinType.some((t) => t.mask);
}
