import { useEffect, useMemo, useRef, useState } from 'react';

type V = [number, number, number];
type Edge = [number, number];
type Geometry = 'current' | 'extended';

const N = 56;
const D = 0.14;
const PERIOD_MS = 32000;
const INNER_RADIUS = 0.84;

function build(geometry: Geometry) {
  const verts: V[] = [];
  const edges: Edge[] = [];
  const loop = (r: number, z: number) => {
    const s = verts.length;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      verts.push([Math.cos(a) * r, Math.sin(a) * r, z]);
    }
    for (let i = 0; i < N; i++) edges.push([s + i, s + ((i + 1) % N)]);
    return s;
  };
  const of = loop(1, D), ob = loop(1, -D), inf = loop(INNER_RADIUS, D), inb = loop(INNER_RADIUS, -D);
  for (let i = 0; i < N; i++) {
    edges.push([of + i, ob + i], [inf + i, inb + i]);
    if (i % 2 === 0) edges.push([of + i, inf + i], [ob + i, inb + i]);
  }
  const quad = (pts: [number, number][]) => {
    const f = verts.length;
    pts.forEach(([x, y]) => verts.push([x, y, D]));
    pts.forEach(([x, y]) => verts.push([x, y, -D]));
    for (let i = 0; i < 4; i++) {
      edges.push(
        [f + i, f + ((i + 1) % 4)],
        [f + 4 + i, f + 4 + ((i + 1) % 4)],
        [f + i, f + 4 + i],
      );
    }
  };

  const topY = geometry === 'extended' ? Math.sqrt(INNER_RADIUS ** 2 - 0.08 ** 2) : 0.66;
  const footX = geometry === 'extended' ? 0.56 : 0.5;
  const footY = geometry === 'extended' ? -Math.sqrt(INNER_RADIUS ** 2 - footX ** 2) : -0.56;
  quad([[-0.08, topY], [0.08, topY], [footX, footY], [0.33, -0.56]]);
  quad([[-0.08, topY], [0.08, topY], [-0.33, -0.56], [-footX, footY]]);
  quad([[-0.3, -0.2], [0.3, -0.2], [0.3, -0.06], [-0.3, -0.06]]);
  return { verts, edges };
}

function SpinningA({ geometry }: { geometry: Geometry }) {
  const { verts, edges } = useMemo(() => build(geometry), [geometry]);
  const path = useRef<SVGPathElement>(null);

  useEffect(() => {
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    const draw = (t: number) => {
      const ang = motionPreference.matches ? 0.6 : (t / PERIOD_MS) * Math.PI * 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      const tilt = -0.18, ct = Math.cos(tilt), st = Math.sin(tilt);
      const pts = verts.map(([x, y, z]) => {
        const x1 = x * c + z * s, z1 = -x * s + z * c;
        const y2 = y * ct - z1 * st, z2 = y * st + z1 * ct;
        const k = 3.6 / (3.6 - z2);
        return [x1 * k * 100, -y2 * k * 100];
      });
      let d = '';
      for (const [a, b] of edges) d += `M${pts[a][0].toFixed(1)} ${pts[a][1].toFixed(1)}L${pts[b][0].toFixed(1)} ${pts[b][1].toFixed(1)}`;
      path.current?.setAttribute('d', d);
      if (!motionPreference.matches) raf = requestAnimationFrame(draw);
    };
    const updateMotion = () => {
      cancelAnimationFrame(raf);
      draw(performance.now());
    };
    motionPreference.addEventListener('change', updateMotion);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      motionPreference.removeEventListener('change', updateMotion);
    };
  }, [verts, edges]);

  return (
    <svg viewBox="-150 -150 300 300" className="cbr-preview-logo" role="img" aria-label="Slowly rotating three-dimensional wireframe of a circled A">
      <path ref={path} fill="none" stroke="#3dff7a" strokeWidth="1.1" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 4px #1fdc55)' }} />
    </svg>
  );
}

const THEME_KEY = 'cbr-standard-view';

function StandardViewButton({ compact }: { compact: boolean }) {
  const [standard, setStandard] = useState(() => {
    const enabled = localStorage.getItem(THEME_KEY) === '1';
    document.documentElement.classList.toggle('standard', enabled);
    return enabled;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('standard', standard);
  }, [standard]);

  function toggle() {
    const next = !standard;
    localStorage.setItem(THEME_KEY, next ? '1' : '0');
    document.documentElement.classList.toggle('standard', next);
    setStandard(next);
  }

  return (
    <button
      type="button"
      className={`btn${compact ? ' theme-toggle-compact' : ''}`}
      onClick={toggle}
      aria-pressed={standard}
    >
      {standard ? 'Terminal view' : 'Standard view'}
    </button>
  );
}

export function LogoPreview({ geometry, compactToggle }: { geometry: Geometry; compactToggle: boolean }) {
  return (
    <main className="cbr-preview">
      <div aria-hidden="true" className="cbr-preview-backdrop" />
      <div className="cbr-preview-content">
        <SpinningA geometry={geometry} />
        <StandardViewButton compact={compactToggle} />
      </div>
    </main>
  );
}
