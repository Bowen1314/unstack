import { useId, useMemo, useState, type FormEvent } from 'react';
import { CATALOG, productFromCatalog } from '../../../../shared/catalog.ts';
import { ALL_CONCERNS, CONCERNS, type ScoredConcern } from '../../../../shared/concerns.ts';
import type { Experiment, Product } from '../../../../shared/types.ts';
import { IconFlask } from '../../components/icons.tsx';
import { Banner, showToast } from '../../components/ui.tsx';
import { isDemoId } from '../../demo.ts';
import { focusFromScans } from '../../derive.ts';
import { daysBetween, formatDate, qualityLabel } from '../../format.ts';
import { navigate } from '../../route.ts';
import { dispatch, newId, nowIso, useAppState } from '../../store.ts';

const SCORED = ALL_CONCERNS.filter((c): c is ScoredConcern => c !== 'skin_type');
const MAX_TARGETS = 3;
const BASELINE_MAX_AGE_DAYS = 7;

export function NewExperimentForm({ onCancel }: { onCancel?: () => void }) {
  const uid = useId();
  const { products, scans } = useAppState();
  const [kind, setKind] = useState<'add' | 'remove'>('add');
  const [productKey, setProductKey] = useState('');
  const [targets, setTargets] = useState<ScoredConcern[]>(() => focusFromScans(scans).slice(0, MAX_TARGETS));
  const [weeks, setWeeks] = useState(6);
  const [baselineId, setBaselineId] = useState<string>('later');

  const onShelfNames = new Set(products.map((p) => p.name));
  const catalogOptions = CATALOG.filter((c) => !c.prescription && !onShelfNames.has(c.name));
  const shelfOptions = products.filter((p) => !p.prescription);
  const rxCount = products.length - shelfOptions.length;
  const recent = useMemo(
    () => [...scans].reverse().filter((s) => !isDemoId(s.id) && daysBetween(s.takenAt, new Date()) <= BASELINE_MAX_AGE_DAYS),
    [scans],
  );

  const resolve = (): { id: string; name: string; add?: Product } | null => {
    if (productKey.startsWith('cat:')) {
      const item = CATALOG.find((c) => c.catalogId === productKey.slice(4));
      if (!item) return null;
      const product = productFromCatalog(item, newId(), nowIso());
      return { id: product.id, name: product.name, add: product };
    }
    if (productKey.startsWith('shelf:')) {
      const p = products.find((x) => x.id === productKey.slice(6));
      return p ? { id: p.id, name: p.name } : null;
    }
    return null;
  };

  const toggleTarget = (c: ScoredConcern, on: boolean) => {
    if (on && targets.length >= MAX_TARGETS) return;
    setTargets(on ? [...targets, c] : targets.filter((t) => t !== c));
  };

  const ready = productKey !== '' && targets.length > 0;

  const start = (e: FormEvent) => {
    e.preventDefault();
    const chosen = resolve();
    if (!chosen || targets.length === 0) return;
    const experiment: Experiment = {
      id: newId(),
      title: `${kind === 'add' ? 'Add' : 'Stop'} ${chosen.name}`,
      change: { kind, productId: chosen.id, productName: chosen.name },
      targetConcerns: targets,
      startedAt: nowIso(),
      weeks,
      scanIds: baselineId !== 'later' ? [baselineId] : [],
      otherChanges: [],
      status: 'running',
    };
    dispatch(chosen.add ? { type: 'experiment/start', experiment, addProduct: chosen.add } : { type: 'experiment/start', experiment });
    if (baselineId === 'later') {
      showToast('Experiment started. Take your baseline scan now.');
      navigate('scan');
    } else {
      showToast('Experiment started with your recent scan as the baseline.');
    }
  };

  return (
    <form className="card stack" onSubmit={start} aria-labelledby={`${uid}-h`}>
      <div>
        <div className="eyebrow">One change at a time</div>
        <h2 id={`${uid}-h`} style={{ marginTop: 4 }}>
          Start an experiment
        </h2>
        <p className="small muted" style={{ marginTop: 4 }}>
          Add or stop one product, keep everything else the same, and rescan every two weeks. Skin needs at least four weeks to show a change.
        </p>
      </div>

      <div className="field">
        <span className="field-label" id={`${uid}-kind`}>
          The change
        </span>
        <div className="seg" role="radiogroup" aria-labelledby={`${uid}-kind`}>
          <label>
            <input
              type="radio"
              name={`${uid}-kind`}
              checked={kind === 'add'}
              onChange={() => {
                setKind('add');
                setProductKey('');
              }}
            />
            Add a product
          </label>
          <label>
            <input
              type="radio"
              name={`${uid}-kind`}
              checked={kind === 'remove'}
              onChange={() => {
                setKind('remove');
                setProductKey('');
              }}
            />
            Stop using one
          </label>
        </div>
      </div>

      <div className="field">
        <label htmlFor={`${uid}-product`}>{kind === 'add' ? 'Product to add' : 'Product to stop'}</label>
        <select id={`${uid}-product`} className="select" value={productKey} onChange={(e) => setProductKey(e.target.value)}>
          <option value="">Choose…</option>
          {kind === 'add' ? (
            <>
              <optgroup label="From the catalogue (added to your shelf)">
                {catalogOptions.map((c) => (
                  <option key={c.catalogId} value={`cat:${c.catalogId}`}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
              {shelfOptions.length > 0 ? (
                <optgroup label="Already on your shelf (just started it)">
                  {shelfOptions.map((p) => (
                    <option key={p.id} value={`shelf:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </>
          ) : (
            shelfOptions.map((p) => (
              <option key={p.id} value={`shelf:${p.id}`}>
                {p.name}
              </option>
            ))
          )}
        </select>
        <span className="hint">
          {kind === 'remove' ? 'It leaves your shelf and weekly plan when the experiment starts. ' : ''}
          {rxCount > 0 ? 'Prescribed products aren’t listed: follow your prescriber before changing them.' : ''}
        </span>
      </div>

      <fieldset className="concern-group">
        <legend className="field-label" style={{ marginBottom: 8 }}>
          What to watch <span className="subtle">(1–{MAX_TARGETS})</span>
        </legend>
        <div className="concern-grid">
          {SCORED.map((c) => (
            <label key={c} className="concern-option">
              <input type="checkbox" checked={targets.includes(c)} disabled={!targets.includes(c) && targets.length >= MAX_TARGETS} onChange={(e) => toggleTarget(c, e.target.checked)} />
              <span className="concern-text">
                <strong>{CONCERNS[c].label}</strong>
                <span className="concern-blurb">{CONCERNS[c].blurb}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="form-grid">
        <div className="field">
          <label htmlFor={`${uid}-weeks`}>Length</label>
          <select id={`${uid}-weeks`} className="select" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            {[4, 5, 6, 7, 8].map((w) => (
              <option key={w} value={w}>
                {w} weeks
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${uid}-base`}>Baseline scan</label>
          <select id={`${uid}-base`} className="select" value={baselineId} onChange={(e) => setBaselineId(e.target.value)}>
            <option value="later">Scan now, right after starting</option>
            {recent.map((s) => (
              <option key={s.id} value={s.id}>
                Use my scan from {formatDate(s.takenAt)} ({qualityLabel(s.quality)})
              </option>
            ))}
          </select>
        </div>
      </div>
      <Banner tone="info">
        <span>
          Tip: take a second baseline scan within 3 days. The difference between the two measures your scan-to-scan noise, so later changes are judged against
          your own noise instead of an assumed ±4.
        </span>
      </Banner>
      <div className="row">
        <button type="submit" className="btn btn--primary" disabled={!ready}>
          <IconFlask />
          Start experiment
        </button>
        {onCancel ? (
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
