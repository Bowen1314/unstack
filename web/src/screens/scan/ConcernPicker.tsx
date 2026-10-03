import { CONCERNS, DEFAULT_CONCERNS } from '../../../../shared/concerns.ts';
import { MAX_CONCERNS } from '../../../../shared/pricing.ts';
import type { Concern } from '../../../../shared/types.ts';

const GROUPS: { title: string; items: Concern[] }[] = [
  { title: 'Surface', items: ['moisture', 'oiliness', 'pore', 'texture', 'acne', 'radiance', 'age_spot', 'redness'] },
  { title: 'Lines and firmness', items: ['wrinkle', 'firmness'] },
  { title: 'Eye area', items: ['dark_circle', 'eye_bag', 'tear_trough', 'droopy_upper_eyelid', 'droopy_lower_eyelid'] },
  { title: 'Skin type', items: ['skin_type'] },
];

const ALL: Concern[] = GROUPS.flatMap((g) => g.items);

/** Concerns where shelf products can do little: worth scanning, not worth buying for. */
export function weakTopical(c: Concern): boolean {
  if (c === 'skin_type') return false;
  const fams = CONCERNS[c].families;
  return fams.length === 0 || fams.every((f) => f.evidence === 'limited');
}

export function ConcernPicker({ value, onChange, required = [] }: { value: Concern[]; onChange: (v: Concern[]) => void; required?: Concern[] }) {
  const toggle = (c: Concern, on: boolean) => {
    if (on && value.length >= MAX_CONCERNS) return;
    onChange(on ? ALL.filter((x) => x === c || value.includes(x)) : value.filter((x) => x !== c));
  };
  return (
    <div className="stack">
      <div className="row-between">
        <p className="small muted" aria-live="polite">
          <strong className="num">{value.length}</strong> of {MAX_CONCERNS} selected. More concerns cost more units.
        </p>
        <div className="row">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange([...new Set([...DEFAULT_CONCERNS, ...required])])}>
            Defaults
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange(ALL.slice(0, MAX_CONCERNS))}>
            All
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange([])}>
            Clear
          </button>
        </div>
      </div>
      {GROUPS.map((g) => (
        <fieldset key={g.title} className="concern-group">
          <legend className="eyebrow">{g.title}</legend>
          <div className="concern-grid">
            {g.items.map((c) => {
              const info = CONCERNS[c];
              const checked = value.includes(c);
              return (
                <label key={c} className="concern-option">
                  <input type="checkbox" checked={checked} onChange={(e) => toggle(c, e.target.checked)} />
                  <span className="concern-text">
                    <strong>{info.label}</strong>
                    <span className="concern-blurb">{info.blurb}</span>
                    {required.includes(c) ? <span className="concern-flag" style={{ color: 'var(--accent-ink)' }}>Tracked by your experiment</span> : null}
                    {weakTopical(c) ? <span className="concern-flag">Little a product can change</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
