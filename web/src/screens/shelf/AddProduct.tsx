import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { CATALOG, productFromCatalog, type CatalogItem } from '../../../../shared/catalog.ts';
import { analyseProduct, FAMILY_LABEL } from '../../../../shared/ingredients.ts';
import type { Product, ProductCategory, ProductSource, UsageTime, WeeklyFrequency } from '../../../../shared/types.ts';
import { api, ApiError, errorMessage } from '../../api.ts';
import { IconCamera, IconPaste, IconPlus, IconSearch, IconShelf } from '../../components/icons.tsx';
import { Banner, FamilyChips, showToast, Spinner } from '../../components/ui.tsx';
import { CATEGORY_LABEL, frequencyLabel, usd, USAGE_LABEL } from '../../format.ts';
import { LABEL_MAX_LONG_SIDE, toJpeg } from '../../image.ts';
import { dispatch, getState, newId, nowIso, runningExperiments, useAppState } from '../../store.ts';

type Tab = 'catalog' | 'paste' | 'label';
const TABS: { id: Tab; label: string; Icon: typeof IconShelf }[] = [
  { id: 'catalog', label: 'Catalogue', Icon: IconSearch },
  { id: 'paste', label: 'Paste list', Icon: IconPaste },
  { id: 'label', label: 'Label photo', Icon: IconCamera },
];

const CATEGORIES = Object.keys(CATEGORY_LABEL) as ProductCategory[];
const USAGES: UsageTime[] = ['am', 'pm', 'both', 'flex'];
const FREQUENCIES: WeeklyFrequency[] = [7, 6, 5, 4, 3, 2, 1];

interface Draft {
  name: string;
  category: ProductCategory;
  usage: UsageTime;
  frequency: WeeklyFrequency;
  rinseOff: boolean;
  prescription: boolean;
  ingredientsRaw: string;
  source: ProductSource;
}

const EMPTY_DRAFT: Draft = {
  name: '',
  category: 'serum',
  usage: 'flex',
  frequency: 7,
  rinseOff: false,
  prescription: false,
  ingredientsRaw: '',
  source: 'paste',
};

interface LabelMeta {
  model: string;
  costUsd: number;
  mock: boolean;
}

function added(name: string): void {
  const running = runningExperiments(getState())[0];
  showToast(running ? `Added ${name}. Logged as a confounder in “${running.title}”.` : `Added ${name} to your shelf.`);
}

