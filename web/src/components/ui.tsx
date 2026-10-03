/** Shared presentational pieces. */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ACTIVE_FAMILIES, FAMILY_LABEL } from '../../../shared/ingredients.ts';
import { EVIDENCE_LABEL } from '../../../shared/rules.ts';
import { sourcesFor, type SourceId } from '../../../shared/sources.ts';
import type { Evidence, Family, ProductAnalysis, Severity } from '../../../shared/types.ts';
import {
  IconAlert,
  IconAlertCircle,
  IconCheckCircle,
  IconExternal,
  IconInfo,
  IconMinusCircle,
} from './icons.tsx';

export function PageHead({ title, lede, actions, eyebrow }: { title: string; lede?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="page-head">
      {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
      <div className="row-between">
        <h1 id="page-title" tabIndex={-1}>
          {title}
        </h1>
        {actions ? <div className="row">{actions}</div> : null}
      </div>
      {lede ? <p className="lede">{lede}</p> : null}
    </header>
  );
}

type Tone = 'info' | 'warn' | 'error' | 'ok';

const TONE_ICON: Record<Tone, (p: { title?: string }) => ReactNode> = {
  info: IconInfo,
  warn: IconAlertCircle,
  error: IconAlert,
  ok: IconCheckCircle,
};

export function Banner({ tone = 'info', title, children, role }: { tone?: Tone; title?: ReactNode; children?: ReactNode; role?: 'status' | 'alert' }) {
  const Icon = TONE_ICON[tone];
  return (
    <div className={`banner banner--${tone}`} role={role}>
      <Icon />
      <div className="banner-body">
        {title ? <strong>{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Note',
};

export const SEVERITY_ICON: Record<Severity, (p: { title?: string }) => ReactNode> = {
  high: IconAlert,
  medium: IconAlertCircle,
  low: IconMinusCircle,
  info: IconInfo,
};

export function SeverityTag({ severity }: { severity: Severity }) {
  const Icon = SEVERITY_ICON[severity];
  return (
    <span className={`tag tag--${severity}`}>
      <Icon />
      {SEVERITY_LABEL[severity]}
      <span className="sr-only"> priority</span>
    </span>
  );
}

const EVIDENCE_BARS: Record<Evidence, number> = { strong: 3, moderate: 2, limited: 1 };

export function EvidenceBadge({ evidence }: { evidence: Evidence }) {
  const n = EVIDENCE_BARS[evidence];
  return (
    <span className="evidence" title="How strong the published evidence for this rule is">
      <span className="evidence-bars" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <i key={i} className={i <= n ? 'on' : undefined} />
        ))}
      </span>
      {EVIDENCE_LABEL[evidence]}
    </span>
  );
}

export function SourceList({ ids, heading = 'Sources' }: { ids: readonly SourceId[]; heading?: string }) {
  if (ids.length === 0) return null;
  return (
    <div className="stack-sm">
      <div className="eyebrow">{heading}</div>
      <ul className="sources">
        {sourcesFor(ids).map((s) => (
          <li key={s.id}>
            <a href={s.url} target="_blank" rel="noopener noreferrer" title={s.supports}>
              <span>{s.label}</span>
              <IconExternal />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

const IRRITANTS: ReadonlySet<Family> = new Set<Family>(['fragrance', 'essential_oil', 'drying_alcohol']);

export function familyKind(f: Family): 'active' | 'spf' | 'irritant' | 'support' {
  if (ACTIVE_FAMILIES.has(f)) return 'active';
  if (f === 'sunscreen_filter') return 'spf';
  if (IRRITANTS.has(f)) return 'irritant';
  return 'support';
}

const KIND_ORDER = { active: 0, spf: 1, support: 2, irritant: 3 } as const;

export function FamilyChips({ analysis, empty = 'No recognised ingredients yet' }: { analysis: ProductAnalysis; empty?: string }) {
  const fams = [...analysis.families].sort((a, b) => KIND_ORDER[familyKind(a)] - KIND_ORDER[familyKind(b)]);
  if (fams.length === 0) return <p className="xs subtle">{empty}</p>;
  return (
    <ul className="chips" aria-label="Detected ingredient families">
      {fams.map((f) => {
        const kind = familyKind(f);
        const cls = kind === 'active' ? 'chip chip--active' : kind === 'spf' ? 'chip chip--spf' : kind === 'irritant' ? 'chip chip--irritant' : 'chip';
        return (
          <li key={f} className={cls}>
            {FAMILY_LABEL[f]}
            {kind === 'active' ? <span className="sr-only"> (active)</span> : null}
            {kind === 'irritant' ? <span className="sr-only"> (can irritate)</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ProductChips({ names, label = 'Products involved' }: { names: string[]; label?: string }) {
  if (names.length === 0) return null;
  return (
    <ul className="chips" aria-label={label}>
      {names.map((n, i) => (
        <li key={`${n}-${i}`} className="chip chip--product">
          {n}
        </li>
      ))}
    </ul>
  );
}

/** Two-step destructive button: the first click asks, the second acts. */
export function ConfirmButton({
  label,
  prompt,
  confirmLabel,
  onConfirm,
  className = 'btn btn--danger',
  icon,
}: {
  label: string;
  prompt: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  className?: string;
  icon?: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={className} onClick={() => setAsking(true)}>
        {icon}
        {label}
      </button>
    );
  }
  return (
    <div className="confirm-row" role="group" aria-label={prompt}>
      <span>{prompt}</span>
      <button
        type="button"
        className="btn btn--danger-solid btn--sm"
        disabled={busy}
        autoFocus
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="btn btn--sm" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </div>
  );
}

export function DemoRibbon({ children = 'Demo data' }: { children?: ReactNode }) {
  return <span className="demo-ribbon">{children}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" role="status">
      <span className="spinner" aria-hidden="true" />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

// ---------- Toasts ----------

interface ToastState {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

let toast: ToastState | null = null;
let toastSeq = 0;
const toastListeners = new Set<() => void>();

export function showToast(message: string, action?: ToastState['action']): void {
  toast = action ? { id: ++toastSeq, message, action } : { id: ++toastSeq, message };
  for (const l of toastListeners) l();
}

function hideToast(id: number): void {
  if (toast?.id !== id) return;
  toast = null;
  for (const l of toastListeners) l();
}

export function ToastHost() {
  const t = useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toast,
    () => null,
  );
  useEffect(() => {
    if (!t) return;
    const timer = setTimeout(() => hideToast(t.id), t.action ? 7000 : 4000);
    return () => clearTimeout(timer);
  }, [t]);
  return (
    <div aria-live="polite" aria-atomic="true">
      {t ? (
        <div className="toast" role="status">
          <span>{t.message}</span>
          {t.action ? (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                t.action?.run();
                hideToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
