import { useEffect, useRef } from 'react';
import { BrandMark } from './components/BrandMark.tsx';
import { IconCheck, IconFlask, IconLock, IconPlan, IconScan, IconShelf, type IconComponent } from './components/icons.tsx';
import { ToastHost } from './components/ui.tsx';
import { useShelf } from './derive.ts';
import { unitsPill } from './format.ts';
import { href, useRoute, type Route } from './route.ts';
import { CheckScreen } from './screens/CheckScreen.tsx';
import { ExperimentsScreen } from './screens/ExperimentsScreen.tsx';
import { PlanScreen } from './screens/PlanScreen.tsx';
import { PrivacyScreen } from './screens/PrivacyScreen.tsx';
import { ScanScreen } from './screens/scan/ScanScreen.tsx';
import { ShelfScreen } from './screens/ShelfScreen.tsx';
import { useServerStatus, type ServerState } from './serverStatus.ts';

const NAV: { route: Route; label: string; Icon: IconComponent }[] = [
  { route: 'shelf', label: 'Shelf', Icon: IconShelf },
  { route: 'check', label: 'Check', Icon: IconCheck },
  { route: 'plan', label: 'Plan', Icon: IconPlan },
  { route: 'scan', label: 'Scan', Icon: IconScan },
  { route: 'experiments', label: 'Experiments', Icon: IconFlask },
  { route: 'privacy', label: 'Privacy', Icon: IconLock },
];

const TAB_LABEL: Partial<Record<Route, string>> = { experiments: 'Trials' };

function ModePill({ server }: { server: ServerState }) {
  if (server.phase === 'offline') {
    return (
      <a className="pill pill--offline" href={href('privacy')} title="The Unstack server is not reachable">
        <span className="pill-dot" aria-hidden="true" />
        <span>Offline</span>
        <span className="pill-long">&nbsp;server</span>
      </a>
    );
  }
  if (!server.status) {
    return (
      <span className="pill" aria-live="polite">
        Connecting…
      </span>
    );
  }
  const live = server.status.mode === 'live';
  return (
    <a
      className={`pill ${live ? 'pill--live' : 'pill--demo'}`}
      href={href('privacy')}
      title={live ? 'Scans call the real YouCam API and spend units' : 'Scans use recorded YouCam responses; no units are spent'}
    >
      <span className="pill-dot" aria-hidden="true" />
      {live ? (
        <span>
          Live<span className="pill-long"> · YouCam</span>
        </span>
      ) : (
        <span>
          Demo<span className="pill-long"> mode</span>
        </span>
      )}
    </a>
  );
}

function Screen({ route }: { route: Route }) {
  switch (route) {
    case 'shelf':
      return <ShelfScreen />;
    case 'check':
      return <CheckScreen />;
    case 'plan':
      return <PlanScreen />;
    case 'scan':
      return <ScanScreen />;
    case 'experiments':
      return <ExperimentsScreen />;
    case 'privacy':
      return <PrivacyScreen />;
  }
}

export function App() {
  const route = useRoute();
  const server = useServerStatus();
  const { report } = useShelf();
  const highCount = report.findings.filter((f) => f.severity === 'high').length;
  const first = useRef(true);

  // On navigation: back to the top, and move focus to the new page's heading for screen readers.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    document.getElementById('page-title')?.focus({ preventScroll: true });
  }, [route]);

  useEffect(() => {
    const label = NAV.find((n) => n.route === route)?.label ?? 'Shelf';
    document.title = `${label} · Unstack`;
  }, [route]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href={href('shelf')} aria-label="Unstack, go to your shelf">
            <BrandMark className="brand-mark" />
            <span className="brand-word">Unstack</span>
          </a>
          <nav className="nav" aria-label="Main">
            {NAV.map(({ route: r, label, Icon }) => (
              <a key={r} href={href(r)} aria-current={r === route ? 'page' : undefined}>
                <Icon width={16} height={16} />
                {label}
                {r === 'check' && highCount > 0 ? (
                  <span className="nav-count" aria-label={`${highCount} high priority`}>
                    {highCount}
                  </span>
                ) : null}
              </a>
            ))}
          </nav>
          <div className="header-pills">
            <ModePill server={server} />
            {server.status ? (
              <a className="pill" href={href('privacy')} title="YouCam unit ledger">
                <span className="num">{unitsPill(server.status)}</span>
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <main id="main" className="main">
        <Screen route={route} />
      </main>

      <footer className="site-footer">
        <p>Cosmetic guidance only, not medical advice. Scores describe how skin looks in one photo.</p>
        <p>
          Skin analysis by the{' '}
          <a href="https://www.makeupar.com/perfectbeauty/youcam/privacy-policy-api" target="_blank" rel="noopener noreferrer">
            YouCam API
          </a>{' '}
          (Perfect Corp.)
        </p>
      </footer>

      <nav className="tabbar" aria-label="Main">
        {NAV.map(({ route: r, label, Icon }) => (
          <a key={r} href={href(r)} aria-current={r === route ? 'page' : undefined}>
            <Icon />
            <span>{TAB_LABEL[r] ?? label}</span>
            {r === 'check' && highCount > 0 ? <span className="tab-dot" aria-label={`${highCount} high priority`} /> : null}
          </a>
        ))}
      </nav>
      <ToastHost />
    </>
  );
}