export function AddProduct() {
  const uid = useId();
  const [tab, setTab] = useState<Tab>('catalog');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [labelMeta, setLabelMeta] = useState<LabelMeta | null>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ catalog: null, paste: null, label: null });

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else return;
    e.preventDefault();
    const id = TABS[next]!.id;
    setTab(id);
    tabRefs.current[id]?.focus();
  };

  return (
    <section className="card" aria-labelledby={`${uid}-h`}>
      <div className="card-head">
        <div>
          <h2 id={`${uid}-h`}>Add a product</h2>
          <p className="small muted">Three ways in. Nothing leaves this device except a label photo you choose to have read.</p>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="How to add a product" onKeyDown={onTabKey}>
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            ref={(el) => {
              tabRefs.current[id] = el;
            }}
            type="button"
            role="tab"
            id={`${uid}-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`${uid}-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${uid}-panel-${tab}`} aria-labelledby={`${uid}-tab-${tab}`}>
        {tab === 'catalog' ? <CatalogPanel /> : null}
        {tab === 'paste' ? (
          <PastePanel
            draft={draft}
            setDraft={setDraft}
            labelMeta={labelMeta}
            onDone={() => {
              setDraft(EMPTY_DRAFT);
              setLabelMeta(null);
            }}
          />
        ) : null}
        {tab === 'label' ? (
          <LabelPanel
            onRead={(text, meta) => {
              setDraft({ ...EMPTY_DRAFT, ...draft, ingredientsRaw: text, source: 'label-photo' });
              setLabelMeta(meta);
              setTab('paste');
            }}
          />
        ) : null}
      </div>
    </section>
  );
}

function CatalogPanel() {
  const { products } = useAppState();
  const [q, setQ] = useState('');
  const uid = useId();
  const enriched = useMemo(
    () =>
      CATALOG.map((item) => {
        const analysis = analyseProduct(productFromCatalog(item, item.catalogId, ''));
        return { item, analysis, haystack: `${item.name} ${item.ingredientsRaw} ${analysis.families.map((f) => FAMILY_LABEL[f]).join(' ')}`.toLowerCase() };
      }),
    [],
  );
  const onShelf = new Set(products.map((p) => p.name));
  const query = q.trim().toLowerCase();
  const list = query ? enriched.filter((e) => e.haystack.includes(query)) : enriched;

  const add = (item: CatalogItem) => {
    dispatch({ type: 'product/add', product: productFromCatalog(item, newId(), nowIso()), at: nowIso() });
    added(item.name);
  };

  return (
    <div className="stack-sm">
      <div className="field">
        <label htmlFor={`${uid}-q`}>Search the demo catalogue</label>
        <input
          id={`${uid}-q`}
          className="input"
          type="search"
          placeholder="Name, ingredient or family (e.g. retinol, BHA)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
        <span className="hint">Generic, unbranded products with typical ingredient lists.</span>
      </div>
      <ul className="catalog-list" aria-label="Catalogue results">
        {list.length === 0 ? (
          <li>
            <span className="small muted">No match. Try the Paste list tab for your own product.</span>
          </li>
        ) : (
          list.map(({ item, analysis }) => {
            const has = onShelf.has(item.name);
            return (
              <li key={item.catalogId}>
                <div className="catalog-name">
                  {item.name}
                  <span>
                    {CATEGORY_LABEL[item.category]}
                    {analysis.actives.length > 0 ? ` · ${analysis.actives.map((f) => FAMILY_LABEL[f]).join(', ')}` : ''}
                  </span>
                </div>
                <button type="button" className="btn btn--sm" disabled={has} onClick={() => add(item)} aria-label={has ? `${item.name} is on your shelf` : `Add ${item.name}`}>
                  {has ? 'On shelf' : (
                    <>
                      <IconPlus /> Add
                    </>
                  )}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

function PastePanel({
  draft,
  setDraft,
  labelMeta,
  onDone,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  labelMeta: LabelMeta | null;
  onDone: () => void;
}) {
  const uid = useId();
  const [touched, setTouched] = useState(false);
  const preview = useMemo(
    () => analyseProduct({ ...draft, id: 'preview', addedAt: '', name: draft.name || 'preview' }),
    [draft],
  );
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const nameMissing = draft.name.trim() === '';
  const listMissing = draft.ingredientsRaw.trim() === '';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (nameMissing || listMissing) return;
    const product: Product = {
      id: newId(),
      name: draft.name.trim(),
      category: draft.category,
      ingredientsRaw: draft.ingredientsRaw.trim(),
      usage: draft.usage,
      frequency: draft.frequency,
      rinseOff: draft.rinseOff,
      prescription: draft.prescription,
      source: draft.source,
      addedAt: nowIso(),
    };
    dispatch({ type: 'product/add', product, at: nowIso() });
    added(product.name);
    setTouched(false);
    onDone();
  };

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {labelMeta ? (
        <Banner tone="ok" title="Ingredient list read from your photo">
          <span>
            Read by <strong>{labelMeta.model}</strong>
            {labelMeta.mock ? ' (demo reader)' : ''} for {usd(labelMeta.costUsd)}. The photo was sent once for reading and is not stored anywhere. Check the
            list against the pack before saving.
          </span>
        </Banner>
      ) : null}
      <div className="field">
        <label htmlFor={`${uid}-name`}>Product name</label>
        <input
          id={`${uid}-name`}
          className="input"
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="e.g. Night Repair Serum"
          aria-invalid={touched && nameMissing}
          aria-describedby={touched && nameMissing ? `${uid}-name-err` : undefined}
        />
        {touched && nameMissing ? (
          <span id={`${uid}-name-err`} className="hint" style={{ color: 'var(--high)' }}>
            Give it a name you’ll recognise.
          </span>
        ) : null}
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`${uid}-cat`}>Type</label>
          <select
            id={`${uid}-cat`}
            className="select"
            value={draft.category}
            onChange={(e) => {
              const category = e.target.value as ProductCategory;
              setDraft({ ...draft, category, rinseOff: category === 'cleanser' || category === 'mask' ? true : category === draft.category ? draft.rinseOff : false });
            }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${uid}-usage`}>When</label>
          <select id={`${uid}-usage`} className="select" value={draft.usage} onChange={(e) => set('usage', e.target.value as UsageTime)}>
            {USAGES.map((u) => (
              <option key={u} value={u}>
                {USAGE_LABEL[u]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${uid}-freq`}>How often</label>
          <select id={`${uid}-freq`} className="select" value={draft.frequency} onChange={(e) => set('frequency', Number(e.target.value) as WeeklyFrequency)}>
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {frequencyLabel(f)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row" style={{ gap: 'var(--space-4)' }}>
        <label className="check">
          <input type="checkbox" checked={draft.rinseOff} onChange={(e) => set('rinseOff', e.target.checked)} />
          Rinse-off (washed off within a minute or two)
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.prescription} onChange={(e) => set('prescription', e.target.checked)} />
          Prescribed
        </label>
      </div>
      <div className="field">
        <label htmlFor={`${uid}-inci`}>Ingredient list</label>
        <textarea
          id={`${uid}-inci`}
          className="textarea"
          value={draft.ingredientsRaw}
          onChange={(e) => set('ingredientsRaw', e.target.value)}
          placeholder="Aqua, Glycerin, Niacinamide, …"
          rows={6}
          aria-invalid={touched && listMissing}
          aria-describedby={`${uid}-inci-hint`}
        />
        <span id={`${uid}-inci-hint`} className="hint">
          {touched && listMissing ? 'Paste the INCI list from the pack or the brand’s site.' : 'Copy it from the pack or the brand’s website. Order matters: earlier usually means more.'}
        </span>
      </div>
      <div className="stack-sm" aria-live="polite">
        <span className="eyebrow">Recognised so far</span>
        <FamilyChips analysis={preview} empty={draft.ingredientsRaw.trim() ? 'Nothing recognised yet.' : 'Start typing or paste a list.'} />
        {preview.ingredients.length > 0 ? (
          <span className="hint">
            {preview.ingredients.length} ingredients · {preview.detected.length} recognised
          </span>
        ) : null}
      </div>
      {draft.prescription ? <p className="xs muted">Prescribed products are scheduled as you set them. Follow your prescriber.</p> : null}
      <button type="submit" className="btn btn--primary">
        <IconPlus />
        Add to shelf
      </button>
    </form>
  );
}

function LabelPanel({ onRead }: { onRead: (text: string, meta: LabelMeta) => void }) {
  const uid = useId();
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; advice: string } | null>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const onFile = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError({ title: 'That isn’t an image', advice: 'Choose a photo of the ingredient list.' });
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    setBusy(true);
    try {
      const jpeg = await toJpeg(url, LABEL_MAX_LONG_SIDE, 0.85);
      const res = await api.readLabel({ image: jpeg });
      onRead(res.text, { model: res.model, costUsd: res.costUsd, mock: res.mock });
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setError({ title: 'Label reading is turned off on this server', advice: err.advice ?? 'Paste the ingredient list instead.' });
      } else {
        const m = errorMessage(err);
        setError({ title: m.title, advice: m.advice });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <label className="dropzone" htmlFor={`${uid}-file`}>
        <IconCamera />
        <strong>Photograph or choose the ingredient list</strong>
        <span className="small muted">A vision model reads the text, then you review it before anything is saved.</span>
        <input
          id={`${uid}-file`}
          type="file"
          accept="image/*"
          capture="environment"
          disabled={busy}
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {preview ? (
        <div className="row">
          <img className="label-preview" src={preview} alt="The label photo you chose" />
          {busy ? <Spinner label="Reading the label…" /> : null}
        </div>
      ) : null}
      {error ? (
        <Banner tone="warn" title={error.title} role="alert">
          {error.advice ? <span>{error.advice}</span> : null}
        </Banner>
      ) : null}
      <ul className="tips" aria-label="Privacy of label photos">
        <li>The photo is shrunk to 1600 px and sent once to the Unstack server, which forwards it to the label reader on Nebius Token Factory (also in demo mode).</li>
        <li>It is not stored on the server or on this device. Only the text you approve is saved.</li>
      </ul>
    </div>
  );
}
