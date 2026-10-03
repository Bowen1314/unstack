import { CONCERNS, coverage, type CoverageRow, type ScoredConcern } from '../../../../shared/concerns.ts';
import { FAMILY_LABEL } from '../../../../shared/ingredients.ts';
import { EVIDENCE_LABEL, type ShelfReport } from '../../../../shared/rules.ts';
import type { Product } from '../../../../shared/types.ts';
import { IconAlertCircle, IconCheckCircle, IconInfo, IconMinusCircle } from '../../components/icons.tsx';
import { productName } from '../../derive.ts';
import { href } from '../../route.ts';

const STATUS: Record<CoverageRow['status'], { label: string; cls: string; Icon: typeof IconInfo }> = {
  covered: { label: 'Covered', cls: 'tag--ok', Icon: IconCheckCircle },
  weak: { label: 'Weak evidence', cls: 'tag--low', Icon: IconMinusCircle },
  gap: { label: 'Gap', cls: 'tag--medium', Icon: IconAlertCircle },
  'not-topical': { label: 'Not topical', cls: 'tag--info', Icon: IconInfo },
};

export function CoverageSection({ products, report, focus }: { products: Product[]; report: ShelfReport; focus: ScoredConcern[] }) {
  const byId = new Map(products.map((p) => [p.id, p]));
  if (focus.length === 0) return null;
  const cov = coverage(products, report, focus);

  return (
    <div className="stack-lg">
      <section className="card stack" aria-labelledby="cov-h">
        <div>
          <h2 id="cov-h">Your focus vs your shelf</h2>
          <p className="small muted" style={{ marginTop: 4 }}>
            For each concern this scan flagged, the products you own whose ingredients are commonly used for it, with how strong that evidence is.
          </p>
        </div>
        {products.length === 0 ? (
          <p className="small muted">
            Your shelf is empty, so every concern below is a gap. <a href={href('shelf')}>Add your products</a> to see what already covers them.
          </p>
        ) : null}
        <table className="coverage-table">
          <thead>
            <tr>
              <th scope="col">Concern</th>
              <th scope="col">Status</th>
              <th scope="col">On your shelf</th>
            </tr>
          </thead>
          <tbody>
            {cov.rows.map((row) => {
              const st = STATUS[row.status];
              return (
                <tr key={row.concern}>
                  <td data-label="Concern">
                    <strong>{CONCERNS[row.concern].label}</strong>
                    <div className="xs subtle">{CONCERNS[row.concern].blurb}</div>
                  </td>
                  <td data-label="Status">
                    <span className={`tag ${st.cls}`}>
                      <st.Icon />
                      {st.label}
                    </span>
                  </td>
                  <td data-label="On your shelf">
                    {row.products.length > 0 ? (
                      <ul className="coverage-products">
                        {row.products.map((p) => (
                          <li key={p.productId}>
                            <strong>{productName(byId, p.productId)}</strong>{' '}
                            <span className="xs subtle">
                              {FAMILY_LABEL[p.family]} · {EVIDENCE_LABEL[p.evidence].toLowerCase()}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="small muted">
                        {row.status === 'not-topical' ? 'No product needed' : 'Nothing on your shelf targets this'}
                      </span>
                    )}
                    {row.note ? <p className="xs muted" style={{ marginTop: 6 }}>{row.note}</p> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {cov.offFocus.length > 0 ? (
        <section className="card card--sunk stack-sm" aria-labelledby="off-h">
          <h2 id="off-h">Products not aimed at your focus</h2>
          <p className="small muted">
            Their actives don’t target anything this scan flagged. Nothing wrong with them, but when they run out, consider not re-buying.
          </p>
          <ul className="coverage-products" style={{ marginTop: 'var(--space-2)' }}>
            {cov.offFocus.map((o) => (
              <li key={o.productId}>
                <strong>{productName(byId, o.productId)}</strong> <span className="xs subtle">{o.families.map((f) => FAMILY_LABEL[f]).join(', ')}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
