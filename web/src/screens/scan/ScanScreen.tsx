import { useEffect, useMemo, useState } from 'react';
import type { ScanRequest } from '../../../../shared/api.ts';
import { CONCERNS, DEFAULT_CONCERNS } from '../../../../shared/concerns.ts';
import { skinAnalysisUnits } from '../../../../shared/pricing.ts';
import type { Concern, ScanQuality } from '../../../../shared/types.ts';
import { api, errorMessage } from '../../api.ts';
import { IconScan } from '../../components/icons.tsx';
import { Banner, DemoRibbon, PageHead } from '../../components/ui.tsx';
import { isDemoId } from '../../demo.ts';
import { formatDate, ledgerLine, plural, qualityLabel, tierHint } from '../../format.ts';
import { getScanMedia } from '../../idb.ts';
import { href } from '../../route.ts';
import { useServerStatus } from '../../serverStatus.ts';
import { dispatch, runningExperiments, useAppState } from '../../store.ts';
import { ConcernPicker } from './ConcernPicker.tsx';
import { ConsentCard } from './ConsentCard.tsx';
import { jobSteps, JobProgress } from './JobProgress.tsx';
import { dismissJob, isConsentError, liveMedia, startScan, useActiveJob } from './jobs.ts';
import { captureMethodOf, photoPayload, photoQuality, type PhotoChoice } from './photo.ts';
import { PhotoSource, type SamplesState } from './PhotoSource.tsx';
import { ScanResults } from './ScanResults.tsx';
import { SunProfileCard } from './SunProfileCard.tsx';

function useSamples(enabled: boolean): SamplesState {
  const [state, setState] = useState<SamplesState>({ list: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    api
      .samples(ctrl.signal)
      .then((list) => setState({ list, error: null }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState({ list: null, error: errorMessage(err).advice || 'Could not load the sample images.' });
      });
    return () => ctrl.abort();
  }, [enabled]);
  return state;
}

