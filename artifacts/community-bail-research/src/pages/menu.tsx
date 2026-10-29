import { Link } from 'wouter';
import { CageRoom } from '@/components/cage-room';
import { ThemeToggle } from '@/components/shell';

const PANELS = [
  { href: '/search', n: '01', title: 'Search bail', id: 'search', text: 'Search collected dockets by hearing date and a recorded bail amount filter. Finding an amount never implies release eligibility.' },
  { href: '/review', n: '02', title: 'Review', id: 'review', text: 'Check saved observations against their sources.' },
  { href: '/candidates', n: '03', title: 'Saved dockets', id: 'saved-dockets', text: 'Observations you chose to save, with review status. Not recommendations.' },
];

export default function Menu() {
  return (
    <CageRoom>
      <div className="bracket mb-6">Menu</div>
      <ul className="grid gap-4 md:grid-cols-3 w-full max-w-5xl">
        {PANELS.map((p) => (
          <li key={p.href}>
            <Link href={p.href} className="block h-full border border-primary bg-background/80 p-6 hover:bg-primary/10 min-h-48" data-testid={`link-menu-${p.id}`}>
              <div className="mono text-sm text-muted-foreground">{p.n}</div>
              <div className="mono text-3xl font-bold text-primary title-glow my-3">{p.title}</div>
              <p className="hint">{p.text}</p>
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3 mt-8 items-center justify-center">
        <Link href="/discovery" className="navlink" data-testid="link-menu-advanced">Advanced court search</Link>
        <Link href="/feedback" className="navlink" data-testid="link-menu-feedback">Feedback</Link>
        <Link href="/records/new" className="navlink" data-testid="link-menu-manual">Enter a record by hand</Link>
        <Link href="/research" className="navlink" data-testid="link-menu-saved">Saved-record search</Link>
        <Link href="/" className="navlink" data-testid="link-menu-home">Back to start</Link>
        <ThemeToggle />
      </div>
    </CageRoom>
  );
}
