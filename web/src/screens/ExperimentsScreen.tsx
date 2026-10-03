import { useMemo, useState } from 'react';
import { CONCERNS } from '../../../shared/concerns.ts';
import { analyseExperiment, CHECK_IN_EVERY_WEEKS, DEFAULT_NOISE, type Verdict } from '../../../shared/experiments.ts';
import type { Experiment, ScanResult } from '../../../shared/types.ts';
import { IconAlertCircle, IconCheckCircle, IconClock, IconFlask, IconInfo, IconMinusCircle, IconScan, IconTrend } from '../components/icons.tsx';
import { Banner, ConfirmButton, DemoRibbon, PageHead, showToast } from '../components/ui.tsx';
import { isDemoId, makeDemoHistory } from '../demo.ts';
import { daysBetween, formatDate, relativeDays, round1 } from '../format.ts';
import { deleteScanMedia } from '../idb.ts';
import { href } from '../route.ts';
import { dispatch, useAppState } from '../store.ts';
import { NewExperimentForm } from './experiments/NewExperimentForm.tsx';
import { TrendChart } from './experiments/TrendChart.tsx';

const VERDICT: Record<Verdict, { label: string; cls: string; Icon: typeof IconInfo }> = {
  improving: { label: 'Improving', cls: 'tag--ok', Icon: IconTrend },
  worse: { label: 'Worse', cls: 'tag--high', Icon: IconAlertCircle },
  'no-clear-change': { label: 'No clear change', cls: 'tag--plain', Icon: IconMinusCircle },
  'too-early': { label: 'Too early to tell', cls: 'tag--info', Icon: IconClock },
  'no-data': { label: 'Needs a baseline', cls: 'tag--plain', Icon: IconInfo },
};

const DUPLICATE_DAYS = 3;

function VerdictTag({ verdict }: { verdict: Verdict }) {
  const v = VERDICT[verdict];
  return (
    <span className={`tag ${v.cls}`}>
      <v.Icon />
      {v.label}
    </span>
  );
}

/** Same rule as shared/experiments.ts: comparable scans within 3 days of the first one form the baseline. */
function baselineIdsFor(exp: Experiment, scans: ScanResult[]): Set<string> {
  const own = exp.scanIds.map((id) => scans.find((s) => s.id === id)).filter((s): s is ScanResult => Boolean(s)).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const base = own[0];
  if (!base) return new Set();
  return new Set(
    own
      .filter((s) => s.quality === base.quality && s.mode === base.mode && new Date(s.takenAt).getTime() - new Date(base.takenAt).getTime() <= DUPLICATE_DAYS * 86_400_000)
      .map((s) => s.id),
  );
}