function HistoryThumb({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(liveMedia.get(id)?.photo ?? null);
  useEffect(() => {
    if (src) return;
    let alive = true;
    void getScanMedia(id).then((m) => {
      if (alive && m?.thumb) setSrc(m.thumb);
    });
    return () => {
      alive = false;
    };
  }, [id, src]);
  return src ? <img className="history-thumb" src={src} alt="" /> : <span className="history-thumb" aria-hidden="true" />;
}

export function ScanScreen() {
  const state = useAppState();
  const server = useServerStatus();
  const job = useActiveJob();
  const scanJob = job?.kind === 'scan' ? job : null;

  const [viewId, setViewId] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PhotoChoice | null>(null);
  const running = runningExperiments(state)[0] ?? null;
  const baseline = running ? state.scans.find((s) => s.id === running.scanIds[0]) : undefined;
  const [concerns, setConcerns] = useState<Concern[]>(() => [...new Set<Concern>([...DEFAULT_CONCERNS, ...(running?.targetConcerns ?? [])])]);
  const [quality, setQuality] = useState<ScanQuality>('sd');
  const [attach, setAttach] = useState(true);
  const [submitError, setSubmitError] = useState<{ title: string; advice: string; code: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const consent = state.consent;
  const consentOutdated = Boolean(consent && server.status && consent.version !== server.status.consentVersion);
  const consentOk = Boolean(consent) && !consentOutdated;
  const samples = useSamples(consentOk);

  const maxQuality = photo ? photoQuality(photo) : null;

  // Pick the best quality the photo allows, but match the experiment baseline when we can.
  useEffect(() => {
    if (!maxQuality) return;
    if (baseline && (baseline.quality === 'sd' || maxQuality === 'hd')) setQuality(baseline.quality);
    else setQuality(maxQuality);
  }, [maxQuality, baseline]);

  // A finished scan opens its results.
  useEffect(() => {
    if (scanJob?.resultId) {
      setViewId(scanJob.resultId);
      dismissJob();
    }
  }, [scanJob?.resultId]);

  const cost = useMemo(() => {
    try {
      return concerns.length > 0 ? skinAnalysisUnits(concerns.length, quality) : null;
    } catch {
      return null;
    }
  }, [concerns.length, quality]);
  const hint = tierHint(concerns.length, quality);
  const live = server.status?.mode === 'live';
  const overCap = Boolean(live && cost !== null && server.status && cost > server.status.units.available);
  const missingTargets = running ? running.targetConcerns.filter((c) => !concerns.includes(c)) : [];

  const blocker = !photo
    ? 'Choose a photo first.'
    : !maxQuality
      ? 'This photo is too small for YouCam.'
      : concerns.length === 0
        ? 'Pick at least one concern.'
        : server.phase === 'offline'
          ? 'The Unstack server is not reachable.'
          : overCap
            ? 'Not enough units left on the ledger for this scan.'
            : null;

  const submit = async (p: PhotoChoice | null = photo) => {
    if (!p || !consent || (blocker && p === photo)) return;
    setSubmitError(null);
    setSubmitting(true);
    const req: ScanRequest = { consentId: consent.consentId, concerns, quality, captureMethod: captureMethodOf(p), ...photoPayload(p) };
    try {
      await startScan(req, p, running && attach ? running.id : null);
    } catch (err) {
      if (isConsentError(err)) dispatch({ type: 'consent/clear' });
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- Results ----------
  if (viewId) return <ScanResults scanId={viewId} onBack={() => setViewId(null)} />;

  // ---------- Progress ----------
  if (scanJob && !scanJob.resultId) {
    return (
      <>
        <PageHead title="Skin scan" lede="Your photo is on its way through YouCam. Each step below is a real API call." />
        <div className="scan-layout">
          <JobProgress
            job={scanJob}
            onRetake={() => {
              dismissJob();
              setPhoto(null);
            }}
            onRetry={() => {
              const p = scanJob.photo;
              dismissJob();
              setPhoto(p);
              void submit(p);
            }}
            onDismiss={dismissJob}
          />
          <aside className="card card--sunk stack-sm">
            <h3>While you wait</h3>
            <p className="small muted">
              The photo exists only in the server’s memory. After the results are copied, Unstack asks YouCam to delete the task and every file attached to it.
            </p>
            <p className="small muted">You can leave this screen; the scan keeps going and its results are saved to this device.</p>
          </aside>
        </div>
      </>
    );
  }

  const history = [...state.scans].reverse();

  return (
    <>
      <PageHead
        eyebrow="YouCam Skin Analysis API"
        title="Skin scan"
        lede="Pick the concerns you care about and see the unit cost before you scan. Results map to the products on your shelf."
      />

      <div className="stack-lg">
        {server.phase === 'offline' ? (
          <Banner tone="warn" title="Server not reachable">
            <span>Scanning needs the Unstack server, which holds the YouCam key. Start it with npm run dev. Your shelf, plan and past scans still work.</span>
          </Banner>
        ) : null}

        {!consentOk ? (
          <ConsentCard outdated={consentOutdated} />
        ) : (
          <>
            {running ? (
              <Banner tone="info" title={`Experiment running: ${running.title}`}>
                <label className="check">
                  <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
                  Add this scan to the experiment
                </label>
                {baseline ? (
                  <span className="xs">
                    Baseline: {qualityLabel(baseline.quality)}, {baseline.captureMethod === 'camera-kit' ? 'camera guide' : baseline.captureMethod}. Matching both keeps the comparison fair.
                  </span>
                ) : null}
              </Banner>
            ) : null}

            <div className="scan-layout">
              <div className="stack">
                <section className="card" aria-labelledby="scan-photo-h">
                  <div className="card-head">
                    <div>
                      <div className="eyebrow">Step 1</div>
                      <h2 id="scan-photo-h">Photo</h2>
                    </div>
                  </div>
                  <PhotoSource photo={photo} onChange={setPhoto} samples={samples} />
                </section>
                <section className="card" aria-labelledby="scan-concerns-h">
                  <div className="card-head">
                    <div>
                      <div className="eyebrow">Step 2</div>
                      <h2 id="scan-concerns-h">Concerns</h2>
                    </div>
                  </div>
                  <ConcernPicker value={concerns} onChange={setConcerns} required={running?.targetConcerns ?? []} />
                </section>
              </div>

              <aside className="card cost-box" aria-labelledby="scan-cost-h">
                <div>
                  <div className="eyebrow">Step 3</div>
                  <h2 id="scan-cost-h">Cost and scan</h2>
                </div>
                <div className="field">
                  <span className="field-label" id="q-label">
                    Quality
                  </span>
                  <div className="seg" role="radiogroup" aria-labelledby="q-label">
                    {(['sd', 'hd'] as const).map((q) => {
                      const disabled = !maxQuality || (q === 'hd' && maxQuality !== 'hd');
                      return (
                        <label key={q}>
                          <input type="radio" name="scan-quality" value={q} checked={quality === q} disabled={disabled} onChange={() => setQuality(q)} />
                          {qualityLabel(q)}
                        </label>
                      );
                    })}
                  </div>
                  <span className="hint">
                    {!photo
                      ? 'Chosen automatically from the photo size.'
                      : maxQuality === 'hd'
                        ? 'HD needs a short side of 1080 px or more, which this photo has. SD is cheaper.'
                        : maxQuality === 'sd'
                          ? 'HD needs a short side of at least 1080 px, so this photo is SD only.'
                          : 'YouCam needs at least 480 px on the short side.'}
                  </span>
                </div>
                {baseline && quality !== baseline.quality ? (
                  <Banner tone="warn">
                    <span>Your experiment baseline is {qualityLabel(baseline.quality)}. An {qualityLabel(quality)} scan can’t be compared with it and will be left out of the trend.</span>
                  </Banner>
                ) : null}

                <div className="cost-figure" aria-live="polite">
                  <span className="cost-n">{cost ?? '—'}</span>
                  <span className="cost-unit">{cost === 1 ? 'unit' : 'units'}</span>
                  {server.status?.mode === 'mock' ? <DemoRibbon>Demo</DemoRibbon> : null}
                </div>
                <p className="small muted num">{ledgerLine(cost, server.status)}</p>
                {hint ? (
                  <p className="xs subtle">
                    {hint.roomLeft > 0 ? `${plural(hint.roomLeft, 'more concern')} at this price. ` : ''}
                    {hint.next ? `Going to ${hint.next.at} concerns costs ${hint.next.units} units.` : 'This is the top price tier.'}
                  </p>
                ) : null}
                {missingTargets.length > 0 ? (
                  <Banner tone="warn">
                    <span>Your experiment tracks {missingTargets.map((c) => CONCERNS[c].label.toLowerCase()).join(', ')}. Add {missingTargets.length === 1 ? 'it' : 'them'} so this scan counts.</span>
                  </Banner>
                ) : null}

                <dl className="dl">
                  <dt>Live unit sync</dt>
                  <dd>{server.status ? (server.status.prices.source === 'docs+live' ? 'Docs + live price list' : 'Documented prices') : '—'}</dd>
                  {live && server.status?.youcamBalance !== null && server.status?.youcamBalance !== undefined ? (
                    <>
                      <dt>YouCam balance</dt>
                      <dd>{server.status.youcamBalance} units</dd>
                    </>
                  ) : null}
                </dl>

                <button type="button" className="btn btn--primary btn--lg btn--block" disabled={Boolean(blocker) || submitting || Boolean(job && !job.error && !job.resultId)} onClick={() => void submit()}>
                  <IconScan />
                  {submitting ? 'Starting…' : 'Analyse with YouCam'}
                </button>
                {blocker ? <p className="xs subtle">{blocker}</p> : null}
                {submitError ? (
                  <Banner tone="error" title={submitError.title} role="alert">
                    {submitError.advice ? <span>{submitError.advice}</span> : null}
                  </Banner>
                ) : null}

                <details>
                  <summary>What happens when you press it</summary>
                  <ol className="stack-sm small muted" style={{ paddingLeft: '1.2em', marginTop: 8 }}>
                    {jobSteps('scan', photo?.kind === 'sample', cost ?? 0)
                      .slice(1, 5)
                      .map((s) => (
                        <li key={s.stage}>
                          <strong style={{ color: 'var(--ink)' }}>{s.title}.</strong> <span className="mono">{s.call}</span>
                        </li>
                      ))}
                  </ol>
                </details>
                <p className="xs subtle">
                  Consent given {consent ? formatDate(consent.grantedAt) : ''}. <a href={href('privacy')}>Withdraw or review</a>
                </p>
              </aside>
            </div>

            <SunProfileCard photo={photo} consentId={consent?.consentId ?? null} />
          </>
        )}

        {history.length > 0 ? (
          <section className="card" aria-labelledby="history-h">
            <div className="card-head">
              <div>
                <h2 id="history-h">Past scans</h2>
                <p className="small muted">Stored on this device only.</p>
              </div>
            </div>
            <ul className="history-list">
              {history.map((s) => (
                <li key={s.id}>
                  <HistoryThumb id={s.id} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <strong className="small">{formatDate(s.takenAt)}</strong>
                      {isDemoId(s.id) ? <DemoRibbon /> : null}
                    </div>
                    <span className="xs subtle">
                      {qualityLabel(s.quality)} · {plural(s.scores.filter((x) => x.region === 'whole').length || s.concerns.length, 'concern')}
                      {s.overall !== null ? ` · overall ${Math.round(s.overall)}` : ''}
                    </span>
                  </div>
                  <button type="button" className="btn btn--sm" onClick={() => setViewId(s.id)}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
