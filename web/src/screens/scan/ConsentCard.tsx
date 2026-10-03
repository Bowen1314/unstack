import { useId, useState } from 'react';
import { CONSENT_VERSION, type ConsentPurpose } from '../../../../shared/api.ts';
import { api, errorMessage } from '../../api.ts';
import { IconExternal, IconImage, IconLock, IconServer, IconShield, IconTrash } from '../../components/icons.tsx';
import { Banner } from '../../components/ui.tsx';
import { useServerStatus } from '../../serverStatus.ts';
import { dispatch } from '../../store.ts';

export const YOUCAM_PRIVACY_URL = 'https://www.makeupar.com/perfectbeauty/youcam/privacy-policy-api';
const PURPOSES: ConsentPurpose[] = ['skin-analysis', 'sun-profile'];

export function ConsentCard({ outdated }: { outdated: boolean }) {
  const uid = useId();
  const server = useServerStatus();
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; advice: string } | null>(null);
  const version = server.status?.consentVersion ?? CONSENT_VERSION;

  const agree = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.grantConsent({ version, adult: true, purposes: PURPOSES });
      dispatch({ type: 'consent/set', consent: { consentId: res.consentId, version: res.version, purposes: res.purposes, grantedAt: res.grantedAt } });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card consent stack" aria-labelledby={`${uid}-h`}>
      <div>
        <div className="eyebrow">Before you choose a photo</div>
        <h2 id={`${uid}-h`} style={{ marginTop: 4 }}>
          {outdated ? 'Our photo terms changed. Please review them again.' : 'How your face photo is used'}
        </h2>
      </div>
      <ul className="consent-list">
        <li>
          <span className="consent-icon">
            <IconImage />
          </span>
          <div>
            <strong>What is sent</strong>
            <p>One face photo, to Perfect Corp’s YouCam API, for skin analysis. If you also ask for a sun profile, the same kind of photo goes to YouCam’s Fitzpatrick analyser.</p>
          </div>
        </li>
        <li>
          <span className="consent-icon">
            <IconShield />
          </span>
          <div>
            <strong>Why</strong>
            <p>To get appearance scores (hydration, shine, pores and so on) that Unstack maps to the products on your shelf. Cosmetic guidance only, never a diagnosis.</p>
          </div>
        </li>
        <li>
          <span className="consent-icon">
            <IconServer />
          </span>
          <div>
            <strong>On the Unstack server</strong>
            <p>The photo is held in memory only, for the length of the scan, and never written to disk. The server keeps an anonymous consent receipt and a unit count, nothing else.</p>
          </div>
        </li>
        <li>
          <span className="consent-icon">
            <IconTrash />
          </span>
          <div>
            <strong>At YouCam</strong>
            <p>As soon as the results are copied, Unstack asks YouCam to delete the task and its files (task/delete). Without that, YouCam would keep them for up to 30 days.</p>
          </div>
        </li>
        <li>
          <span className="consent-icon">
            <IconLock />
          </span>
          <div>
            <strong>On this device</strong>
            <p>Scores and a small thumbnail stay in this browser only. You can withdraw consent or delete everything at any time on the Privacy screen.</p>
          </div>
        </li>
      </ul>
      <p className="small">
        Read the{' '}
        <a href={YOUCAM_PRIVACY_URL} target="_blank" rel="noopener noreferrer">
          YouCam API privacy policy <IconExternal width={12} height={12} style={{ display: 'inline', verticalAlign: '-1px' }} />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        .
      </p>
      <label className="check">
        <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />I am 18 or older, and I agree to send my photo for these purposes.
      </label>
      {error ? (
        <Banner tone="error" title={error.title} role="alert">
          {error.advice ? <span>{error.advice}</span> : null}
        </Banner>
      ) : null}
      <div className="row">
        <button type="button" className="btn btn--primary btn--lg" disabled={!adult || busy || server.phase === 'offline'} onClick={agree}>
          {busy ? 'Saving…' : 'I agree'}
        </button>
        <span className="xs subtle">Consent version {version}</span>
      </div>
      {server.phase === 'offline' ? <p className="small muted">The Unstack server isn’t reachable, so consent can’t be recorded right now.</p> : null}
    </section>
  );
}
