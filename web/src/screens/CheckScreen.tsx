import { CONCERNS, FOCUS_THRESHOLD } from '../../../shared/concerns.ts';
import { severityCounts } from '../../../shared/rules.ts';
import type { ClearedPair, Finding, Severity } from '../../../shared/types.ts';
import { IconCheckCircle, IconLightbulb, IconPlan, IconScan, IconSun } from '../components/icons.tsx';
import { EvidenceBadge, PageHead, ProductChips, SEVERITY_ICON, SEVERITY_LABEL, SeverityTag, SourceList } from '../components/ui.tsx';
import { isDemoId } from '../demo.ts';
import { productName, useShelf } from '../derive.ts';
import { formatDate, plural } from '../format.ts';
import { href } from '../route.ts';

const ORDER: Severity[] = ['high', 'medium', 'low', 'info'];
const GROUP_TITLE: Record<Severity, string> = {
  high: 'High priority',
  medium: 'Worth changing',
  low: 'Minor',
  info: 'Good to know',
};

function FindingCard({ finding, names }: { finding: Finding; names: string[] }) {
  return (
    <article className={`card finding finding--${finding.severity}`}>
      <div className="finding-head">
        <SeverityTag severity={finding.severity} />
        <EvidenceBadge evidence={finding.evidence} />
        <h3>{finding.title}</h3>
      </div>
      <p className="small">{finding.detail}</p>
      <div className="finding-suggestion">
        <IconLightbulb />
        <p>
          <strong>Try: </strong>
          {finding.suggestion}
        </p>
      </div>
      {names.length > 0 || finding.sourceIds.length > 0 ? (
        <div className="finding-foot">
          {names.length > 0 ? (
            <div className="stack-sm">
              <div className="eyebrow">Products</div>
              <ProductChips names={names} />
            </div>
          ) : (
            <div />
          )}
          <SourceList ids={finding.sourceIds} />
        </div>
      ) : null}
    </article>
  );
}

function ClearedCard({ pair, names }: { pair: ClearedPair; names: string[] }) {
  return (
    <article className="card finding finding--cleared">
      <div className="finding-head">
        <span className="tag tag--ok">
          <IconCheckCircle />
          Not a conflict
        </span>
        <EvidenceBadge evidence={pair.evidence} />
        <h3>{pair.title}</h3>
      </div>
      <p className="small">{pair.detail}</p>
      <div className="finding-foot">
        <div className="stack-sm">
          <div className="eyebrow">Products</div>
          <ProductChips names={names} />
        </div>
        <SourceList ids={pair.sourceIds} />
      </div>
    </article>
  );
}

export function CheckScreen() {
  const { state, report, focus, focusScan, byId } = useShelf();
  const counts = severityCounts(report.findings);
  const names = (ids: string[]) => ids.map((id) => productName(byId, id));

  if (state.products.length === 0) {
    return (
      <>
        <PageHead title="Shelf check" />
        <div className="card card--sunk empty">
          <h2>Nothing to check yet</h2>
          <p className="muted">Add the products you use, and Unstack will look for layering conflicts, duplicates and missing sunscreen.</p>
          <a className="btn btn--primary" href={href('shelf')}>
            Go to your shelf
          </a>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Shelf check"
        lede={`${plural(state.products.length, 'product')} checked against cited layering rules. Every finding says how strong the evidence is and where it comes from.`}
        actions={
          <a className="btn" href={href('plan')}>
            <IconPlan />
            See weekly plan
          </a>
        }
      />

      <div className="stack-lg">
        <section aria-label="Summary" className="stack">
          <div className="summary-strip">
            {ORDER.map((s) => {
              const Icon = SEVERITY_ICON[s];
              return (
                <a
                  key={s}
                  className={`summary-cell summary-cell--${s}${counts[s] > 0 ? ' has-items' : ''}`}
                  href={counts[s] > 0 ? `#check-${s}` : undefined}
                  onClick={(e) => {
                    if (counts[s] === 0) return;
                    e.preventDefault();
                    document.getElementById(`check-${s}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  <span className="summary-n">{counts[s]}</span>
                  <span className="summary-label">
                    <Icon />
                    {SEVERITY_LABEL[s]}
                  </span>
                </a>
              );
            })}
          </div>
          <div className="context-line">
            <span>
              <IconScan />
              {focusScan && focus.length > 0 ? (
                <span>
                  Focus from your scan on {formatDate(focusScan.takenAt)}
                  {isDemoId(focusScan.id) ? ' (demo)' : ''}: <strong>{focus.map((c) => CONCERNS[c].label).join(', ')}</strong>
                </span>
              ) : (
                <span>
                  No scan yet. <a href={href('scan')}>Scan</a> to make the check focus-aware (for example, fragrance matters more when redness is a focus).
                </span>
              )}
            </span>
            <span>
              <IconSun />
              {state.sunProfile.scale ? (
                <span>
                  Sun profile: Fitzpatrick {state.sunProfile.scale} ({state.sunProfile.source === 'youcam' ? 'YouCam' : 'self-reported'})
                </span>
              ) : (
                <span>
                  Sun profile not set. <a href={href('scan')}>Add one</a> (optional)
                </span>
              )}
            </span>
          </div>
          {focus.length > 0 ? (
            <p className="xs subtle">Focus concerns are those with a YouCam raw score under {FOCUS_THRESHOLD}. That threshold is our own heuristic; YouCam doesn’t publish score bands.</p>
          ) : null}
        </section>

        {report.findings.length === 0 ? (
          <div className="card empty">
            <IconCheckCircle width={32} height={32} style={{ color: 'var(--ok)' }} />
            <h2>No conflicts found</h2>
            <p className="muted">Nothing on this shelf clashes under the rules Unstack knows. Keep sunscreen in your morning routine.</p>
          </div>
        ) : (
          ORDER.filter((s) => counts[s] > 0).map((s) => (
            <section key={s} id={`check-${s}`} className="section" aria-labelledby={`check-${s}-h`} style={{ scrollMarginTop: 'calc(var(--header-h) + 16px)' }}>
              <div className="section-title">
                <h2 id={`check-${s}-h`}>{GROUP_TITLE[s]}</h2>
                <span className="tag tag--plain num">{counts[s]}</span>
              </div>
              <div className="stack">
                {report.findings
                  .filter((f) => f.severity === s)
                  .map((f, i) => (
                    <FindingCard key={`${f.ruleId}-${i}`} finding={f} names={names(f.productIds)} />
                  ))}
              </div>
            </section>
          ))
        )}

        {report.cleared.length > 0 ? (
          <section className="section" aria-labelledby="check-cleared-h">
            <div className="section-title">
              <h2 id="check-cleared-h">Not a conflict</h2>
              <span className="tag tag--ok num">{report.cleared.length}</span>
            </div>
            <p className="small muted">Pairs people often avoid online that the evidence says are fine together.</p>
            <div className="stack">
              {report.cleared.map((c) => (
                <ClearedCard key={c.id} pair={c} names={names(c.productIds)} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
