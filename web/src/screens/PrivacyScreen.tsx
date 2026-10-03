import { useState } from 'react';
import { api, errorMessage } from '../api.ts';
import { IconExternal, IconLock, IconRefresh, IconTrash } from '../components/icons.tsx';
import { Banner, ConfirmButton, PageHead, showToast } from '../components/ui.tsx';
import { formatDateTime, plural, shortId, usd } from '../format.ts';
import { clearAllMedia } from '../idb.ts';
import { href } from '../route.ts';
import { refreshStatus, useServerStatus } from '../serverStatus.ts';
import { clearStoredState, dispatch, isPersisting, useAppState } from '../store.ts';
import { dismissJob, liveMedia } from './scan/jobs.ts';
import { YOUCAM_PRIVACY_URL } from './scan/ConsentCard.tsx';

const FLOW: { where: string; cls: string; title: string; detail: string; call?: string }[] = [
  { where: 'Your browser', cls: 'flow--device', title: 'You choose a photo', detail: 'Only after consent. Downscaled to 2560 px at most.' },
  { where: 'Unstack server', cls: '', title: 'Held in memory', detail: 'Never written to disk. The YouCam key stays here.' },
  { where: 'YouCam API', cls: 'flow--youcam', title: 'Upload and analyse', detail: 'Presigned upload, then the skin-analysis task.', call: 'file → task/skin-analysis v2.1' },
  { where: 'Unstack server', cls: '', title: 'Results copied', detail: 'Scores and mask images, before YouCam’s 2-hour links expire.' },
  { where: 'YouCam API', cls: 'flow--delete', title: 'Task deleted', detail: 'Input photo and outputs removed at YouCam.', call: 'task/delete' },
  { where: 'Your browser', cls: 'flow--device', title: 'Saved on this device', detail: 'Scores in localStorage; thumbnail and masks in IndexedDB.' },
];

