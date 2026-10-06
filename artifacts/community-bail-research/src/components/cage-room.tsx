import type { ReactNode } from 'react';
import prisonLandscape from '@assets/community-bail-research-prison-landscape.png';

export function CageRoom({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-background flex flex-col items-center justify-center px-4 py-10">
      <div
        aria-hidden="true"
        className="cage-room-backdrop absolute inset-0 pointer-events-none"
        style={{ backgroundImage: `linear-gradient(180deg, rgb(1 8 4 / .12), transparent 40%, rgb(1 8 4 / .16)), url("${prisonLandscape}")` }}
      />
      <div className="relative z-10 w-full flex flex-col items-center">{children}</div>
    </div>
  );
}