function ExperimentCard({ exp, scans, compact = false }: { exp: Experiment; scans: ScanResult[]; compact?: boolean }) {
  const now = useMemo(() => new Date(), []);
  const a = useMemo(() => analyseExperiment(exp, scans, now), [exp, scans, now]);
  const baselineIds = useMemo(() => baselineIdsFor(exp, scans), [exp, scans]);
  const takenAt = useMemo(() => new Map(scans.map((s) => [s.id, s.takenAt])), [scans]);
  const demo = isDemoId(exp.id);
  const own = exp.scanIds.map((id) => scans.find((s) => s.id === id)).filter((s): s is ScanResult => Boolean(s));
  const base = own.sort((x, y) => x.takenAt.localeCompare(y.takenAt))[0];
  const week = Math.min(exp.weeks, Math.floor(a.weeksElapsed));
  const pct = Math.min(100, (a.weeksElapsed / exp.weeks) * 100);
  const offerDuplicate = exp.status === 'running' && base && own.length === 1 && daysBetween(base.takenAt, now) <= DUPLICATE_DAYS;
  const duplicateBy = base ? new Date(new Date(base.takenAt).getTime() + DUPLICATE_DAYS * 86_400_000).toISOString() : null;

  const charts = (
    <div className="chart-grid">
      {a.trends.map((t) => (
        <TrendChart key={t.concern} trend={t} noise={a.noise} weeksTotal={exp.weeks} baselineIds={baselineIds} takenAt={takenAt} />
      ))}
    </div>
  );

  return (
    <article className={`card stack${exp.status === 'running' ? ' card--accent' : ''}`} aria-labelledby={`exp-${exp.id}`}>
      <div className="exp-head">
        <div className="stack-sm" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="eyebrow">{exp.status === 'running' ? 'Running' : exp.status === 'finished' ? 'Finished' : 'Abandoned'}</span>
            {demo ? <DemoRibbon>Demo data</DemoRibbon> : null}
          </div>
          <h2 id={`exp-${exp.id}`}>{exp.title}</h2>
          <div className="exp-meta">
            <span>
              {exp.change.kind === 'add' ? 'Added' : 'Stopped'} <strong>{exp.change.productName}</strong>
            </span>
            <span>Started {formatDate(exp.startedAt)}</span>
            <span className="num">
              Week {week} of {exp.weeks}
            </span>
            <span>Watching {exp.targetConcerns.map((c) => CONCERNS[c].label.toLowerCase()).join(', ')}</span>
          </div>
        </div>
        <VerdictTag verdict={a.verdict} />
      </div>
      {exp.status === 'running' ? (
        <div className="exp-progress" role="progressbar" aria-valuemin={0} aria-valuemax={exp.weeks} aria-valuenow={Math.round(a.weeksElapsed * 10) / 10} aria-label="Weeks elapsed">
          <span style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      <p>{a.summary}</p>
      <p className="xs subtle">
        Noise band ±{round1(a.noise)} raw points
        {a.noiseMeasured ? ', measured from your two baseline scans.' : `, assumed (${DEFAULT_NOISE}) until a second baseline scan measures it.`} Changes inside the band are treated as no
        change.
      </p>

      {compact ? (
        <details>
          <summary>Show charts</summary>
          <div style={{ marginTop: 'var(--space-3)' }}>{charts}</div>
        </details>
      ) : (
        charts
      )}

      {a.confounders.length > 0 ? (
        <div className="stack-sm">
          <span className="eyebrow">Other things that changed</span>
          <ul className="confounders">
            {a.confounders.map((c, i) => (
              <li key={i}>
                <IconAlertCircle />
                <span>{c}</span>
              </li>
            ))}
          </ul>
          <p className="xs subtle">Any of these could explain a change as well as {exp.change.productName} can.</p>
        </div>
      ) : exp.status === 'running' && own.length > 0 ? (
        <p className="small muted row" style={{ gap: 6 }}>
          <IconCheckCircle width={16} height={16} style={{ color: 'var(--ok)' }} /> Nothing else on your shelf has changed. A clean test so far.
        </p>
      ) : null}

      {a.excludedScans.length > 0 ? (
        <div className="stack-sm">
          <span className="eyebrow">Left out of the trend</span>
          <ul className="confounders">
            {a.excludedScans.map((x) => (
              <li key={x.scanId}>
                <IconMinusCircle />
                <span>
                  {takenAt.get(x.scanId) ? formatDate(takenAt.get(x.scanId)!) : 'A scan'}: {x.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {offerDuplicate && duplicateBy ? (
        <Banner tone="info" title="Measure your noise">
          <span>
            Take a second baseline scan by {formatDate(duplicateBy)}, with the same camera set-up. <a href={href('scan')}>Scan now</a>
          </span>
        </Banner>
      ) : null}
      {exp.status === 'running' && own.length === 0 ? (
        <Banner tone="warn" title="No baseline yet">
          <span>
            Scan before the change takes effect. <a href={href('scan')}>Take the baseline scan</a>
          </span>
        </Banner>
      ) : null}

      <div className="row-between">
        <p className="small muted icon-line">
          {a.nextCheckIn ? (
            <>
              <IconClock width={16} height={16} />
              <span>
                Next check-in {formatDate(a.nextCheckIn)} ({relativeDays(a.nextCheckIn, now)}), every {CHECK_IN_EVERY_WEEKS} weeks
              </span>
            </>
          ) : exp.status === 'running' ? (
            'Planned length reached. Finish it when you’re ready.'
          ) : null}
        </p>
        <div className="row">
          {exp.status === 'running' ? (
            <>
              <a className="btn btn--sm" href={href('scan')}>
                <IconScan />
                Check-in scan
              </a>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  dispatch({ type: 'experiment/status', id: exp.id, status: 'finished' });
                  showToast('Experiment finished. Shelf edits are no longer logged against it.');
                }}
              >
                Finish
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => dispatch({ type: 'experiment/status', id: exp.id, status: 'abandoned' })}>
                Abandon
              </button>
            </>
          ) : null}
          {!demo ? (
            <ConfirmButton
              label="Delete"
              className="btn btn--ghost btn--sm"
              prompt="Delete this experiment? Its scans stay in your history."
              confirmLabel="Delete experiment"
              onConfirm={() => dispatch({ type: 'experiment/remove', id: exp.id })}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function ExperimentsScreen() {
  const { experiments, scans } = useAppState();
  const [creating, setCreating] = useState(false);
  const running = experiments.filter((e) => e.status === 'running');
  const past = experiments.filter((e) => e.status !== 'running').reverse();
  const hasDemo = experiments.some((e) => isDemoId(e.id)) || scans.some((s) => isDemoId(s.id));
  const realRunning = running.some((e) => !isDemoId(e.id));

  const loadDemo = () => {
    const { scans: demoScans, experiment } = makeDemoHistory(new Date());
    dispatch({ type: 'demo/load', scans: demoScans, experiment });
    showToast('Loaded six weeks of synthetic demo scans.');
  };

  const clearDemo = async () => {
    for (const s of scans.filter((x) => isDemoId(x.id))) await deleteScanMedia(s.id);
    dispatch({ type: 'demo/clear' });
  };

  return (
    <>
      <PageHead
        title="Experiments"
        lede="Change one thing, wait, measure. Unstack compares each check-in scan against your baseline, inside an honest noise band, and tells you when something else changed too."
        actions={
          hasDemo ? (
            <ConfirmButton label="Remove demo history" className="btn btn--ghost" prompt="Remove the demo experiment and its synthetic scans?" confirmLabel="Remove" onConfirm={clearDemo} />
          ) : (
            <button type="button" className="btn" onClick={loadDemo}>
              Load demo history
            </button>
          )
        }
      />

      <div className="stack-lg">
        {experiments.length === 0 && !creating ? (
          <div className="card empty">
            <IconFlask width={32} height={32} style={{ color: 'var(--accent-ink)' }} />
            <h2>No experiments yet</h2>
            <p className="muted">
              Pick one product to add or stop and the concerns you expect it to change. Unstack will chart each check-in against your baseline. To see what that
              looks like without waiting six weeks, load the demo history.
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
                Start an experiment
              </button>
              <button type="button" className="btn" onClick={loadDemo}>
                Load demo history
              </button>
            </div>
          </div>
        ) : null}

        {running.map((e) => (
          <ExperimentCard key={e.id} exp={e} scans={scans} />
        ))}

        {creating || (experiments.length > 0 && running.length === 0) ? (
          <NewExperimentForm onCancel={experiments.length === 0 ? () => setCreating(false) : undefined} />
        ) : running.length > 0 && !realRunning ? (
          <Banner tone="info" title="Want to run your own?">
            <span>
              Finish or remove the demo experiment first. One experiment at a time keeps the result readable.{' '}
              <button type="button" className="link-btn" onClick={() => setCreating(true)}>
                Start anyway
              </button>
            </span>
          </Banner>
        ) : null}

        {past.length > 0 ? (
          <section className="stack" aria-labelledby="past-h">
            <div className="section-title">
              <h2 id="past-h">Past experiments</h2>
            </div>
            {past.map((e) => (
              <ExperimentCard key={e.id} exp={e} scans={scans} compact />
            ))}
          </section>
        ) : null}
      </div>
    </>
  );
}
