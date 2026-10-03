import { useId } from 'react';
import type { Product, ProductAnalysis, ProductCategory, UsageTime, WeeklyFrequency } from '../../../../shared/types.ts';
import { IconDroplet, IconMoon, IconPill, IconShelf, IconSun, IconTrash } from '../../components/icons.tsx';
import { FamilyChips, familyKind, showToast } from '../../components/ui.tsx';
import { CATEGORY_LABEL, frequencyLabel, SOURCE_LABEL, USAGE_LABEL } from '../../format.ts';
import { dispatch, getState, nowIso, runningExperiments, type ProductPatch } from '../../store.ts';

const FREQUENCIES: WeeklyFrequency[] = [7, 6, 5, 4, 3, 2, 1];
const USAGES: UsageTime[] = ['am', 'pm', 'both', 'flex'];

function CategoryIcon({ category }: { category: ProductCategory }) {
  if (category === 'sunscreen') return <IconSun />;
  if (category === 'cleanser') return <IconDroplet />;
  if (category === 'treatment') return <IconPill />;
  if (category === 'serum' || category === 'exfoliant' || category === 'toner') return <IconMoon />;
  return <IconShelf />;
}

function confounderNote(): void {
  const running = runningExperiments(getState())[0];
  if (running) showToast(`Logged as a possible confounder in “${running.title}”.`);
}

export function ProductCard({ product, analysis, index }: { product: Product; analysis: ProductAnalysis; index: number }) {
  const uid = useId();
  const update = (patch: ProductPatch) => {
    dispatch({ type: 'product/update', id: product.id, patch, at: nowIso() });
    confounderNote();
  };
  const remove = () => {
    const hadExperiment = runningExperiments(getState()).length > 0;
    dispatch({ type: 'product/remove', id: product.id, at: nowIso() });
    showToast(hadExperiment ? `Removed ${product.name}. Logged as a confounder.` : `Removed ${product.name}.`, {
      label: 'Undo',
      run: () => dispatch({ type: 'product/restore', product, index }),
    });
  };

  const detectedAt = new Map(analysis.detected.map((d) => [d.position, d.family]));

  return (
    <article className="card product" aria-labelledby={`${uid}-name`}>
      <div className="product-head">
        <span className="product-step" aria-hidden="true">
          <CategoryIcon category={product.category} />
        </span>
        <div className="product-title">
          <h3 id={`${uid}-name`}>{product.name}</h3>
          <div className="product-meta">
            <span>{CATEGORY_LABEL[product.category]}</span>
            <span>{product.rinseOff ? 'Rinse-off' : 'Leave-on'}</span>
            <span>{SOURCE_LABEL[product.source]}</span>
            {product.prescription ? <span className="tag tag--info">Prescribed · follow your prescriber</span> : null}
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={remove} aria-label={`Remove ${product.name}`} title="Remove from shelf">
          <IconTrash />
        </button>
      </div>

      <FamilyChips analysis={analysis} empty="No ingredient families recognised. Check the list for typos." />

      <div className="product-controls">
        <div className="field">
          <label htmlFor={`${uid}-usage`}>When</label>
          <select id={`${uid}-usage`} className="select select--sm" value={product.usage} onChange={(e) => update({ usage: e.target.value as UsageTime })}>
            {USAGES.map((u) => (
              <option key={u} value={u}>
                {USAGE_LABEL[u]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${uid}-freq`}>{product.usage === 'both' ? 'How often (each)' : 'How often'}</label>
          <select
            id={`${uid}-freq`}
            className="select select--sm"
            value={product.frequency}
            onChange={(e) => update({ frequency: Number(e.target.value) as WeeklyFrequency })}
          >
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {frequencyLabel(f)}
              </option>
            ))}
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={product.prescription} onChange={(e) => update({ prescription: e.target.checked })} />
          Prescribed
        </label>
        <label className="check">
          <input type="checkbox" checked={product.rinseOff} onChange={(e) => update({ rinseOff: e.target.checked })} />
          Rinse-off
        </label>
      </div>

      <details>
        <summary>
          Ingredients · {analysis.ingredients.length} listed · {analysis.detected.length} recognised
          {analysis.unrecognised > 0 ? ` · ${analysis.unrecognised} not in our database` : ''}
        </summary>
        <p className="inci">
          {analysis.ingredients.map((ing, i) => {
            const fam = detectedAt.get(i + 1);
            const sep = i < analysis.ingredients.length - 1 ? ', ' : '';
            if (!fam) return <span key={i}>{ing + sep}</span>;
            const kind = familyKind(fam);
            const cls = kind === 'active' ? undefined : kind === 'irritant' ? 'inci--irritant' : 'inci--support';
            return (
              <span key={i}>
                <mark className={cls}>{ing}</mark>
                {sep}
              </span>
            );
          })}
        </p>
      </details>
    </article>
  );
}
