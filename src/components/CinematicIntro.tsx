import React, { useEffect, useState } from 'react';
import { Stethoscope } from 'lucide-react';

interface CinematicIntroProps {
  onComplete: () => void;
}

// Non-skippable cinematic splash shown once per fresh login (no
// sessionStorage persistence — matches the exact behavior established for
// U JO Resident's own intro). No click handler on purpose: the sequence
// always plays fully so it reads as a deliberate brand moment, not a
// loading spinner the user can dismiss early.
export const CinematicIntro: React.FC<CinematicIntroProps> = ({ onComplete }) => {
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 200);
    const t2 = setTimeout(() => setStage(2), 1400);
    const t3 = setTimeout(() => setStage(3), 2600);
    const t4 = setTimeout(() => onComplete(), 3400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-[9999] bg-slate-950 flex flex-col items-center justify-center transition-opacity duration-700 ${
        stage === 3 ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-cyan-500/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-1/4 right-1/3 w-[400px] h-[400px] bg-amber-500/10 blur-[120px] rounded-full" />
      </div>

      <div
        className={`relative flex flex-col items-center gap-5 transition-all duration-700 ${
          stage >= 1 ? 'opacity-100 scale-100' : 'opacity-0 scale-90'
        }`}
      >
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-cyan-500/30 blur-2xl animate-pulse" />
          <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-cyan-500 to-cyan-700 flex items-center justify-center shadow-2xl shadow-cyan-500/40">
            <Stethoscope className="w-10 h-10 text-slate-950" />
          </div>
        </div>

        <div
          className={`flex flex-col items-center gap-1 transition-all duration-700 delay-200 ${
            stage >= 2 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
          }`}
        >
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight uppercase">
            <span className="neon-text">U JO</span>{' '}
            <span className="text-slate-100">TAJNEED</span>
          </h1>
          <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            Medical Services Exam Prep Platform
          </p>
        </div>
      </div>

      {/* Loading bar */}
      <div
        className={`absolute bottom-16 w-48 h-[3px] rounded-full bg-slate-800 overflow-hidden transition-opacity duration-500 ${
          stage >= 1 ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div
          className="h-full bg-gradient-to-r from-cyan-500 to-amber-500 rounded-full transition-all ease-out"
          style={{
            width: stage >= 2 ? '100%' : '35%',
            transitionDuration: stage >= 2 ? '1200ms' : '1400ms'
          }}
        />
      </div>
    </div>
  );
};
