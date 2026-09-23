import React, { useEffect, useMemo, useState } from 'react';

interface CinematicIntroProps {
  onComplete: () => void;
}

// Deterministic pseudo-random starfield — same seed every render so the
// layout doesn't jump/flicker between re-renders during the intro.
const generateStars = (count: number) => {
  const stars: { x: number; y: number; size: number; delay: number; duration: number }[] = [];
  let seed = 42;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rand() * 100,
      y: rand() * 100,
      size: rand() * 1.6 + 0.4,
      delay: rand() * 4,
      duration: rand() * 3 + 2
    });
  }
  return stars;
};

// Interstellar-inspired: deep space starfield with a minimalist wide-tracked
// title card reveal — non-skippable, plays fully on every fresh login (no
// sessionStorage persistence). Total runtime: ~8 seconds.
export const CinematicIntro: React.FC<CinematicIntroProps> = ({ onComplete }) => {
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(0);
  const stars = useMemo(() => generateStars(140), []);

  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 150);   // starfield fades in
    const t2 = setTimeout(() => setStage(2), 2600);  // title reveals
    const t3 = setTimeout(() => setStage(3), 7200);  // whole scene fades out
    const t4 = setTimeout(() => onComplete(), 8000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-[9999] bg-black overflow-hidden transition-opacity duration-1000 ${
        stage === 3 ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <style>{`
        @keyframes ujo-twinkle {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 1; }
        }
        @keyframes ujo-drift {
          from { transform: translateX(0); }
          to { transform: translateX(-40px); }
        }
      `}</style>

      {/* Starfield */}
      <div
        className="absolute inset-0 transition-opacity duration-[1500ms]"
        style={{ opacity: stage >= 1 ? 1 : 0, animation: stage >= 1 ? 'ujo-drift 40s linear infinite alternate' : 'none' }}
      >
        {stars.map((star, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: `${star.size}px`,
              height: `${star.size}px`,
              animation: `ujo-twinkle ${star.duration}s ease-in-out ${star.delay}s infinite`
            }}
          />
        ))}
      </div>

      {/* Title card — wide letter-spacing, thin weight, slow fade+rise */}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center gap-4 transition-all duration-[1800ms] ease-out ${
          stage >= 2 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
        }`}
      >
        <h1 className="text-white text-2xl sm:text-4xl font-thin tracking-[0.35em] sm:tracking-[0.5em] uppercase pl-[0.35em] sm:pl-[0.5em]">
          U JO <span className="font-semibold">TAJNEED</span>
        </h1>
        <div
          className={`h-px bg-gradient-to-r from-transparent via-slate-400 to-transparent transition-all duration-[1800ms] ease-out ${
            stage >= 2 ? 'w-56 sm:w-72 opacity-60' : 'w-0 opacity-0'
          }`}
        />
        <p className="text-slate-400 text-[10px] sm:text-xs font-light tracking-[0.3em] sm:tracking-[0.4em] uppercase pl-[0.3em] sm:pl-[0.4em]">
          Medical Services Exam Prep Platform
        </p>
      </div>
    </div>
  );
};
