import { Link } from 'wouter';
import { CageRoom } from '@/components/cage-room';
import { SpinningA } from '@/components/spinning-a';
import { ThemeToggle } from '@/components/shell';

export default function Home() {
  return (
    <CageRoom>
      <h1 className="sr-only">Community Bail Research</h1>
      <SpinningA className="w-[min(78vw,26rem)] h-auto" />
      <Link href="/menu" className="btn mt-8 px-8" data-testid="button-empty-the-cages">
        Empty the cages <span aria-hidden="true" className="ml-3">&crarr;</span>
      </Link>
      <p className="hint mt-8 max-w-md text-center">
        A private tool for community volunteers to inspect real, court-backed bail observations. Descriptive only: no recommendations, risk or custody findings.
      </p>
      <div className="mt-4"><ThemeToggle /></div>
    </CageRoom>
  );
}