export function PrivacyScreen() {
  const state = useAppState();
  const server = useServerStatus();
  const [withdrawNote, setWithdrawNote] = useState<string | null>(null);
  const s = server.status;
  const units = s?.units;

  const withdraw = async () => {
    const consent = state.consent;
    if (!consent) return;
    setWithdrawNote(null);
    try {
      await api.withdrawConsent(consent.consentId);
      setWithdrawNote('Consent withdrawn on the server and on this device.');
    } catch (err) {
      setWithdrawNote(`Withdrawn on this device. The server could not be told (${errorMessage(err).title.toLowerCase()}); its receipt holds no personal data.`);
    }
    dispatch({ type: 'consent/clear' });
  };

  const wipe = async () => {
    // Best effort: also retire the consent receipt on the server.
    if (state.consent) await api.withdrawConsent(state.consent.consentId).catch(() => undefined);
    dismissJob();
    liveMedia.clear();
    const mediaOk = await clearAllMedia();
    clearStoredState();
    dispatch({ type: 'reset' });
    clearStoredState();
    showToast(mediaOk ? 'Everything on this device was deleted.' : 'Shelf and scores deleted. Images could not be removed; close other Unstack tabs and try again.');
  };

  const total = units ? Math.max(1, units.cap) : 1;
  const usedPct = units ? (units.used / total) * 100 : 0;
  const reservedPct = units ? (units.reserved / total) * 100 : 0;

  return (
    <>
      <PageHead
        title="Privacy and data"
        lede="Unstack has no accounts. Your shelf, scores and photos stay in this browser. Here is exactly what goes where, and how to take it back."
      />

      <div className="stack-lg">
        {!isPersisting() ? (
          <Banner tone="warn" title="This browser isn’t saving data">
            <span>Private browsing or full storage: your shelf will be lost when you close the tab.</span>
          </Banner>
        ) : null}

        <section className="card stack" aria-labelledby="flow-h">
          <div>
            <h2 id="flow-h">How your photo flows</h2>
            <p className="small muted" style={{ marginTop: 4 }}>
              Every scan follows this path. The Scan screen shows each step live, with the YouCam call it makes.
            </p>
          </div>
          <ol className="flow">
            {FLOW.map((f, i) => (
              <li key={i} className={f.cls}>
                <span className="flow-where">{f.where}</span>
                <strong>{f.title}</strong>
                <span>{f.detail}</span>
                {f.call ? <span className="mono">{f.call}</span> : null}
              </li>
            ))}
          </ol>
        </section>

        <div className="grid-2">
          <section className="card stack" aria-labelledby="mode-h">
            <div className="row-between">
              <h2 id="mode-h">Server and units</h2>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void refreshStatus()} aria-label="Refresh server status">
                <IconRefresh />
                Refresh
              </button>
            </div>
            {server.phase === 'offline' ? (
              <Banner tone="warn" title="Server not reachable">
                <span>Start it with npm run dev. Everything stored on this device still works.</span>
              </Banner>
            ) : !s ? (
              <p className="small muted">Checking…</p>
            ) : (
              <>
                <div className="row">
                  <span className={`tag ${s.mode === 'live' ? 'tag--ok' : 'tag--info'}`}>{s.mode === 'live' ? 'Live · YouCam API' : 'Demo mode'}</span>
                  <span className="small muted">
                    {s.mode === 'live' ? 'Scans call the real YouCam API and spend units.' : 'Scans replay recorded YouCam responses. No units are spent.'}
                  </span>
                </div>
                {units ? (
                  <div className="stack-sm">
                    <div className="row-between">
                      <span className="field-label">Unit ledger{units.ledger === 'mock' ? ' (demo)' : ''}</span>
                      <span className="small num">
                        {units.available} of {units.cap} available
                      </span>
                    </div>
                    <div className="meter" role="img" aria-label={`${units.used} used, ${units.reserved} reserved, ${units.available} available of a ${units.cap} unit cap`}>
                      {units.used > 0 ? <span className="meter-used" style={{ width: `${usedPct}%` }} /> : null}
                      {units.reserved > 0 ? <span className="meter-reserved" style={{ width: `${reservedPct}%` }} /> : null}
                    </div>
                    <div className="meter-legend">
                      <span>
                        <i style={{ background: 'var(--accent)' }} /> Used {units.used}
                      </span>
                      <span>
                        <i style={{ background: 'repeating-linear-gradient(135deg, var(--accent) 0 2px, var(--accent-soft) 2px 4px)' }} /> Reserved {units.reserved}
                      </span>
                      <span>
                        <i style={{ background: 'var(--paper-sunk)', boxShadow: 'inset 0 0 0 1px var(--line-strong)' }} /> Available {units.available}
                      </span>
                    </div>
                    <p className="xs subtle">A hard cap: the server refuses a scan before it would exceed it. Failed YouCam tasks cost nothing.</p>
                  </div>
                ) : null}
                <dl className="dl">
                  <dt>YouCam account balance</dt>
                  <dd>{s.mode === 'live' ? (s.youcamBalance !== null ? `${s.youcamBalance} units` : 'Unknown') : 'Not used in demo mode'}</dd>
                  <dt>Prices</dt>
                  <dd>{s.prices.source === 'docs+live' ? 'Documented, checked against the live price list' : 'Documented price table'}</dd>
                  <dt>Sun profile</dt>
                  <dd>{plural(s.prices.fitzpatrick, 'unit')}</dd>
                  <dt>Label reader</dt>
                  <dd>{s.llm.enabled ? `${s.llm.model ?? 'On'} on Nebius` : 'Off'}</dd>
                  {s.llm.price ? (
                    <>
                      <dt>Reader price</dt>
                      <dd className="num" title={s.llm.price.source}>
                        ${s.llm.price.inputPer1M} in · ${s.llm.price.outputPer1M} out per 1M tokens
                      </dd>
                    </>
                  ) : null}
                  <dt>Label reading spend</dt>
                  <dd className="num">
                    {usd(s.llm.spentUsd)} of {usd(s.llm.capUsd)} cap
                  </dd>
                </dl>
                <p className="xs subtle">
                  {s.llm.enabled
                    ? 'Label reading is separate from YouCam demo mode: whenever UNSTACK_NEBIUS_API_KEY is set, a label photo you choose is sent to Nebius Token Factory and the read is billed, in demo mode too.'
                    : 'Label reading is off because UNSTACK_NEBIUS_API_KEY is not set, so label photos never leave this device.'}
                </p>
              </>
            )}
          </section>

          <section className="card stack" aria-labelledby="consent-h">
            <h2 id="consent-h">Photo consent</h2>
            {state.consent ? (
              <>
                <dl className="dl">
                  <dt>Given</dt>
                  <dd>{formatDateTime(state.consent.grantedAt)}</dd>
                  <dt>Version</dt>
                  <dd>
                    {state.consent.version}
                    {s && s.consentVersion !== state.consent.version ? ' (outdated)' : ''}
                  </dd>
                  <dt>Purposes</dt>
                  <dd>{state.consent.purposes.join(', ')}</dd>
                  <dt>Receipt</dt>
                  <dd className="mono">{shortId(state.consent.consentId)}</dd>
                </dl>
                <p className="small muted">Withdrawing stops new scans until you agree again. Past scores on this device are kept unless you delete them below.</p>
                <div>
                  <button type="button" className="btn btn--danger" onClick={withdraw}>
                    Withdraw consent
                  </button>
                </div>
              </>
            ) : (
              <p className="small muted">
                Not given. You’ll be asked on the <a href={href('scan')}>Scan</a> screen before any photo can be chosen.
              </p>
            )}
            {withdrawNote ? (
              <Banner tone="ok" role="status">
                <span>{withdrawNote}</span>
              </Banner>
            ) : null}
            <p className="small">
              <a href={YOUCAM_PRIVACY_URL} target="_blank" rel="noopener noreferrer">
                YouCam API privacy policy <IconExternal width={12} height={12} style={{ display: 'inline', verticalAlign: '-1px' }} />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          </section>
        </div>

        <section className="card stack" aria-labelledby="where-h">
          <h2 id="where-h">What is stored where</h2>
          <table className="store-table">
            <tbody>
              <tr>
                <th scope="row">This browser</th>
                <td>
                  {plural(state.products.length, 'product')}, {plural(state.scans.length, 'scan')} (scores only), {plural(state.experiments.length, 'experiment')}, your sun profile and
                  consent receipt in localStorage. Photo thumbnails (480 px) and mask images in IndexedDB.
                </td>
              </tr>
              <tr>
                <th scope="row">Unstack server</th>
                <td>A unit ledger and anonymous consent receipts. Photos only in memory during a scan. Label photos are forwarded once to the label reader (Nebius Token Factory) and dropped.</td>
              </tr>
              <tr>
                <th scope="row">YouCam (Perfect Corp.)</th>
                <td>The photo and results for the length of the task, then deleted with task/delete. Without it, YouCam keeps files for 30 days.</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="card stack" aria-labelledby="wipe-h">
          <div className="row" style={{ gap: 10 }}>
            <IconLock width={20} height={20} />
            <h2 id="wipe-h">Delete everything on this device</h2>
          </div>
          <p className="small muted">Removes your shelf, scans, experiments, sun profile, consent receipt, thumbnails and masks from this browser. It can’t be undone.</p>
          <div>
            <ConfirmButton
              label="Delete everything"
              icon={<IconTrash />}
              prompt="Delete all Unstack data in this browser?"
              confirmLabel="Yes, delete everything"
              onConfirm={wipe}
            />
          </div>
        </section>
      </div>
    </>
  );
}
