import { useEffect, useMemo, useState } from 'react';
import { CONCERNS, headlineScores, pickFocus, type ScoredConcern } from '../../../../shared/concerns.ts';
import type { ScanResult } from '../../../../shared/types.ts';
import { IconArrowLeft, IconCheckCircle, IconFlask, IconTrash } from '../../components/icons.tsx';
import { Banner, ConfirmButton, DemoRibbon, PageHead } from '../../components/ui.tsx';
import { isDemoId } from '../../demo.ts';
import { useShelf } from '../../derive.ts';
import { formatDateTime, plural, qualityLabel, round1 } from '../../format.ts';
import { deleteScanMedia, getScanMedia } from '../../idb.ts';
import { href } from '../../route.ts';
import { applyMasks, hasAnyMask } from '../../scanMedia.ts';
import { dispatch } from '../../store.ts';
import { CoverageSection } from './CoverageTable.tsx';
import { FaceZoneMap } from './FaceZoneMap.tsx';
import { liveMedia } from './jobs.ts';

const CAPTURE_LABEL = { upload: 'Uploaded photo', 'camera-kit': 'YouCam Camera Kit', sample: 'YouCam sample image' } as const;

const SKIN_REGION_LABEL: Record<string, string> = { whole: 'Whole face', t_zone: 'T-zone', u_zone: 'U-zone (cheeks, jaw)' };

