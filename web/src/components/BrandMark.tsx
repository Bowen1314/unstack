/** The Unstack mark: three bars pulled apart. Same geometry as public/favicon.svg. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--ink)" />
      <rect x="7" y="8" width="13" height="4" rx="2" fill="var(--paper)" />
      <rect x="12" y="14" width="13" height="4" rx="2" fill="var(--accent)" />
      <rect x="7" y="20" width="13" height="4" rx="2" fill="var(--paper)" />
    </svg>
  );
}
