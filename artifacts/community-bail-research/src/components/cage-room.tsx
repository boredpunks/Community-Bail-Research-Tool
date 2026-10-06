import type { ReactNode } from 'react';

export function CageRoom({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-background flex flex-col items-center justify-center px-4 py-10">
      <svg aria-hidden="true" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full pointer-events-none" fill="none" stroke="currentColor" strokeWidth="0.8" style={{ color: 'hsl(138 100% 50% / .22)' }}>
        <path d="M0 0L330 200H670L1000 0M0 700L330 470H670L1000 700M330 200V470M670 200V470" />
        {Array.from({ length: 9 }, (_, i) => {
          const t = (i + 1) / 10;
          return (
            <g key={i}>
              <path d={`M${330 + t * 340} 200L${t * 1000} 0M${330 + t * 340} 470L${t * 1000} 700`} />
              <path d={`M0 ${t * 700}L330 ${200 + t * 270}H670L1000 ${t * 700}`} />
              <path d={`M${330 * t} ${200 * t}H${1000 - 330 * t}M${330 * t} ${700 - 230 * t}H${1000 - 330 * t}`} />
            </g>
          );
        })}
      </svg>
      <div className="relative z-10 w-full flex flex-col items-center">{children}</div>
    </div>
  );
}
