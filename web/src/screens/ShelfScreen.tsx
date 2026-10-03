import { CATALOG, DEMO_SHELF_IDS, productFromCatalog } from '../../../shared/catalog.ts';
import type { Product } from '../../../shared/types.ts';
import { IconArrowRight, IconCheck } from '../components/icons.tsx';
import { Banner, PageHead } from '../components/ui.tsx';
import { useShelf } from '../derive.ts';
import { plural } from '../format.ts';
import { href } from '../route.ts';
import { dispatch, newId, runningExperiments } from '../store.ts';
import { AddProduct } from './shelf/AddProduct.tsx';
import { ProductCard } from './shelf/ProductCard.tsx';

/** Demo products are dated a month back so the "patch-test new actives" note doesn't flag the whole shelf. */
export function demoShelf(now: Date = new Date()): Product[] {
  const addedAt = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  return DEMO_SHELF_IDS.flatMap((cid) => {
    const item = CATALOG.find((c) => c.catalogId === cid);
    return item ? [productFromCatalog(item, newId(), addedAt)] : [];
  });
}

function Welcome() {
  return (
    <>
      <PageHead eyebrow="Unstack" title="Check your shelf before you layer it" />
      <section className="card welcome" aria-labelledby="welcome-title">
        <div className="stack">
          <h2 id="welcome-title">Then change one thing at a time.</h2>
          <p className="muted">
            Add the products you already own. Unstack finds layering conflicts and duplicates, lays them out as a weekly plan, and uses the YouCam
            Skin Analysis API to show which products match what you care about.
          </p>
          <div className="row">
            <button type="button" className="btn btn--primary btn--lg" onClick={() => dispatch({ type: 'onboard', products: demoShelf() })}>
              Load demo shelf
            </button>
            <button type="button" className="btn btn--lg" onClick={() => dispatch({ type: 'onboard', products: [] })}>
              Start empty
            </button>
          </div>
          <p className="xs subtle">The demo shelf is a typical over-stacked routine: nine generic products, three exfoliants, a retinoid and no sunscreen.</p>
        </div>
        <ol className="welcome-steps">
          <li>
            <span>
              <strong>Shelf</strong>Pick from a catalogue, paste an ingredient list, or photograph the label.
            </span>
          </li>
          <li>
            <span>
              <strong>Check</strong>Conflicts, duplicates and what is <em>not</em> a conflict, each with a cited source.
            </span>
          </li>
          <li>
            <span>
              <strong>Plan</strong>A week of morning and evening sessions where clashing actives never meet.
            </span>
          </li>
          <li>
            <span>
              <strong>Scan</strong>YouCam appearance scores, mapped to the products on your shelf.
            </span>
          </li>
          <li>
            <span>
              <strong>Experiment</strong>Change one product, rescan every two weeks, and see if it moved beyond noise.
            </span>
          </li>
        </ol>
      </section>
    </>
  );
}

export function ShelfScreen() {
  const { state, report } = useShelf();
  const running = runningExperiments(state)[0];

  if (!state.onboarded && state.products.length === 0) return <Welcome />;

  const activeCount = state.products.filter((p) => (report.analyses[p.id]?.actives.length ?? 0) > 0).length;
  const flagged = report.findings.filter((f) => f.severity === 'high' || f.severity === 'medium').length;

  return (
    <>
      <PageHead
        title="Your shelf"
        lede="Everything you put on your face, with the ingredient families Unstack recognised. Set when and how often you use each one."
        actions={
          state.products.length > 0 ? (
            <a className="btn btn--primary" href={href('check')}>
              <IconCheck />
              Check this shelf
            </a>
          ) : null
        }
      />

      <div className="stack">
        {running ? (
          <Banner tone="warn" title={`Experiment running: ${running.title}`}>
            <span>
              Changes you make here are logged as possible confounders in that experiment, so its result stays honest.{' '}
              <a href={href('experiments')}>View experiment</a>
            </span>
          </Banner>
        ) : null}

        <div className="shelf-layout">
          <section aria-labelledby="shelf-count" className="stack">
            <div className="row-between">
              <h2 id="shelf-count">{plural(state.products.length, 'product')}</h2>
              {state.products.length > 0 ? (
                <p className="small muted">
                  {plural(activeCount, 'product')} with actives
                  {flagged > 0 ? (
                    <>
                      {' · '}
                      <a href={href('check')}>
                        {plural(flagged, 'issue')} to review <IconArrowRight width={14} height={14} style={{ display: 'inline', verticalAlign: '-2px' }} />
                      </a>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
            {state.products.length === 0 ? (
              <div className="card card--sunk empty">
                <h3>Your shelf is empty</h3>
                <p className="muted">Add the first product from the catalogue, paste its ingredient list, or photograph the label.</p>
                <button type="button" className="btn" onClick={() => dispatch({ type: 'onboard', products: demoShelf() })}>
                  Load demo shelf instead
                </button>
              </div>
            ) : (
              <ul className="product-list">
                {state.products.map((p, i) => {
                  const analysis = report.analyses[p.id];
                  return analysis ? (
                    <li key={p.id}>
                      <ProductCard product={p} analysis={analysis} index={i} />
                    </li>
                  ) : null;
                })}
              </ul>
            )}
          </section>
          <aside aria-label="Add a product">
            <AddProduct />
          </aside>
        </div>
      </div>
    </>
  );
}
