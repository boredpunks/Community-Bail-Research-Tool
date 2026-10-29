import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useStandardView } from '@/lib/theme';
import { useWorkspaceAccess } from '@/lib/workspace-access';

export function ThemeToggle() {
  const { standard, toggle } = useStandardView();
  return (
    <button
      type="button"
      className="btn standard-view-toggle"
      onClick={toggle}
      aria-pressed={standard}
      data-testid="button-standard-view"
    >
      {standard ? 'Terminal view' : 'Standard view'}
    </button>
  );
}

function LockWorkspace() {
  const { lockWorkspace, isLocking } = useWorkspaceAccess();
  const [, setLocation] = useLocation();
  const [error, setError] = useState('');

  async function lock() {
    setError('');
    try {
      await lockWorkspace();
      setLocation('/');
    } catch {
      setError('The workspace could not be locked. Please try again.');
    }
  }

  return (
    <>
      <button type="button" className="btn" data-testid="button-lock-workspace" onClick={lock} disabled={isLocking}>
        {isLocking ? 'Locking…' : 'Lock workspace'}
      </button>
      {error ? <span role="alert" className="hint text-destructive">{error}</span> : null}
    </>
  );
}

const NAV = [
  { href: '/menu', label: 'Menu' },
  { href: '/discovery', label: 'Search' },
  { href: '/search', label: 'Search Bail' },
  { href: '/review', label: 'Review' },
  { href: '/candidates', label: 'Candidates' },
  { href: '/records/new', label: 'Enter record' },
  { href: '/research', label: 'Saved records' },
];

export function Shell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  return (
    <div className="min-h-[100dvh] flex flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:p-3 focus:bg-card">Skip to content</a>
      <header className="border-b-2 border-primary bg-background">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center gap-x-6 gap-y-3 justify-between">
          <Link href="/" className="block" data-testid="link-home">
            <div className="mono text-2xl md:text-3xl font-bold text-primary title-glow">
              BAIL RESEARCH SEARCH<span className="cursor-block" aria-hidden="true" />
            </div>
            <div className="mono text-sm text-muted-foreground">Community research workspace for saved, source-backed records</div>
          </Link>
          <div className="flex flex-wrap gap-2 items-center">
            <ThemeToggle />
            <LockWorkspace />
          </div>
        </div>
        <nav aria-label="Primary" className="max-w-6xl mx-auto px-4 pb-3 flex flex-wrap gap-2">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="navlink" aria-current={loc === n.href ? 'page' : undefined} data-testid={`nav-${n.href.slice(1).replace('/', '-')}`}>
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main id="main" className="flex-1 max-w-6xl w-full mx-auto px-4 py-8">{children}</main>
      <footer className="border-t border-border">
        <p className="max-w-6xl mx-auto px-4 py-5 hint">
          Descriptive research support only. This tool does not recommend bail for any person, assess release eligibility or risk, or verify custody. It is not affiliated with any court or agency.
        </p>
      </footer>
    </div>
  );
}

export function PageHead({ label, title, children }: { label: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="bracket mb-1">{label}</div>
      <h1 className="mono text-2xl md:text-3xl font-bold">{title}</h1>
      {children ? <div className="mt-2 hint max-w-3xl text-base">{children}</div> : null}
    </div>
  );
}
