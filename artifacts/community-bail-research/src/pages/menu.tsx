import { Link } from 'wouter';
import { CageRoom } from '@/components/cage-room';

const PANELS = [
  { href: '/search', n: '01', title: 'Search', id: 'search' },
  { href: '/review', n: '02', title: 'Review', id: 'review' },
  { href: '/candidates', n: '03', title: 'Candidates', id: 'candidates' },
];

export default function Menu() {
  return (
    <CageRoom>
      <div className="bracket mb-6">Menu</div>
      <ul className="grid gap-4 md:grid-cols-3 w-full max-w-5xl">
        {PANELS.map((p) => (
          <li key={p.href}>
            <Link href={p.href} className="block h-full border border-primary bg-background/80 p-6 hover:bg-primary/10" data-testid={`link-menu-${p.id}`}>
              <div className="mono text-sm text-muted-foreground">{p.n}</div>
              <div className="mono text-3xl font-bold text-primary title-glow my-3">{p.title}</div>
            </Link>
          </li>
        ))}
      </ul>
    </CageRoom>
  );
}
