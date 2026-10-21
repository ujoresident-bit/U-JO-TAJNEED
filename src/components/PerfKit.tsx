import React, { useEffect, useMemo, useRef, useState } from 'react';

// Small animation toolkit shared by the Performance page and the Block
// Performance Summary. Pure CSS + requestAnimationFrame, no extra packages.

export const PerfStyles: React.FC = () => (
  <style>{`
    @keyframes pf-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pf-pop { 0% { opacity: 0; transform: scale(0.4); } 70% { transform: scale(1.12); } 100% { opacity: 1; transform: scale(1); } }
    @keyframes pf-grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
    @keyframes pf-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
    @keyframes pf-bounce { 0%,100% { transform: translateY(0) rotate(0); } 30% { transform: translateY(-10px) rotate(-6deg); } 60% { transform: translateY(0) rotate(5deg); } }
    @keyframes pf-flame { 0%,100% { transform: scale(1) rotate(-3deg); filter: drop-shadow(0 0 6px rgba(251,146,60,.6)); } 50% { transform: scale(1.14) rotate(3deg); filter: drop-shadow(0 0 14px rgba(251,191,36,.9)); } }
    @keyframes pf-pulse { 0%,100% { box-shadow: 0 0 0 0 var(--pf-glow, rgba(34,211,238,.35)); } 50% { box-shadow: 0 0 0 10px rgba(0,0,0,0); } }
    @keyframes pf-ecg { from { transform: translateX(0); } to { transform: translateX(-50%); } }
    @keyframes pf-shimmer { from { background-position: -200% 0; } to { background-position: 200% 0; } }
    @keyframes pf-confetti {
      0% { opacity: 1; transform: translate(0,0) rotate(0); }
      100% { opacity: 0; transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); }
    }
    @keyframes pf-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
    @keyframes pf-sheet { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    @keyframes pf-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes pf-check { 0% { transform: scale(0) rotate(-40deg); } 70% { transform: scale(1.25) rotate(8deg); } 100% { transform: scale(1) rotate(0); } }
    .pf-sheet { animation: pf-sheet .32s cubic-bezier(.2,.8,.2,1) both; }
    .pf-fade { animation: pf-fade .25s ease both; }
    .pf-check { animation: pf-check .35s cubic-bezier(.2,.9,.3,1.2) both; }
    .pf-lift { transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
    .pf-lift:hover { transform: translateY(-2px); }
    .pf-lift:active { transform: scale(.97); }
    .pf-rise { animation: pf-rise .6s cubic-bezier(.2,.8,.2,1) both; }
    .pf-pop { animation: pf-pop .5s cubic-bezier(.2,.9,.3,1.2) both; }
    .pf-shimmer {
      background-image: linear-gradient(110deg, transparent 30%, rgba(255,255,255,.18) 50%, transparent 70%);
      background-size: 200% 100%; animation: pf-shimmer 2.4s linear infinite;
    }
    @media (prefers-reduced-motion: reduce) {
      .pf-rise, .pf-pop, .pf-shimmer { animation: none !important; }
      [data-pf-anim] { animation: none !important; transition: none !important; }
      .pf-sheet, .pf-fade, .pf-check { animation: none !important; }
    }
  `}</style>
);

