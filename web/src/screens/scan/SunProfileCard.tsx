import { useId, useState } from 'react';
import { FITZPATRICK_UNITS } from '../../../../shared/pricing.ts';
import type { FitzpatrickScale } from '../../../../shared/types.ts';
import { errorMessage } from '../../api.ts';
import { IconSun } from '../../components/icons.tsx';
import { Banner, Spinner } from '../../components/ui.tsx';
import { formatDate } from '../../format.ts';
import { toJpeg } from '../../image.ts';
import { useServerStatus } from '../../serverStatus.ts';
import { dispatch, nowIso, useAppState } from '../../store.ts';
import { dismissJob, isConsentError, startSunProfile, useActiveJob } from './jobs.ts';
import { photoSrc, type PhotoChoice } from './photo.ts';

const SCALES: { scale: FitzpatrickScale; text: string; swatch: string }[] = [
  { scale: 'I', text: 'Always burns, never tans', swatch: '#f6dccb' },
  { scale: 'II', text: 'Usually burns, tans a little', swatch: '#ebc1a3' },
  { scale: 'III', text: 'Sometimes burns, tans gradually', swatch: '#d49e78' },
  { scale: 'IV', text: 'Rarely burns, tans easily', swatch: '#ab7650' },
  { scale: 'V', text: 'Very rarely burns', swatch: '#7c4e30' },
  { scale: 'VI', text: 'Never burns', swatch: '#4b2e1c' },
];

const isJpegUrl = (url: string) => /\.jpe?g$/i.test(new URL(url).pathname);

/**
 * Download a sample (YouCam's CDN allows CORS) and re-encode it as JPEG.
 * no-store: a cached copy from the thumbnail <img> may lack CORS headers and
 * would taint the canvas.
 */
async function sampleAsJpeg(url: string) {
  const res = await fetch(url, { mode: 'cors', cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not download the sample photo (HTTP ${res.status}).`);
  const blobUrl = URL.createObjectURL(await res.blob());
  try {
    return await toJpeg(blobUrl, 2560, 0.92);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export function SunProfileCard({ photo, consentId }: { photo: PhotoChoice | null; consentId: string | null }) {
  const uid = useId();
  const { sunProfile } = useAppState();
  const server = useServerStatus();
  const job = useActiveJob();
  const [error, setError] = useState<{ title: string; advice: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const sunJob = job?.kind === 'sun-profile' ? job : null;
  const running = sunJob !== null && sunJob.error === null && sunJob.resultId === null;
  const price = server.status?.prices.fitzpatrick ?? FITZPATRICK_UNITS;
  const otherJobRunning = job !== null && job.kind === 'scan' && job.error === null && job.resultId === null;

  const setSelf = (scale: FitzpatrickScale) => dispatch({ type: 'sun/set', profile: { scale, source: 'self-report', updatedAt: nowIso() } });

  const analyse = async () => {
    if (!photo || !consentId) return;
    setError(null);
    setBusy(true);
    try {
      // Fitzpatrick accepts JPEG only. JPEG samples go by URL; everything else
      // (uploads, camera shots, PNG samples like Sample A) is re-encoded here first.
      const req =
        photo.kind === 'sample' && isJpegUrl(photo.sample.url)
          ? { consentId, sampleId: photo.sample.id }
          : { consentId, image: photo.kind === 'sample' ? await sampleAsJpeg(photo.sample.url) : await toJpeg(photoSrc(photo), 2560, 0.92) };
      await startSunProfile(req, photo);
    } catch (err) {
      if (isConsentError(err)) dispatch({ type: 'consent/clear' });
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack" aria-labelledby={`${uid}-h`}>
      <div className="card-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">Optional</div>
          <h2 id={`${uid}-h`} style={{ marginTop: 4 }}>
            Sun profile
          </h2>
          <p className="small muted">
            Your Fitzpatrick type only raises the priority of the “sun-sensitising actives, no sunscreen” check. It is never used as a diagnosis.
          </p>
        </div>
        <span className="tag">
          <IconSun />
          {sunProfile.scale ? `Type ${sunProfile.scale} · ${sunProfile.source === 'youcam' ? 'YouCam' : 'self-reported'}${sunProfile.updatedAt ? ` · ${formatDate(sunProfile.updatedAt)}` : ''}` : 'Not set'}
        </span>
      </div>

      <fieldset className="concern-group">
        <legend className="field-label" style={{ marginBottom: 8 }}>
          Self-report
        </legend>
        <div className="fitz-grid">
          {SCALES.map((s) => (
            <label key={s.scale} className="fitz-option" title={s.text}>
              <input type="radio" name={`${uid}-fitz`} checked={sunProfile.scale === s.scale} onChange={() => setSelf(s.scale)} />
              <span className="fitz-swatch" style={{ background: s.swatch }} aria-hidden="true" />
              {s.scale}
              <span className="sr-only">: {s.text}</span>
            </label>
          ))}
        </div>
        <p className="xs subtle" style={{ marginTop: 6 }}>
          {sunProfile.scale ? SCALES.find((s) => s.scale === sunProfile.scale)?.text : 'I burns most easily, VI least.'}
        </p>
      </fieldset>

      <div className="stack-sm">
        <span className="field-label">Or analyse the chosen photo with YouCam</span>
        <div className="row">
          <button
            type="button"
            className="btn"
            disabled={!photo || !consentId || running || busy || otherJobRunning || server.phase === 'offline'}
            onClick={analyse}
          >
            Analyse with YouCam · {server.status?.mode === 'mock' ? 'demo' : `${price} units`}
          </button>
          {sunProfile.source !== 'unset' ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => dispatch({ type: 'sun/set', profile: { scale: null, source: 'unset', updatedAt: null } })}>
              Clear
            </button>
          ) : null}
        </div>
        <span className="xs subtle">
          {!photo ? 'Choose a photo above first. ' : ''}Uses YouCam’s Fitzpatrick analyser (JPEG only; we convert in your browser). The task is deleted at YouCam afterwards.
        </span>
        {running ? <Spinner label={`YouCam is reading the skin type… (${sunJob.status?.stage ?? 'queued'})`} /> : null}
        {sunJob?.resultId ? (
          <Banner tone="ok" title={`Sun profile saved: type ${sunProfile.scale ?? '—'}`}>
            <button type="button" className="link-btn" onClick={dismissJob}>
              Dismiss
            </button>
          </Banner>
        ) : null}
        {sunJob?.error ? (
          <Banner tone="error" title={sunJob.error.title} role="alert">
            <span>{sunJob.error.advice}</span>
            <button type="button" className="link-btn" onClick={dismissJob}>
              Dismiss
            </button>
          </Banner>
        ) : null}
        {error ? (
          <Banner tone="error" title={error.title} role="alert">
            {error.advice ? <span>{error.advice}</span> : null}
          </Banner>
        ) : null}
      </div>
    </section>
  );
}
