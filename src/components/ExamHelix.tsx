import React, { useEffect, useRef } from 'react';

export type HelixState = 'ok' | 'bad' | null;

interface Props {
  total: number;
  current: number;
  states: HelixState[];
  flags: boolean[];
  onSelect: (i: number) => void;
}

const C_OK = '111,224,180';
const C_BAD = '255,143,163';
const C_CUR = '79,214,236';
const C_ICE = '207,239,248';
const col = (c: string, a: number) => `rgba(${c},${a})`;

/**
 * Question navigator drawn as a DNA double helix. Static while reading; it
 * only turns after a question change or while the pointer is over it.
 * Vertical on wide screens, horizontal strip on phones.
 */
export const ExamHelix: React.FC<Props> = ({ total, current, states, flags, onSelect }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ total, current, states, flags, onSelect });
  const dirty = useRef(true);
  const act = useRef(0);
  const hover = useRef(false);
  const lastCur = useRef(current);

  live.current = { total, current, states, flags, onSelect };
  useEffect(() => {
    dirty.current = true;
    if (lastCur.current !== current) {
      lastCur.current = current;
      act.current = performance.now() / 1000 + 1.8;
    }
  }, [current, states, flags, total]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0, H = 0, horiz = false, raf = 0, last = 0, lastT = 0;
    let spin = 0, vel = 0, pos = live.current.current, visible = true;
    let hits: { i: number; x: number; y: number }[] = [];

    const size = () => {
      const d = Math.min(window.devicePixelRatio || 1, 2);
      const r = cv.getBoundingClientRect();
      W = r.width; H = r.height; horiz = W > H * 1.4;
      cv.width = Math.max(1, W * d); cv.height = Math.max(1, H * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      dirty.current = true;
    };

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < 24 || W === 0) return;
      last = t;
      const dt = Math.min(0.06, (t - lastT) / 1000 || 0);
      lastT = t;
      const { total: N, current: cur, states: S, flags: F } = live.current;
      const tv = !reduce && (hover.current || performance.now() / 1000 < act.current) ? 0.5 : 0;
      vel += (tv - vel) * Math.min(1, dt * 6);
      spin += vel * dt;
      if (!(vel > 0.015 || Math.abs(cur - pos) > 0.003 || dirty.current)) return;
      dirty.current = false;
      pos += (cur - pos) * 0.14;

      ctx.clearRect(0, 0, W, H);
      hits = [];
      const L = horiz ? W : H, Wd = horiz ? H : W, gap = horiz ? 48 : 42, R = Wd * 0.3, mid = L / 2;
      const pt = (a: number, off: number) => (horiz ? { x: a, y: Wd / 2 + off } : { x: Wd / 2 + off, y: a });
      const phi = (i: number) => (i / 6) * 6.283 + spin;

      for (let pass = 0; pass < 2; pass++) {
        for (let sd = 0; sd < 2; sd++) {
          let prev: { x: number; y: number; z: number } | null = null;
          for (let a = -40; a <= L + 40; a += 3) {
            const ph = phi((a - mid) / gap + pos), c = Math.cos(ph);
            const z = Math.sin(ph) * (sd ? -1 : 1);
            const p = pt(a, R * c * (sd ? -1 : 1));
            if (prev && ((z + prev.z) / 2 >= 0) === (pass === 1)) {
              const zz = (z + 1) / 2;
              ctx.strokeStyle = col(sd ? '180,168,245' : C_CUR, 0.18 + 0.7 * zz);
              ctx.lineWidth = 1 + 2.2 * zz; ctx.lineCap = 'round';
              ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
            }
            prev = { x: p.x, y: p.y, z };
          }
          if (pass === 0 && sd === 1) {
            for (let i = 0; i < N; i++) {
              const a = (i - pos) * gap + mid;
              if (a < -30 || a > L + 30) continue;
              const ph = phi(i), c = Math.cos(ph), z = Math.sin(ph);
              const A = pt(a, R * c), B = pt(a, -R * c);
              const st = S[i], sc = i === cur ? C_CUR : st === 'ok' ? C_OK : st === 'bad' ? C_BAD : null;
              const fade = Math.max(0.15, 1 - Math.abs(a - mid) / (L * 0.55));
              const g = ctx.createLinearGradient(A.x, A.y, B.x, B.y);
              g.addColorStop(0, col(sc || C_ICE, (sc ? 0.9 : 0.3) * fade));
              g.addColorStop(0.5, col(sc || C_ICE, (sc ? 0.7 : 0.2) * fade));
              g.addColorStop(1, col('180,168,245', 0.35 * fade));
              ctx.strokeStyle = g; ctx.lineWidth = 1.6;
              ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
              ([[A, z, sc || C_CUR], [B, -z, '180,168,245']] as const).forEach(([n, zv, cc]) => {
                const zz = (zv + 1) / 2;
                ctx.fillStyle = col(cc, (0.35 + 0.6 * zz) * fade);
                ctx.beginPath(); ctx.arc(n.x, n.y, 2.6 + 2.4 * zz, 0, 7); ctx.fill();
              });
            }
          }
        }
      }

      for (let i = 0; i < N; i++) {
        const a = (i - pos) * gap + mid;
        if (a < -30 || a > L + 30) continue;
        const M = pt(a, 0), st = S[i], isCur = i === cur;
        const fade = Math.max(0.2, 1 - Math.abs(a - mid) / (L * 0.55)), r = isCur ? 14 : 11;
        hits.push({ i, x: M.x, y: M.y });
        if (isCur) {
          const g = ctx.createRadialGradient(M.x, M.y, 0, M.x, M.y, r * 3);
          g.addColorStop(0, col(C_CUR, 0.55)); g.addColorStop(1, col(C_CUR, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(M.x, M.y, r * 3, 0, 7); ctx.fill();
          ctx.fillStyle = '#4FD6EC';
        } else if (st === 'ok') ctx.fillStyle = col('12,48,36', 0.95);
        else if (st === 'bad') ctx.fillStyle = col('52,16,24', 0.95);
        else ctx.fillStyle = col('11,16,22', 0.95);
        ctx.beginPath(); ctx.arc(M.x, M.y, r, 0, 7); ctx.fill();
        if (!isCur) {
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = col(st === 'ok' ? C_OK : st === 'bad' ? C_BAD : C_ICE, st ? 0.9 * fade : 0.28 * fade);
          ctx.beginPath(); ctx.arc(M.x, M.y, r, 0, 7); ctx.stroke();
        }
        ctx.fillStyle = isCur ? '#03131B' : st === 'ok' ? '#8FEAC6' : st === 'bad' ? '#FFA9B8' : col(C_ICE, 0.7 * fade + 0.1);
        ctx.font = `500 ${isCur ? 12 : 10.5}px 'Geist Mono',ui-monospace,monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), M.x, M.y + 0.5);
        if (F[i]) {
          const fx = M.x + r * 0.85, fy = M.y - r * 0.85;
          ctx.fillStyle = '#FF8FA3'; ctx.beginPath(); ctx.arc(fx, fy, 4.2, 0, 7); ctx.fill();
          ctx.strokeStyle = '#0b1016'; ctx.lineWidth = 1.4; ctx.stroke();
        }
      }
    };

    let running = false;
    const sync = () => {
      const want = visible && !document.hidden && cv.getBoundingClientRect().width > 0;
      if (want && !running) { running = true; size(); raf = requestAnimationFrame(frame); }
      else if (!want && running) { running = false; cancelAnimationFrame(raf); }
    };
    const onResize = () => { size(); sync(); };
    const io = 'IntersectionObserver' in window
      ? new IntersectionObserver((e) => { visible = e[0].isIntersecting; sync(); })
      : null;
    io?.observe(cv);
    const ro = 'ResizeObserver' in window ? new ResizeObserver(onResize) : null;
    ro?.observe(cv);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('resize', onResize);
    sync();

    const enter = () => { hover.current = true; };
    const leave = () => { hover.current = false; };
    const click = (e: MouseEvent) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best: number | null = null, bd = 26;
      hits.forEach((h) => { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h.i; } });
      if (best !== null) live.current.onSelect(best);
    };
    cv.addEventListener('pointerenter', enter);
    cv.addEventListener('pointerleave', leave);
    cv.addEventListener('click', click);
    return () => {
      running = false; cancelAnimationFrame(raf);
      io?.disconnect(); ro?.disconnect();
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('resize', onResize);
      cv.removeEventListener('pointerenter', enter);
      cv.removeEventListener('pointerleave', leave);
      cv.removeEventListener('click', click);
    };
  }, []);

  return <canvas ref={ref} className="ex-helix-cv" aria-label="Question navigator" />;
};
