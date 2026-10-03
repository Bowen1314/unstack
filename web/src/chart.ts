/** Pure scale math for the hand-written SVG trend charts. */

export interface Domain {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * X spans the experiment (week 0 → planned length, stretched to fit any
 * points); Y spans the data and the baseline ± noise band, padded and snapped
 * to multiples of 5 inside 0–100, at least 15 points tall.
 */
export function trendDomain(points: { weeks: number; raw: number }[], baseline: number | null, noise: number, weeksTotal: number): Domain {
  const xs = points.map((p) => p.weeks);
  const x0 = Math.min(0, ...xs);
  const x1 = Math.max(weeksTotal, ...xs, x0 + 1);
  const ys = points.map((p) => p.raw);
  if (baseline !== null) ys.push(baseline - noise, baseline + noise);
  if (ys.length === 0) return { x0, x1, y0: 40, y1: 80 };
  let y0 = Math.max(0, Math.floor((Math.min(...ys) - 4) / 5) * 5);
  let y1 = Math.min(100, Math.ceil((Math.max(...ys) + 4) / 5) * 5);
  while (y1 - y0 < 15) {
    if (y0 > 0) y0 -= 5;
    if (y1 - y0 < 15 && y1 < 100) y1 += 5;
    if (y0 === 0 && y1 === 100) break;
  }
  return { x0, x1, y0, y1 };
}

/** Evenly spaced ticks with a step of 5, 10 or 20, at most `max` of them. */
export function yTicks(y0: number, y1: number, max = 5): number[] {
  const step = [5, 10, 20, 25, 50].find((s) => (y1 - y0) / s + 1 <= max) ?? 50;
  const out: number[] = [];
  for (let v = Math.ceil(y0 / step) * step; v <= y1 + 1e-9; v += step) out.push(v);
  return out;
}

/** Whole-week ticks, every week up to 8 weeks, every 2 beyond. */
export function xTicks(x0: number, x1: number): number[] {
  const step = x1 - x0 > 8 ? 2 : 1;
  const out: number[] = [];
  for (let v = Math.ceil(x0 / step) * step; v <= x1 + 1e-9; v += step) out.push(v);
  return out;
}

export function scaleLinear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}
