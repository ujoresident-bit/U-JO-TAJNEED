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

// Interstellar-inspired: deep space starfield, a single distant "star"
// the camera slowly pushes toward, and a minimalist wide-tracked title
// card reveal — non-skippable, plays fully on every fresh login (no
// sessionStorage persistence).
export const CinematicIntro: React.FC<CinematicIntroProps> = ({ onComplete }) => {
  const [stage, setStage] = useState<0 | 1 | 2 | 3 | 4>(0);
  const stars = useMemo(() => generateStars(140), []);

  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 100);   // starfield fades in
    const t2 = setTimeout(() => setStage(2), 1100);  // central star ignites
    const t3 = setTimeout(() => setStage(3), 2400);  // title reveals
    const t4 = setTimeout(() => setStage(4), 4400);  // whole scene fades out
    const t5 = setTimeout(() => onComplete(), 5100);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-[9999] bg-black overflow-hidden transition-opacity duration-1000 ${
        stage === 4 ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <style>{`
        @keyframes ujo-twinkle {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 1; }
        }
        @keyframes ujo-star-pulse {
          0%, 100% { transform: scale(1); opacity: 0.9; }
          50% { transform: scale(1.15); opacity: 1; }
        }
        @keyframes ujo-ring-expand {
          0% { transform: scale(0.8); opacity: 0; }
          60% { opacity: 0.5; }
          100% { transform: scale(2.6); opacity: 0; }
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

      {/* Central distant star / wormhole glow the "camera" approaches */}
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-[1400ms] ease-out ${
          stage >= 2 ? 'opacity-100' : 'opacity-0 scale-50'
        }`}
      >
        {/* Expanding rings */}
        {stage >= 2 && (
          <>
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full border border-amber-200/30"
              style={{ animation: 'ujo-ring-expand 3.5s ease-out infinite' }}
            />
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full border border-cyan-200/20"
              style={{ animation: 'ujo-ring-expand 3.5s ease-out 1.2s infinite' }}
            />
          </>
        )}
        {/* Core glow */}
        <div
          className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-100 via-amber-300 to-cyan-200 shadow-[0_0_60px_20px_rgba(252,211,150,0.5)]"
          style={{ animation: stage >= 2 ? 'ujo-star-pulse 2.8s ease-in-out infinite' : 'none' }}
        />
      </div>

      {/* Title card — wide letter-spacing, thin weight, slow fade+rise */}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center gap-4 transition-all duration-[1600ms] ease-out ${
          stage >= 3 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
        }`}
      >
        <h1 className="text-white text-2xl sm:text-4xl font-thin tracking-[0.35em] sm:tracking-[0.5em] uppercase pl-[0.35em] sm:pl-[0.5em]">
          U JO <span className="font-semibold">TAJNEED</span>
        </h1>
        <div
          className={`h-px bg-gradient-to-r from-transparent via-slate-400 to-transparent transition-all duration-[1400ms] ease-out ${
            stage >= 3 ? 'w-56 sm:w-72 opacity-60' : 'w-0 opacity-0'
          }`}
        />
        <p className="text-slate-400 text-[10px] sm:text-xs font-light tracking-[0.3em] sm:tracking-[0.4em] uppercase pl-[0.3em] sm:pl-[0.4em]">
          Medical Services Exam Prep Platform
        </p>
      </div>
    </div>
  );
};