export function ScanResults({ scanId, onBack }: { scanId: string; onBack: () => void }) {
  const { state, report } = useShelf();
  const stored = state.scans.find((s) => s.id === scanId);
  const live = liveMedia.get(scanId);
  const [media, setMedia] = useState<{ photo: string | null; masks: Record<string, string> } | null>(live ? { photo: live.photo, masks: live.masks } : null);
  const [overlay, setOverlay] = useState<ScoredConcern | null>(null);

  useEffect(() => {
    if (live) return;
    let alive = true;
    void getScanMedia(scanId).then((m) => {
      if (alive) setMedia(m ? { photo: m.thumb, masks: m.masks } : { photo: null, masks: {} });
    });
    return () => {
      alive = false;
    };
  }, [scanId, live]);

  const scan: ScanResult | null = useMemo(() => (stored ? applyMasks(stored, media?.masks) : null), [stored, media]);
  const headlines = useMemo(() => (scan ? headlineScores(scan) : new Map()), [scan]);
  const focus = useMemo(() => (scan ? pickFocus(scan) : []), [scan]);

  useEffect(() => {
    if (overlay === null && focus[0]) setOverlay(focus[0]);
  }, [focus, overlay]);

  if (!scan) {
    return (
      <div className="card empty">
        <h2>Scan not found</h2>
        <p className="muted">It may have been deleted.</p>
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
      </div>
    );
  }

  const demo = isDemoId(scan.id);
  const masked = hasAnyMask(scan);
  const ordered = scan.concerns.filter((c): c is ScoredConcern => c !== 'skin_type' && headlines.has(c));
  const overlayScore = overlay ? headlines.get(overlay) : undefined;
  const overlayMask = overlay ? (scan.scores.find((s) => s.concern === overlay && s.region === 'whole' && s.mask) ?? scan.scores.find((s) => s.concern === overlay && s.mask))?.mask : null;
  const experiment = state.experiments.find((e) => e.scanIds.includes(scan.id));

  return (
    <>
      <PageHead
        eyebrow={
          <span className="row" style={{ gap: 8 }}>
            Scan results {demo ? <DemoRibbon /> : null}
          </span>
        }
        title={formatDateTime(scan.takenAt)}
        actions={
          <button type="button" className="btn" onClick={onBack}>
            <IconArrowLeft />
            New scan
          </button>
        }
      />

      <div className="stack-lg">
        <div className="stack-sm">
          <div className="row">
            <span className="tag">{qualityLabel(scan.quality)} analysis</span>
            <span className="tag">{CAPTURE_LABEL[scan.captureMethod]}</span>
            <span className={`tag ${scan.mode === 'live' ? 'tag--ok' : 'tag--info'}`}>{scan.mode === 'live' ? 'Live YouCam result' : 'Demo-mode result'}</span>
            <span className="tag num">{scan.mode === 'live' ? plural(scan.unitsCharged, 'unit') : 'No real units'}</span>
            {scan.remoteDeleted ? (
              <span className="tag tag--ok">
                <IconCheckCircle />
                Deleted at YouCam
              </span>
            ) : (
              <span className="tag tag--medium">YouCam deletion not confirmed</span>
            )}
          </div>
          {experiment ? (
            <Banner tone="info" title={`Part of the experiment “${experiment.title}”`}>
              <span>
                <a href={href('experiments')}>See the trend</a>
              </span>
            </Banner>
          ) : null}
          {demo ? <p className="xs subtle">Synthetic scan generated for the demo history. It was never sent to YouCam.</p> : null}
        </div>

        <div className="results-top">
          <section className="card photo-panel" aria-labelledby="photo-h">
            <div className="row-between">
              <h2 id="photo-h">Where it shows</h2>
              <span className="xs subtle">{masked ? 'YouCam masks' : 'Approximate zones'}</span>
            </div>
            <div className="overlay-picker" role="group" aria-label="Show concern overlay">
              <button type="button" aria-pressed={overlay === null} onClick={() => setOverlay(null)}>
                None
              </button>
              {ordered.map((c) => (
                <button key={c} type="button" aria-pressed={overlay === c} onClick={() => setOverlay(c)}>
                  {CONCERNS[c].label}
                </button>
              ))}
            </div>
            <div className={`photo-stage${masked || !media?.photo ? ' single' : ''}`}>
              {media?.photo ? (
                <div className="photo-frame">
                  <img src={media.photo} alt="The analysed photo" />
                  {masked && overlayMask ? <img className="mask-layer" src={overlayMask} alt="" aria-hidden="true" /> : null}
                  {masked && overlay ? <span className="photo-caption">{CONCERNS[overlay].label} mask</span> : null}
                </div>
              ) : null}
              {!masked ? <FaceZoneMap concern={overlay} scores={scan.scores} headlineRaw={overlayScore?.raw ?? null} /> : null}
            </div>
            {masked && overlay && !overlayMask ? <p className="xs subtle">YouCam returned no mask for {CONCERNS[overlay].label.toLowerCase()}.</p> : null}
            {!media?.photo && !demo ? <p className="xs subtle">No photo stored for this scan on this device.</p> : null}
          </section>

          <section className="card stack" aria-labelledby="summary-h">
            <h2 id="summary-h">Summary</h2>
            <div className="headline-scores">
              <div className="big-stat">
                <span className="eyebrow">Overall</span>
                <span className="big-n">
                  {scan.overall !== null ? Math.round(scan.overall) : '—'}
                  <small>/100</small>
                </span>
              </div>
              <div className="big-stat">
                <span className="eyebrow">Skin age</span>
                <span className="big-n">{scan.skinAge ?? '—'}</span>
              </div>
            </div>
            {scan.skinType.length > 0 ? (
              <div className="stack-sm">
                <span className="eyebrow">Skin type by zone</span>
                <ul className="skin-type-list">
                  {scan.skinType.map((t) => (
                    <li key={t.region}>
                      <span className="muted">{SKIN_REGION_LABEL[t.region] ?? t.region}</span>
                      <strong>{t.value}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="stack-sm">
              <span className="eyebrow">Focus from this scan</span>
              <p className="small">{focus.length > 0 ? focus.map((c) => CONCERNS[c].label).join(', ') : 'Nothing stood out.'}</p>
              <p className="xs subtle">Concerns with the lowest raw scores (under 65, our own heuristic). The shelf check uses these.</p>
            </div>
          </section>
        </div>

        <section className="stack" aria-labelledby="scores-h">
          <div className="section-title">
            <h2 id="scores-h">Appearance scores</h2>
          </div>
          <p className="small muted">
            Big number: YouCam’s display score (ui_score), which YouCam adjusts upward. Small number: the raw score, which is what Unstack tracks in experiments
            because it isn’t inflated. Higher is healthier-looking for both.
          </p>
          <div className="grid-3">
            {ordered.map((c) => {
              const s = headlines.get(c)!;
              const isFocus = focus.includes(c);
              return (
                <article key={c} className={`card score-card${isFocus ? ' is-focus' : ''}`}>
                  <div className="row-between">
                    <h3 style={{ fontSize: 'var(--text-md)' }}>{CONCERNS[c].label}</h3>
                    {isFocus ? <span className="tag tag--accent">Focus</span> : null}
                  </div>
                  <div className="score-row">
                    <span className="score-big" aria-label={`Display score ${s.ui} out of 100`}>
                      {s.ui}
                    </span>
                    <span className="score-raw">
                      raw <strong>{round1(s.raw)}</strong>
                    </span>
                  </div>
                  <div className="score-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(2, Math.min(100, s.ui))}%` }} />
                    <i className="raw-tick" style={{ left: `calc(${Math.max(0, Math.min(100, s.raw))}% - 1px)` }} />
                  </div>
                  <p className="xs subtle">{CONCERNS[c].blurb}</p>
                </article>
              );
            })}
          </div>
        </section>

        <CoverageSection products={state.products} report={report} focus={focus} />

        <div className="row-between">
          <a className="btn" href={href('experiments')}>
            <IconFlask />
            {experiment ? 'View experiment' : 'Start a one-change experiment'}
          </a>
          <ConfirmButton
            label="Delete this scan"
            prompt="Delete this scan and its images from this device?"
            confirmLabel="Delete scan"
            icon={<IconTrash />}
            onConfirm={async () => {
              await deleteScanMedia(scan.id);
              liveMedia.delete(scan.id);
              dispatch({ type: 'scan/remove', id: scan.id });
              onBack();
            }}
          />
        </div>
      </div>
    </>
  );
}
