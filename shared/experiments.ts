import { CONCERNS, headlineScores, type ScoredConcern } from './concerns.ts';
import type { Experiment, ScanResult } from './types.ts';

/**
 * One-change experiments: compare per-concern YouCam raw scores against a
 * baseline, inside an honest noise band, and flag anything that makes the
 * comparison unfair (other shelf changes, different capture method, SD vs HD).
 */

export const DEFAULT_NOISE = 4; // raw-score points; our assumption until a duplicate baseline gives a measured value
export const MIN_WEEKS_TO_JUDGE = 4; // AAD: improvement should show in 4 to 6 weeks
export const CHECK_IN_EVERY_WEEKS = 2;
const DUPLICATE_BASELINE_DAYS = 3;
const WEEK_MS = 7 * 24 * 3600 * 1000;

export type Verdict = 'improving' | 'worse' | 'no-clear-change' | 'too-early' | 'no-data';

export interface TrendPoint {
  scanId: string;
  weeks: number;
  raw: number;
}

export interface ConcernTrend {
  concern: ScoredConcern;
  label: string;
  points: TrendPoint[];
  baseline: number | null;
  latest: number | null;
  delta: number | null;
  slopePerWeek: number | null;
  verdict: Verdict;
}

export interface ExperimentAnalysis {
  weeksElapsed: number;
  noise: number;
  noiseMeasured: boolean;
  trends: ConcernTrend[];
  verdict: Verdict;
  summary: string;
  confounders: string[];
  excludedScans: { scanId: string; reason: string }[];
  nextCheckIn: string | null;
}

function slope(points: TrendPoint[]): number | null {
  if (points.length < 2) return null;
  const n = points.length;
  const mx = points.reduce((t, p) => t + p.weeks, 0) / n;
  const my = points.reduce((t, p) => t + p.raw, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.weeks - mx) * (p.raw - my);
    den += (p.weeks - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}

export function analyseExperiment(exp: Experiment, allScans: ScanResult[], now: Date): ExperimentAnalysis {
  const start = new Date(exp.startedAt).getTime();
  const weeksElapsed = Math.max(0, (now.getTime() - start) / WEEK_MS);
  const scans = exp.scanIds
    .map((id) => allScans.find((s) => s.id === id))
    .filter((s): s is ScanResult => Boolean(s))
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));

  const excludedScans: ExperimentAnalysis['excludedScans'] = [];
  const confounders: string[] = [];
  const base = scans[0];
  const comparable = scans.filter((s) => {
    if (!base) return false;
    if (s.quality !== base.quality) {
      excludedScans.push({ scanId: s.id, reason: `${s.quality.toUpperCase()} scan can't be compared with the ${base.quality.toUpperCase()} baseline` });
      return false;
    }
    if (s.mode !== base.mode) {
      excludedScans.push({ scanId: s.id, reason: 'demo-mode scan mixed with a live scan' });
      return false;
    }
    return true;
  });

  if (new Set(comparable.map((s) => s.captureMethod)).size > 1) {
    confounders.push('Photos were taken in different ways (camera guide vs uploaded photo), so lighting and distance may differ.');
  }
  for (const c of exp.otherChanges) confounders.push(`Another change during the experiment: ${c.description}`);

  // Duplicate baseline: a second scan within 3 days of the first measures scan-to-scan noise.
  const baselineScans = base
    ? comparable.filter((s) => new Date(s.takenAt).getTime() - new Date(base.takenAt).getTime() <= DUPLICATE_BASELINE_DAYS * 24 * 3600 * 1000)
    : [];
  let noise = DEFAULT_NOISE;
  let noiseMeasured = false;
  if (baselineScans.length >= 2) {
    const diffs = exp.targetConcerns.flatMap((c) => {
      const a = headlineScores(baselineScans[0]!).get(c)?.raw;
      const b = headlineScores(baselineScans[1]!).get(c)?.raw;
      return a !== undefined && b !== undefined ? [Math.abs(a - b)] : [];
    });
    if (diffs.length > 0) {
      noise = Math.max(2, Math.round(Math.max(...diffs) * 1.5 * 10) / 10);
      noiseMeasured = true;
    }
  }

  const trends: ConcernTrend[] = exp.targetConcerns.map((concern) => {
    const points: TrendPoint[] = comparable.flatMap((s) => {
      const score = headlineScores(s).get(concern);
      return score ? [{ scanId: s.id, weeks: (new Date(s.takenAt).getTime() - start) / WEEK_MS, raw: score.raw }] : [];
    });
    const basePoints = points.filter((p) => baselineScans.some((b) => b.id === p.scanId));
    const baseline = basePoints.length > 0 ? basePoints.reduce((t, p) => t + p.raw, 0) / basePoints.length : null;
    const after = points.filter((p) => !basePoints.includes(p));
    const latest = after.at(-1)?.raw ?? null;
    const delta = baseline !== null && latest !== null ? Math.round((latest - baseline) * 10) / 10 : null;
    let verdict: Verdict;
    if (delta === null) verdict = 'no-data';
    else if (weeksElapsed < MIN_WEEKS_TO_JUDGE) verdict = 'too-early';
    else if (delta > noise) verdict = 'improving';
    else if (delta < -noise) verdict = 'worse';
    else verdict = 'no-clear-change';
    return { concern, label: CONCERNS[concern].label, points, baseline, latest, delta, slopePerWeek: slope(points), verdict };
  });

  let verdict: Verdict;
  if (trends.some((t) => t.verdict === 'worse')) verdict = 'worse';
  else if (trends.every((t) => t.verdict === 'no-data')) verdict = 'no-data';
  else if (trends.some((t) => t.verdict === 'too-early')) verdict = 'too-early';
  else if (trends.some((t) => t.verdict === 'improving')) verdict = 'improving';
  else verdict = 'no-clear-change';

  const verb = exp.change.kind === 'add' ? 'adding' : 'removing';
  const summary = {
    'no-data': `Take a baseline scan before ${verb} ${exp.change.productName}, then check in every ${CHECK_IN_EVERY_WEEKS} weeks.`,
    'too-early': `It's week ${Math.floor(weeksElapsed)}. Skin needs at least ${MIN_WEEKS_TO_JUDGE} weeks before a change in ${exp.change.productName} can show, so keep going.`,
    improving: `Since ${verb} ${exp.change.productName}, ${trends.filter((t) => t.verdict === 'improving').map((t) => t.label.toLowerCase()).join(' and ')} improved by more than the ±${noise} noise band.`,
    worse: `${trends.filter((t) => t.verdict === 'worse').map((t) => t.label).join(' and ')} got worse by more than the ±${noise} noise band since ${verb} ${exp.change.productName}. Consider stopping it.`,
    'no-clear-change': `After ${Math.floor(weeksElapsed)} weeks, nothing moved beyond the ±${noise} noise band. ${exp.change.productName} may not be doing much for these concerns.`,
  }[verdict];

  const lastScan = scans.at(-1);
  const nextCheckIn =
    exp.status === 'running' && weeksElapsed < exp.weeks
      ? new Date(Math.max(start, lastScan ? new Date(lastScan.takenAt).getTime() : start) + CHECK_IN_EVERY_WEEKS * WEEK_MS).toISOString()
      : null;

  return { weeksElapsed, noise, noiseMeasured, trends, verdict, summary, confounders, excludedScans, nextCheckIn };
}
