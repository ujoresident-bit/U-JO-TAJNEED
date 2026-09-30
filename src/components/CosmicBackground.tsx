import React, { useEffect, useMemo, useState } from 'react';

// Full-viewport starfield background, rendered as a sibling of the app's
// width-constrained <main> content (not nested inside it) so it can use
// `fixed` positioning and genuinely cover the entire screen edge-to-edge,
// unconstrained by the content column's max-width or by any ancestor's
// transform (like the page-transition wrapper, which would otherwise
// break `fixed` positioning if this lived inside it).
const generateStars = (count: number, seedBase: number, sizeRange: [number, number]) => {
  const stars: { x: number; y: number; size: number; delay: number; duration: number }[] = [];
  let seed = seedBase;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rand() * 100,
      y: rand() * 100,
      size: rand() * (sizeRange[1] - sizeRange[0]) + sizeRange[0],
      delay: rand() * 5,
      duration: rand() * 3 + 2.5
    });
  }
  return stars;
};

const generateShootingStars = (count: number) => {
  const arr: { top: number; left: number; delay: number; duration: number }[] = [];
  let seed = 99;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < count; i++) {
    arr.push({
      top: rand() * 50,
      left: rand() * 60 + 10,
      delay: rand() * 18 + i * 6,
      duration: 1.4 + rand() * 0.6
    });
  }
  return arr;
};

export const CosmicBackground: React.FC = () => {
  const farStars = useMemo(() => generateStars(70, 7, [1.5, 3]), []);
  const nearStars = useMemo(() => generateStars(45, 31, [2.5, 4.5]), []);
  const shootingStars = useMemo(() => generateShootingStars(3), []);
  const [mouse, setMouse] = useState({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      setMouse({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    };
    window.addEventListener('mousemove', handleMove);
    return () => window.removeEventListener('mousemove', handleMove);
  }, []);

  const parallaxFar = { transform: `translate(${(mouse.x - 0.5) * -8}px, ${(mouse.y - 0.5) * -8}px)` };
  const parallaxNear = { transform: `translate(${(mouse.x - 0.5) * -18}px, ${(mouse.y - 0.5) * -18}px)` };
  const parallaxGlowA = { transform: `translate(${(mouse.x - 0.5) * 24}px, ${(mouse.y - 0.5) * 24}px)` };
  const parallaxGlowB = { transform: `translate(${(mouse.x - 0.5) * -20}px, ${(mouse.y - 0.5) * -20}px)` };

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden bg-black">
      <style>{`
        @keyframes ujo-home-twinkle {
          0%, 100% { opacity: 0.1; }
          50% { opacity: 0.9; }
        }
        @keyframes ujo-shooting-star {
          0% { transform: translate(0, 0) scale(0.4); opacity: 0; }
          5% { opacity: 1; }
          15% { opacity: 1; }
          25% { transform: translate(280px, 140px) scale(1); opacity: 0; }
          100% { transform: translate(280px, 140px) scale(1); opacity: 0; }
        }
      `}</style>

      <div style={parallaxFar} className="absolute inset-0 transition-transform duration-300 ease-out">
        {farStars.map((star, i) => (
          <div
            key={`far-${i}`}
            className="absolute rounded-full bg-white"
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: `${star.size}px`,
              height: `${star.size}px`,
              animation: `ujo-home-twinkle ${star.duration}s ease-in-out ${star.delay}s infinite`
            }}
          />
        ))}
      </div>
      <div style={parallaxNear} className="absolute inset-0 transition-transform duration-200 ease-out">
        {nearStars.map((star, i) => (
          <div
            key={`near-${i}`}
            className="absolute rounded-full bg-white"
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: `${star.size}px`,
              height: `${star.size}px`,
              boxShadow: `0 0 ${star.size * 2}px rgba(255,255,255,0.5)`,
              animation: `ujo-home-twinkle ${star.duration}s ease-in-out ${star.delay}s infinite`
            }}
          />
        ))}
      </div>

      {shootingStars.map((s, i) => (
        <div
          key={`shoot-${i}`}
          className="absolute w-24 h-px bg-gradient-to-r from-white to-transparent"
          style={{
            top: `${s.top}%`,
            left: `${s.left}%`,
            animation: `ujo-shooting-star ${s.duration}s ease-in ${s.delay}s infinite`
          }}
        />
      ))}

      <div style={parallaxGlowA} className="absolute top-0 left-1/4 w-[550px] h-[550px] bg-cyan-500/[0.05] blur-[150px] rounded-full transition-transform duration-500 ease-out" />
      <div style={parallaxGlowB} className="absolute bottom-0 right-1/4 w-[550px] h-[550px] bg-amber-500/[0.05] blur-[150px] rounded-full transition-transform duration-500 ease-out" />
    </div>
  );
};
