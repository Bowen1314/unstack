/**
 * Synthetic demo history, generated only when the user clicks "Load demo
 * history", so judges can see a six-week experiment without waiting six weeks.
 * Every record is mode 'mock' and every id starts with "demo-", and the UI
 * labels it as demo data wherever it appears.
 */
import { DEFAULT_CONCERNS } from '../../shared/concerns.ts';
import type { ConcernScore, Experiment, ScanResult, SkinTypeReading } from '../../shared/types.ts';

export const DEMO_PREFIX = 'demo-';
const DAY_MS = 86_400_000;

export function isDemoId(id: string): boolean {
  return id.startsWith(DEMO_PREFIX);
}

type Scored = 'moisture' | 'oiliness' | 'pore' | 'texture' | 'acne' | 'redness' | 'age_spot' | 'wrinkle';

/** Raw scores per scan (day 0, day 2 duplicate baseline, week 3, week 6), one per default concern. */
const SERIES: Record<Scored, [number, number, number, number]> = {
  moisture: [47.5, 49.0, 55.2, 58.6],
  oiliness: [58.2, 57.4, 59.1, 58.3],
  pore: [55.1, 56.0, 55.4, 57.2],
  texture: [61.0, 62.3, 61.5, 63.1],
  acne: [63.4, 62.1, 65.0, 66.3],
  redness: [52.4, 54.1, 59.8, 66.2],
  age_spot: [70.2, 71.0, 70.4, 70.1],
  wrinkle: [74.1, 73.3, 74.0, 75.2],
};

const PORE_REGIONS: Record<'forehead' | 'nose' | 'cheek', number> = { forehead: 4, nose: -9, cheek: 2 };

const SKIN_TYPES: SkinTypeReading[][] = [
  [
    { region: 'whole', value: 'Combination & Redness', mask: null },
    { region: 't_zone', value: 'Oily', mask: null },
    { region: 'u_zone', value: 'Dry & Redness', mask: null },
  ],
  [
    { region: 'whole', value: 'Combination & Redness', mask: null },
    { region: 't_zone', value: 'Oily', mask: null },
    { region: 'u_zone', value: 'Dry & Redness', mask: null },
  ],
  [
    { region: 'whole', value: 'Combination', mask: null },
    { region: 't_zone', value: 'Oily', mask: null },
    { region: 'u_zone', value: 'Dry', mask: null },
  ],
  [
    { region: 'whole', value: 'Combination', mask: null },
    { region: 't_zone', value: 'Oily', mask: null },
    { region: 'u_zone', value: 'Normal', mask: null },
  ],
];

const DAYS = [0, 2, 21, 42] as const;

/** YouCam's ui_score is adjusted upward for display; mimic that so the demo looks like real output. */
export function demoUiScore(raw: number): number {
  return Math.min(99, Math.max(1, Math.round(38 + raw * 0.62)));
}

export interface DemoHistory {
  scans: ScanResult[];
  experiment: Experiment;
}

export function makeDemoHistory(now: Date, newId: () => string = () => crypto.randomUUID()): DemoHistory {
  // The last scan is an hour ago, so the timeline ends "today".
  const end = now.getTime() - 3600_000;
  const start = end - DAYS[3] * DAY_MS;
  const concerns = DEFAULT_CONCERNS.filter((c): c is Scored => c in SERIES);

  const scans: ScanResult[] = DAYS.map((day, i) => {
    const scores: ConcernScore[] = [];
    for (const concern of concerns) {
      const raw = SERIES[concern][i]!;
      scores.push({ concern, region: 'whole', raw, ui: demoUiScore(raw), mask: null });
      if (concern === 'pore') {
        for (const [region, offset] of Object.entries(PORE_REGIONS)) {
          const r = Math.round((raw + offset) * 10) / 10;
          scores.push({ concern, region, raw: r, ui: demoUiScore(r), mask: null });
        }
      }
    }
    const wholeUi = scores.filter((s) => s.region === 'whole').map((s) => s.ui);
    const overall = Math.round((wholeUi.reduce((t, v) => t + v, 0) / wholeUi.length) * 10) / 10;
    return {
      id: `${DEMO_PREFIX}${newId()}`,
      takenAt: new Date(start + day * DAY_MS).toISOString(),
      quality: 'sd',
      captureMethod: 'camera-kit',
      concerns: [...concerns, 'skin_type'],
      scores,
      skinType: SKIN_TYPES[i]!.map((t) => ({ ...t })),
      skinAge: i < 2 ? 31 : 30,
      overall,
      unitsCharged: 0,
      mode: 'mock',
      remoteDeleted: true,
    };
  });

  const experiment: Experiment = {
    id: `${DEMO_PREFIX}${newId()}`,
    title: 'Stop the 7% glycolic toner',
    change: { kind: 'remove', productId: `${DEMO_PREFIX}glycolic-toner`, productName: 'Glow Tonic 7% Glycolic' },
    targetConcerns: ['redness', 'texture', 'moisture'],
    startedAt: new Date(start).toISOString(),
    weeks: 8,
    scanIds: scans.map((s) => s.id),
    otherChanges: [{ at: new Date(start + 17 * DAY_MS).toISOString(), description: 'Added Centella Soothing Gel' }],
    status: 'running',
  };

  return { scans, experiment };
}
