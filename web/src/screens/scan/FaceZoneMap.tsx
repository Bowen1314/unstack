import { CONCERNS, type ScoredConcern } from '../../../../shared/concerns.ts';
import type { ConcernScore } from '../../../../shared/types.ts';
import { round1 } from '../../format.ts';

type ZoneId = 'forehead' | 'lidL' | 'lidR' | 'underL' | 'underR' | 'nose' | 'cheekL' | 'cheekR' | 'chin' | 'jaw';

const ZONE_LABEL: Record<ZoneId, string> = {
  forehead: 'forehead',
  lidL: 'upper eyelids',
  lidR: 'upper eyelids',
  underL: 'under-eye',
  underR: 'under-eye',
  nose: 'nose',
  cheekL: 'cheeks',
  cheekR: 'cheeks',
  chin: 'chin',
  jaw: 'jawline',
};

const ZONES_FOR: Record<ScoredConcern, ZoneId[]> = {
  moisture: ['forehead', 'cheekL', 'cheekR'],
  oiliness: ['forehead', 'nose', 'chin'],
  pore: ['forehead', 'nose', 'cheekL', 'cheekR'],
  texture: ['forehead', 'cheekL', 'cheekR'],
  acne: ['forehead', 'cheekL', 'cheekR', 'chin'],
  radiance: ['forehead', 'cheekL', 'cheekR'],
  age_spot: ['forehead', 'cheekL', 'cheekR'],
  redness: ['nose', 'cheekL', 'cheekR'],
  wrinkle: ['forehead', 'underL', 'underR'],
  firmness: ['jaw', 'cheekL', 'cheekR'],
  dark_circle: ['underL', 'underR'],
  eye_bag: ['underL', 'underR'],
  tear_trough: ['underL', 'underR'],
  droopy_upper_eyelid: ['lidL', 'lidR'],
  droopy_lower_eyelid: ['underL', 'underR'],
};

/** YouCam region names (HD pore/wrinkle) → our zones. */
const REGION_TO_ZONES: Record<string, ZoneId[]> = {
  forehead: ['forehead'],
  glabellar: ['forehead'],
  nose: ['nose'],
  cheek: ['cheekL', 'cheekR'],
  nasolabial: ['cheekL', 'cheekR'],
  crowfeet: ['underL', 'underR'],
  periocular: ['underL', 'underR'],
  marionette: ['chin'],
  chin: ['chin'],
};

const SHAPES: Record<Exclude<ZoneId, 'jaw'>, { cx: number; cy: number; rx: number; ry: number }> = {
  forehead: { cx: 100, cy: 56, rx: 50, ry: 20 },
  lidL: { cx: 70, cy: 92, rx: 16, ry: 5 },
  lidR: { cx: 130, cy: 92, rx: 16, ry: 5 },
  underL: { cx: 70, cy: 112, rx: 17, ry: 7 },
  underR: { cx: 130, cy: 112, rx: 17, ry: 7 },
  nose: { cx: 100, cy: 128, rx: 11, ry: 22 },
  cheekL: { cx: 60, cy: 150, rx: 21, ry: 21 },
  cheekR: { cx: 140, cy: 150, rx: 21, ry: 21 },
  chin: { cx: 100, cy: 212, rx: 22, ry: 12 },
};

const JAW = 'M38 164 C46 198 72 226 100 230 C128 226 154 198 162 164';

/** Deeper tint = lower raw score = more visible concern. */
function tint(raw: number): number {
  const level = Math.min(1, Math.max(0, (100 - raw) / 100));
  return 0.1 + level * 0.75;
}

export interface ZoneReading {
  zone: string;
  raw: number;
  regional: boolean;
}

export function zoneReadings(concern: ScoredConcern, scores: ConcernScore[], headlineRaw: number): Map<ZoneId, ZoneReading> {
  const out = new Map<ZoneId, ZoneReading>();
  const regional = scores.filter((s) => s.concern === concern && s.region !== 'whole');
  for (const z of ZONES_FOR[concern]) {
    const hit = regional.find((s) => REGION_TO_ZONES[s.region]?.includes(z));
    out.set(z, { zone: ZONE_LABEL[z], raw: hit ? hit.raw : headlineRaw, regional: Boolean(hit) });
  }
  return out;
}

/**
 * Schematic face map used when the scan has no masks (demo mode). It shows the
 * zones each concern is usually read from, tinted by score. It is not aligned
 * to the photo, and says so.
 */
export function FaceZoneMap({ concern, scores, headlineRaw }: { concern: ScoredConcern | null; scores: ConcernScore[]; headlineRaw: number | null }) {
  const readings = concern && headlineRaw !== null ? zoneReadings(concern, scores, headlineRaw) : new Map<ZoneId, ZoneReading>();
  const label = concern ? CONCERNS[concern].label : null;
  const summary = [...new Map([...readings.values()].map((r) => [r.zone, r])).values()];

  return (
    <figure className="zone-map" style={{ margin: 0 }}>
      <svg viewBox="0 0 200 250" role="img" aria-label={label ? `Approximate face zones for ${label}` : 'Approximate face zones'}>
        <path
          d="M100 14 C150 14 176 52 176 104 C176 150 164 186 140 212 C126 228 112 236 100 236 C88 236 74 228 60 212 C36 186 24 150 24 104 C24 52 50 14 100 14 Z"
          fill="none"
          stroke="var(--line-strong)"
          strokeWidth="1.5"
        />
        {(Object.keys(SHAPES) as (keyof typeof SHAPES)[]).map((z) => {
          const r = readings.get(z);
          const s = SHAPES[z];
          return (
            <ellipse
              key={z}
              cx={s.cx}
              cy={s.cy}
              rx={s.rx}
              ry={s.ry}
              fill={r ? 'var(--zone)' : 'transparent'}
              fillOpacity={r ? tint(r.raw) : 0}
              stroke={r ? 'var(--zone)' : 'var(--line)'}
              strokeOpacity={r ? 0.9 : 1}
              strokeWidth="1"
              strokeDasharray={r ? undefined : '3 3'}
            />
          );
        })}
        {readings.get('jaw') ? (
          <path d={JAW} fill="none" stroke="var(--zone)" strokeOpacity={tint(readings.get('jaw')!.raw)} strokeWidth="9" strokeLinecap="round" />
        ) : null}
        <g fill="none" stroke="var(--ink-3)" strokeWidth="1.4" strokeLinecap="round">
          <path d="M52 82 Q68 74 86 80" />
          <path d="M114 80 Q132 74 148 82" />
          <path d="M57 100 Q70 93 83 100 Q70 105 57 100 Z" />
          <path d="M117 100 Q130 93 143 100 Q130 105 117 100 Z" />
          <path d="M100 106 L95 140 Q100 145 105 140" />
          <path d="M84 182 Q100 189 116 182" />
        </g>
      </svg>
      <figcaption>
        {label ? (
          <>
            <strong style={{ color: 'var(--ink-2)' }}>{label}</strong>
            {' · '}
            {summary.map((r, i) => (
              <span key={r.zone} className="num">
                {i > 0 ? ', ' : ''}
                {r.zone} {r.regional ? round1(r.raw) : ''}
              </span>
            ))}
            <br />
          </>
        ) : (
          <>
            Pick a concern to see where it is read from.
            <br />
          </>
        )}
        Approximate zones (demo) · deeper = more visible
      </figcaption>
    </figure>
  );
}
