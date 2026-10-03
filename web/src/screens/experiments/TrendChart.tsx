import { useId, useState } from 'react';
import type { ConcernTrend } from '../../../../shared/experiments.ts';
import { scaleLinear, trendDomain, xTicks, yTicks } from '../../chart.ts';
import { formatDate, round1, signed } from '../../format.ts';

const W = 320;
const H = 190;
const M = { top: 14, right: 16, bottom: 28, left: 34 };

/**
 * One concern's raw score over the experiment's weeks, with the baseline ± noise
 * band shaded. A single series, so the title names it and no legend is needed.
 */
export function TrendChart({
  trend,
  noise,
  weeksTotal,
  baselineIds,
  takenAt,
}: {
  trend: ConcernTrend;
  noise: number;
  weeksTotal: number;
  baselineIds: Set<string>;
  takenAt: Map<string, string>;
}) {
  const uid = useId();
  const [active, setActive] = useState<number | null>(null);
  const { points, baseline } = trend;
  const d = trendDomain(points, baseline, noise, weeksTotal);
  const x = scaleLinear(d.x0, d.x1, M.left, W - M.right);
  const y = scaleLinear(d.y0, d.y1, H - M.bottom, M.top);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.weeks).toFixed(1)},${y(p.raw).toFixed(1)}`).join(' ');
  const last = points.at(-1);
  const act = active !== null ? points[active] : undefined;

  // Keep the two direct labels apart: the band label moves under the band, or
  // the last value moves under its point when there is no room below the band.
  let lastLabelY = last ? y(last.raw) - 10 : 0;
  let bandLabelY = baseline !== null ? y(baseline + noise) - 4 : 0;
  if (last && baseline !== null && Math.abs(lastLabelY - bandLabelY) < 14) {
    const below = y(baseline - noise) + 13;
    if (below < H - M.bottom - 2) bandLabelY = below;
    else lastLabelY = y(last.raw) + 17;
  }

  // Hit regions: each point owns the strip halfway to its neighbours.
  const strips = points.map((p, i) => {
    const prev = points[i - 1];
    const next = points[i + 1];
    const left = prev ? (x(prev.weeks) + x(p.weeks)) / 2 : M.left;
    const right = next ? (x(p.weeks) + x(next.weeks)) / 2 : W - M.right;
    return { left, width: Math.max(8, right - left) };
  });

  const deltaText = trend.delta !== null ? `${signed(trend.delta)} vs baseline` : 'No follow-up yet';
  const describe = `${trend.label}: ${points.length} scans. ${baseline !== null ? `Baseline ${round1(baseline)} ± ${round1(noise)}.` : ''} ${trend.latest !== null ? `Latest ${round1(trend.latest)}, ${deltaText}.` : ''}`;

  return (
    <figure className="chart" aria-labelledby={`${uid}-t`}>
      <div className="chart-title">
        <h4 id={`${uid}-t`}>{trend.label}</h4>
        <span className="chart-delta">{deltaText}</span>
      </div>
      <div className="chart-plot" onMouseLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={describe}>
          <g className="grid" aria-hidden="true">
            {yTicks(d.y0, d.y1).map((t) => (
              <line key={t} x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
            ))}
          </g>
          {baseline !== null ? (
            <g aria-hidden="true">
              <rect className="band" x={M.left} width={W - M.left - M.right} y={y(baseline + noise)} height={Math.max(1, y(baseline - noise) - y(baseline + noise))} rx="3" />
              <line className="baseline" x1={M.left} x2={W - M.right} y1={y(baseline)} y2={y(baseline)} />
              <text className="label-text" x={W - M.right} y={bandLabelY} textAnchor="end">
                baseline ±{round1(noise)}
              </text>
            </g>
          ) : null}
          <g className="axis" aria-hidden="true">
            {yTicks(d.y0, d.y1).map((t) => (
              <text key={t} x={M.left - 8} y={y(t) + 4} textAnchor="end">
                {t}
              </text>
            ))}
            {xTicks(d.x0, d.x1).map((t) => (
              <text key={t} x={x(t)} y={H - 8} textAnchor="middle">
                {t === 0 ? 'wk 0' : t}
              </text>
            ))}
          </g>
          {act ? <line className="crosshair" x1={x(act.weeks)} x2={x(act.weeks)} y1={M.top} y2={H - M.bottom} aria-hidden="true" /> : null}
          {points.length > 1 ? <path className="series" d={path} aria-hidden="true" /> : null}
          {points.map((p) => (
            <circle key={p.scanId} className={baselineIds.has(p.scanId) ? 'pt pt--baseline' : 'pt'} cx={x(p.weeks)} cy={y(p.raw)} r="4.5" aria-hidden="true" />
          ))}
          {last ? (
            <text className="label-text" x={Math.min(x(last.weeks), W - M.right)} y={lastLabelY} textAnchor="end" aria-hidden="true">
              {round1(last.raw)}
            </text>
          ) : null}
          {points.map((p, i) => (
            <g key={`hit-${p.scanId}`}>
              <rect
                className="hit"
                x={strips[i]!.left}
                y={M.top}
                width={strips[i]!.width}
                height={H - M.top - M.bottom}
                tabIndex={0}
                role="img"
                aria-label={`Week ${round1(p.weeks)}, raw ${round1(p.raw)}${baseline !== null ? `, ${signed(p.raw - baseline)} vs baseline` : ''}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
              <circle className={`focus-ring${active === i ? ' on' : ''}`} cx={x(p.weeks)} cy={y(p.raw)} r="8" aria-hidden="true" />
            </g>
          ))}
        </svg>
        {act ? (
          <div className="chart-tooltip" style={{ left: `${(x(act.weeks) / W) * 100}%`, top: `${(y(act.raw) / H) * 100}%` }} aria-hidden="true">
            <strong className="num">{round1(act.raw)}</strong> raw
            <br />
            Week {round1(act.weeks)}
            {takenAt.get(act.scanId) ? ` · ${formatDate(takenAt.get(act.scanId)!)}` : ''}
            {baseline !== null && !baselineIds.has(act.scanId) ? (
              <>
                <br />
                {signed(act.raw - baseline)} vs baseline
              </>
            ) : baselineIds.has(act.scanId) ? (
              <>
                <br />
                Baseline scan
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      <details>
        <summary className="xs">Data table</summary>
        <table className="chart-table">
          <thead>
            <tr>
              <th scope="col">Scan</th>
              <th scope="col">Week</th>
              <th scope="col">Raw</th>
              <th scope="col">vs baseline</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.scanId}>
                <td>
                  {takenAt.get(p.scanId) ? formatDate(takenAt.get(p.scanId)!) : '—'}
                  {baselineIds.has(p.scanId) ? ' (baseline)' : ''}
                </td>
                <td>{round1(p.weeks)}</td>
                <td>{round1(p.raw)}</td>
                <td>{baseline !== null ? signed(p.raw - baseline) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
