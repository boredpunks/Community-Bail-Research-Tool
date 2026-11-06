import { Link } from 'wouter';
import { CageRoom } from '@/components/cage-room';
import { WORKFLOW_PANELS } from '@/lib/workflow-copy';

export default function Menu() {
  return (
    <CageRoom>
      <div className="bracket mb-6">Menu</div>
      <ul className="grid gap-4 md:grid-cols-3 w-full max-w-5xl">
        {WORKFLOW_PANELS.map((p) => (
          <li key={p.href}>
            <Link href={p.href} className="block h-full min-h-48 border border-primary bg-background/80 p-6 hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" data-testid={`link-menu-${p.id}`}>
              <div className="mono text-sm text-muted-foreground">{p.n}</div>
              <div className="mono text-3xl font-bold text-primary title-glow my-3">{p.title}</div>
              <p className="hint">{p.text}</p>
            </Link>
          </li>
        ))}
      </ul>
    </CageRoom>
  );
}
