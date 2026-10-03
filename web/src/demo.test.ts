import { describe, expect, it } from 'vitest';
import { analyseExperiment } from '../../shared/experiments.ts';
import { DEMO_PREFIX, demoUiScore, isDemoId, makeDemoHistory } from './demo.ts';

describe('makeDemoHistory', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  let n = 0;
  const { scans, experiment } = makeDemoHistory(now, () => `id${n++}`);

  it('produces four mock scans over six weeks, all labelled as demo data', () => {
    expect(scans).toHaveLength(4);
    expect(scans.every((s) => s.mode === 'mock' && isDemoId(s.id) && s.unitsCharged === 0)).toBe(true);
    const spanDays = (new Date(scans[3]!.takenAt).getTime() - new Date(scans[0]!.takenAt).getTime()) / 86_400_000;
    expect(spanDays).toBe(42);
    expect(new Date(scans[3]!.takenAt).getTime()).toBeLessThan(now.getTime());
    expect(experiment.id.startsWith(DEMO_PREFIX)).toBe(true);
    expect(experiment.scanIds).toEqual(scans.map((s) => s.id));
  });

  it('is accepted by analyseExperiment and tells the intended story', () => {
    const a = analyseExperiment(experiment, scans, now);
    expect(a.excludedScans).toEqual([]);
    expect(a.noiseMeasured).toBe(true);
    expect(a.noise).toBeGreaterThanOrEqual(2);
    expect(a.verdict).toBe('improving');
    const byConcern = Object.fromEntries(a.trends.map((t) => [t.concern, t]));
    expect(byConcern.redness!.verdict).toBe('improving');
    expect(byConcern.moisture!.verdict).toBe('improving');
    expect(byConcern.texture!.verdict).toBe('no-clear-change');
    expect(a.trends.every((t) => t.points.length === 4)).toBe(true);
    expect(a.confounders.some((c) => c.includes('Centella'))).toBe(true);
    expect(a.nextCheckIn).not.toBeNull();
  });

  it('mimics YouCam’s upward-adjusted ui score', () => {
    for (const raw of [1, 30, 52.4, 99]) {
      const ui = demoUiScore(raw);
      expect(ui).toBeGreaterThanOrEqual(Math.round(raw));
      expect(ui).toBeLessThanOrEqual(99);
    }
  });
});
