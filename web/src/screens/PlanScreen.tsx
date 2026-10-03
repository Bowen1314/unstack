import { DAY_NAMES } from '../../../shared/schedule.ts';
import { IconCheck, IconMoon, IconSun } from '../components/icons.tsx';
import { PageHead, SourceList } from '../components/ui.tsx';
import { productName, usePlan, useShelf } from '../derive.ts';
import { adjustmentLine, plural } from '../format.ts';
import { href } from '../route.ts';

const FULL_DAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function PlanScreen() {
  const { state, report, byId } = useShelf();
  const plan = usePlan(state.products, report);
  const today = (new Date().getDay() + 6) % 7;
  const isActive = (id: string) => (report.analyses[id]?.actives.length ?? 0) > 0;

  if (state.products.length === 0) {
    return (
      <>
        <PageHead title="Weekly plan" />
        <div className="card card--sunk empty">
          <h2>No products to plan</h2>
          <p className="muted">Add your products first. The plan keeps clashing actives in separate sessions and spreads them across the week.</p>
          <a className="btn btn--primary" href={href('shelf')}>
            Go to your shelf
          </a>
        </div>
      </>
    );
  }

  // De-duplicate kept-apart pairs (one rule may link the same two products).
  const seen = new Set<string>();
  const keptApart = report.sessionConflicts.filter((c) => {
    const key = [c.a, c.b].sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const rx = state.products.filter((p) => p.prescription);

  return (
    <>
      <PageHead
        title="Weekly plan"
        lede="Your shelf laid out over seven days. Products are in layering order, conflicting actives never share a session, retinoids stay at night and sunscreen in the morning."
        actions={
          <a className="btn" href={href('check')}>
            <IconCheck />
            Back to check
          </a>
        }
      />

      <div className="stack-lg">
        <section aria-labelledby="plan-week-h" className="stack">
          <div className="row-between">
            <h2 id="plan-week-h">This week</h2>
            <div className="plan-legend" aria-hidden="true">
              <span>
                <i className="legend-swatch" /> Active ingredient
              </span>
              <span>
                <span className="rest-badge">
                  <IconMoon width={11} height={11} /> Rest night
                </span>
                no actives, recovery time
              </span>
            </div>
          </div>
          <div className="plan-week">
            {plan.days.map((day, i) => {
              const rest = plan.restNights.includes(i);
              return (
                <section key={i} className={`plan-day${i === today ? ' is-today' : ''}`} aria-label={`${FULL_DAY[i]}${i === today ? ' (today)' : ''}`}>
                  <div className="plan-day-head">
                    <span>{DAY_NAMES[i]}</span>
                    {i === today ? <span className="xs">Today</span> : null}
                  </div>
                  {(['am', 'pm'] as const).map((s) => {
                    const ids = day[s];
                    return (
                      <div key={s} className={`plan-cell plan-cell--${s}`}>
                        <div className="plan-cell-label">
                          <span className="row" style={{ gap: 4 }}>
                            {s === 'am' ? <IconSun /> : <IconMoon />}
                            {s === 'am' ? 'Morning' : 'Evening'}
                          </span>
                          {s === 'pm' && rest ? (
                            <span className="rest-badge">
                              Rest<span className="sr-only"> night: no actives</span>
                            </span>
                          ) : null}
                        </div>
                        {ids.length === 0 ? (
                          <p className="xs subtle">Nothing scheduled</p>
                        ) : (
                          <ol className="plan-steps">
                            {ids.map((id, n) => (
                              <li key={id} className={isActive(id) ? 'is-active' : undefined}>
                                <span className="step-n">{n + 1}</span>
                                <span className="step-name">
                                  {productName(byId, id)}
                                  {isActive(id) ? <span className="sr-only"> (active)</span> : null}
                                </span>
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
          <p className="xs subtle">
            {plural(plan.restNights.length, 'rest night')} this week. Apply in the order shown: thinnest to thickest, sunscreen last in the morning.
          </p>
        </section>

        {plan.adjustments.length > 0 ? (
          <section aria-labelledby="plan-adj-h" className="section">
            <div className="section-title">
              <h2 id="plan-adj-h">What the plan changed</h2>
              <span className="tag tag--plain num">{plan.adjustments.length}</span>
            </div>
            <p className="small muted">You asked for more than published guidance suggests, or two products couldn’t share a session. Here is every reduction and why.</p>
            <ul className="adjustments">
              {plan.adjustments.map((a, i) => (
                <li key={`${a.productId}-${a.session}-${i}`} className="adjustment">
                  <span className="adjustment-count" aria-hidden="true">
                    <s>{a.requested}</s>→{a.scheduled}
                  </span>
                  <div className="stack-sm">
                    <p>
                      <strong>{productName(byId, a.productId)}</strong>: {adjustmentLine(a.session, a.requested, a.scheduled)}
                    </p>
                    <p className="small muted">
                      <span className={`tag ${a.kind === 'guidance' ? 'tag--info' : 'tag--medium'}`} style={{ marginRight: 6 }}>
                        {a.kind === 'guidance' ? 'Guidance' : 'Conflict'}
                      </span>
                      {a.kind === 'conflict' ? `Couldn’t place more: ${a.reason.startsWith('no ') ? `there was ${a.reason}` : `it ${a.reason}`}.` : a.reason}
                    </p>
                    <SourceList ids={a.sourceIds} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="grid-2">
          {keptApart.length > 0 ? (
            <section className="card" aria-labelledby="plan-apart-h">
              <div className="card-head">
                <div>
                  <h2 id="plan-apart-h">Kept apart</h2>
                  <p className="small muted">These pairs never share a morning or an evening.</p>
                </div>
              </div>
              <ul className="pair-list">
                {keptApart.map((c) => (
                  <li key={`${c.a}-${c.b}-${c.ruleId}`}>
                    <span className="chip chip--product">{productName(byId, c.a)}</span>
                    <span className="pair-sep" aria-hidden="true">
                      ×
                    </span>
                    <span className="sr-only">and</span>
                    <span className="chip chip--product">{productName(byId, c.b)}</span>
                    <span className="xs subtle">{c.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="card card--sunk" aria-labelledby="plan-how-h">
            <h2 id="plan-how-h" style={{ marginBottom: 'var(--space-3)' }}>
              How the plan is built
            </h2>
            <ul className="stack-sm small muted" style={{ paddingLeft: '1.1em' }}>
              <li>Retinoids first, every other night to start; exfoliants 2–3 times a week and never on retinoid nights.</li>
              <li>No more than two actives in one session, and no conflicting pair together.</li>
              <li>Sunscreen every morning, last step.</li>
              {rx.length > 0 ? <li>Prescribed products ({rx.map((p) => p.name).join(', ')}) are scheduled as you set them. Follow your prescriber.</li> : null}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