export const useCountUp = (target: number, duration = 1200, delay = 0): number => {
  const [value, setValue] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setValue(target); return; }
    let start: number | null = null;
    const timer = setTimeout(() => {
      const step = (ts: number) => {
        if (start === null) start = ts;
        const p = Math.min(1, (ts - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        setValue(target * eased);
        if (p < 1) raf.current = requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
    }, delay);
    return () => { clearTimeout(timer); if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, duration, delay]);
  return value;
};

export const CountUp: React.FC<{ value: number; duration?: number; delay?: number; suffix?: string; decimals?: number }> = ({
  value, duration = 1200, delay = 0, suffix = '', decimals = 0
}) => {
  const v = useCountUp(value, duration, delay);
  return <>{v.toFixed(decimals)}{suffix}</>;
};

export const Ring: React.FC<{
  value: number; // 0-100
  size?: number;
  stroke?: number;
  color: string;
  track?: string;
  delay?: number;
  children?: React.ReactNode;
}> = ({ value, size = 180, stroke = 12, color, track = 'rgba(255,255,255,0.07)', delay = 150, children }) => {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), delay); return () => clearTimeout(t); }, [delay]);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - (on ? Math.max(0, Math.min(100, value)) : 0) / 100);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" style={{ overflow: "visible" }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          data-pf-anim
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}
          style={{ transition: 'stroke-dashoffset 1.4s cubic-bezier(.2,.8,.2,1)', filter: `drop-shadow(0 0 8px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
};

export const Confetti: React.FC<{ count?: number; colors?: string[] }> = ({
  count = 46, colors = ['#22d3ee', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c']
}) => {
  const pieces = useMemo(
    () => Array.from({ length: count }, (_, i) => {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const dist = 120 + Math.random() * 220;
      return {
        id: i,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist * 0.8 - 40,
        rot: (Math.random() - 0.5) * 720,
        color: colors[i % colors.length],
        delay: Math.random() * 0.25,
        dur: 1.4 + Math.random() * 1.1,
        w: 5 + Math.random() * 5,
        h: 8 + Math.random() * 7
      };
    }),
    [count] // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute left-1/2 top-[34%]">
        {pieces.map((p) => (
          <span
            key={p.id}
            data-pf-anim
            style={{
              position: 'absolute', width: p.w, height: p.h, background: p.color, borderRadius: 2, opacity: 0,
              ['--dx' as any]: `${p.dx}px`, ['--dy' as any]: `${p.dy}px`, ['--rot' as any]: `${p.rot}deg`,
              animation: `pf-confetti ${p.dur}s cubic-bezier(.15,.7,.3,1) ${p.delay}s forwards`
            }}
          />
        ))}
      </div>
    </div>
  );
};

const ECG_PTS: Array<[number, number]> = [[0, 20], [10, 20], [14, 8], [18, 32], [22, 3], [26, 20], [36, 20], [40, 15], [44, 25], [48, 20], [60, 20]];
const ECG_PATH = (() => {
  const parts: string[] = [];
  for (let i = 0; i < 16; i++) ECG_PTS.forEach(([x, y], j) => parts.push(`${i === 0 && j === 0 ? 'M' : 'L'}${x + i * 60},${y}`));
  return parts.join(' ');
})();

export const EcgLine: React.FC<{ color: string; seconds?: number; height?: number }> = ({ color, seconds = 3, height = 40 }) => (
  <div className="overflow-hidden w-full" style={{ height }} aria-hidden="true">
    <svg data-pf-anim width="1920" height={height} viewBox="0 0 960 40" preserveAspectRatio="none"
      style={{ animation: `pf-ecg ${seconds}s linear infinite`, filter: `drop-shadow(0 0 5px ${color})` }}>
      <path d={ECG_PATH} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  </div>
);

export const tierFor = (pct: number) =>
  pct >= 80 ? { key: 'excellent', color: '#34d399', soft: 'rgba(52,211,153,.14)', label: 'Excellent', emoji: '🏆' }
  : pct >= 65 ? { key: 'pass', color: '#22d3ee', soft: 'rgba(34,211,238,.14)', label: 'Solid pass', emoji: '🎯' }
  : pct >= 50 ? { key: 'warn', color: '#fbbf24', soft: 'rgba(251,191,36,.14)', label: 'Getting there', emoji: '💪' }
  : { key: 'low', color: '#fb7185', soft: 'rgba(251,113,133,.14)', label: 'Needs review', emoji: '📚' };

export const formatDuration = (sec: number): string => {
  if (!sec || sec < 1) return '0s';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};
