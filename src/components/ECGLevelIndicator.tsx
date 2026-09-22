import React, { useMemo } from 'react';

interface ECGLevelIndicatorProps {
  accuracyPercentage: number;
  questionsSolved: number;
  label: string;
  colorTheme?: 'cyan' | 'amber';
}

// A single ECG "heartbeat" waveform repeated across the width — classic
// P-QRS-T shape drawn as one SVG path unit, tiled via a wide viewBox.
const ECG_UNIT = 'M0,20 L8,20 L11,8 L14,32 L17,4 L20,20 L28,20 L31,16 L34,24 L37,20 L48,20';

export const ECGLevelIndicator: React.FC<ECGLevelIndicatorProps> = ({
  accuracyPercentage,
  questionsSolved,
  label,
  colorTheme = 'cyan'
}) => {
  const hasData = questionsSolved > 0;

  // Map accuracy to a performance tier: faster + steadier pulse for higher
  // accuracy, slower + more irregular-looking for lower accuracy. Purely a
  // visual metaphor — the waveform shape itself is always a normal sinus
  // rhythm, only speed/color communicate the level.
  const tier = useMemo(() => {
    if (!hasData) return { name: 'No Data', color: '#64748b', glow: 'rgba(100,116,139,0.3)', duration: 6 };
    if (accuracyPercentage >= 80) return { name: 'Excellent', color: '#34d399', glow: 'rgba(52,211,153,0.5)', duration: 2.2 };
    if (accuracyPercentage >= 60) return { name: 'Good', color: colorTheme === 'amber' ? '#fbbf24' : '#22d3ee', glow: 'rgba(34,211,238,0.4)', duration: 3.2 };
    if (accuracyPercentage >= 40) return { name: 'Needs Work', color: '#fb923c', glow: 'rgba(251,146,60,0.4)', duration: 4.2 };
    return { name: 'Critical', color: '#f87171', glow: 'rgba(248,113,113,0.4)', duration: 5.2 };
  }, [accuracyPercentage, hasData, colorTheme]);

  const animationName = `ecg-scroll-${label.replace(/\s+/g, '-')}`;

  return (
    <div className="relative rounded-2xl bg-slate-950/60 border border-slate-800 p-3 overflow-hidden">
      <style>{`
        @keyframes ${animationName} {
          from { transform: translateX(0); }
          to { transform: translateX(-192px); }
        }
      `}</style>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
        <span
          className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ color: tier.color, backgroundColor: `${tier.color}1a` }}
        >
          {tier.name}
        </span>
      </div>
      <div className="relative h-10 w-full">
        <svg
          viewBox="0 0 192 40"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
          style={{ filter: hasData ? `drop-shadow(0 0 4px ${tier.glow})` : 'none' }}
        >
          <g
            style={{
              animation: hasData ? `${animationName} ${tier.duration}s linear infinite` : 'none'
            }}
          >
            {/* Repeat the waveform unit 4x across a wide strip so the
                scrolling loop is seamless */}
            {[0, 48, 96, 144, 192, 240].map((offset) => (
              <path
                key={offset}
                d={ECG_UNIT}
                transform={`translate(${offset}, 0)`}
                fill="none"
                stroke={tier.color}
                strokeWidth={1.75}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={hasData ? 1 : 0.35}
              />
            ))}
          </g>
        </svg>
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-slate-500">{hasData ? `${questionsSolved} solved` : 'Not started yet'}</span>
        {hasData && <span className="text-[10px] font-bold" style={{ color: tier.color }}>{accuracyPercentage}%</span>}
      </div>
    </div>
  );
};
