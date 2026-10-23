import React, { useEffect, useRef } from 'react';

// Free-floating 3D constellation of majors. Each bright hub is a major; tap a hub to toggle it,
// drag to rotate. Pure Canvas 2D (no libraries), ~30fps, paused when off-screen / tab hidden.

interface MajorsMapProps {
  majors: { name: string; count: number }[];
  selected: string[]; // real selected major names (empty = all)
  onToggle: (name: string) => void;
}

const MajorsMap: React.FC<MajorsMapProps> = ({ majors, selected, onToggle }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const selRef = useRef<string[]>(selected);
  const toggleRef = useRef(onToggle);
  selRef.current = selected;
  toggleRef.current = onToggle;
  const majorsRef = useRef(majors);
  majorsRef.current = majors;
  const key = majors.map((m) => m.name).join('|');

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv || majors.length === 0) return;
    const cx = cv.getContext('2d');
    if (!cx) return;

    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lowPower = (navigator.hardwareConcurrency || 8) <= 4;
    let W = 0, H = 0, dpr = 1;
    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = cv.getBoundingClientRect();
      W = r.width; H = r.height;
      cv.width = Math.max(1, Math.round(W * dpr));
      cv.height = Math.max(1, Math.round(H * dpr));
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();

    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const NH = majors.length;
    const hubs: any[] = [], subs: any[] = [], links: number[][] = [], ties: number[][] = [];
    for (let i = 0; i < NH; i++) {
      const y = 1 - ((i + 0.5) / NH) * 2, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.399963 + rnd() * 0.25;
      hubs.push({ n: majors[i].name, c: 0, x: Math.cos(a) * r, y: y * 0.92, z: Math.sin(a) * r, sx: (rnd() - 0.5) * 5, sy: (rnd() - 0.5) * 5, sz: (rnd() - 0.5) * 5 });
    }
    const perHub = Math.max(4, Math.round((lowPower ? 90 : 190) / NH));
    hubs.forEach((h, hi) => {
      const n = perHub + Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) {
        const u = rnd() * 2 - 1, a = rnd() * 6.283, rr = Math.sqrt(1 - u * u), d = 0.12 + rnd() * 0.3;
        subs.push({ h: hi, x: h.x + Math.cos(a) * rr * d, y: h.y + u * d, z: h.z + Math.sin(a) * rr * d, sx: (rnd() - 0.5) * 6, sy: (rnd() - 0.5) * 6, sz: (rnd() - 0.5) * 6, ph: rnd() * 6.28, s: 0.6 + rnd() * 0.9 });
      }
    });
    subs.forEach((a, i) => {
      links.push([i, -1, a.h]);
      let best = -1, bd = 9;
      subs.forEach((b, j) => {
        if (j > i && b.h === a.h) {
          const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
          if (d < bd) { bd = d; best = j; }
        }
      });
      if (best > -1 && rnd() < 0.7) links.push([i, best, -1]);
    });
    hubs.forEach((a, i) => {
      const d = hubs.map((b, j) => [j, (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2]).filter((x) => x[0] !== i).sort((p, q) => p[1] - q[1]).slice(0, 3);
      d.forEach((x) => {
        if (!ties.some((e) => (e[0] === i && e[1] === x[0]) || (e[1] === i && e[0] === x[0]))) ties.push([i, x[0]]);
      });
    });
    const pulses = ties.map((_, i) => ({ t: i, u: rnd(), v: 0.12 + rnd() * 0.14, dir: rnd() < 0.5 ? 1 : -1 }));
    const dust: any[] = [];
    const dustN = lowPower ? 80 : 170;
    for (let k = 0; k < dustN; k++) {
      const u = rnd() * 2 - 1, a = rnd() * 6.283, rr = Math.sqrt(1 - u * u), s = 0.6 + rnd() * 1.1;
      dust.push({ x: Math.cos(a) * rr * s, y: u * s, z: Math.sin(a) * rr * s, ph: rnd() * 6.28 });
    }

    const rot = { y: 0.6, x: -0.28, vy: 0.09 };
    let last = 0, T0 = 0, running = false, raf = 0, lastDraw = 0;
    let shocks: { n: string; t: number }[] = [];
    let prevSel: string[] = selRef.current.slice();
    let drag: { x: number; y: number } | null = null, moved = 0, hover = -1;
    let proj: any[] = [];

    const ease = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
    const P = (p: any, asm: number, sc: number) => {
      const q = ease(asm), x = p.x + (p.sx || 0) * (1 - q), y = p.y + (p.sy || 0) * (1 - q), z = p.z + (p.sz || 0) * (1 - q);
      const cy = Math.cos(rot.y), sy = Math.sin(rot.y), cxr = Math.cos(rot.x), sxr = Math.sin(rot.x);
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy, y2 = y * cxr - z1 * sxr, z2 = y * sxr + z1 * cxr;
      const k = Math.max(0.35, 1 + z2 * 0.28);
      return { x: W / 2 + x1 * sc * k, y: H / 2 + y2 * sc * k, z: z2, k };
    };
    const isSel = (i: number) => selRef.current.indexOf(hubs[i].n) > -1;
    const arcPt = (a: any, b: any, u: number, lift: number) => {
      const x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u, z = a.z + (b.z - a.z) * u;
      const m = Math.sqrt(x * x + y * y + z * z) || 1, l = 1 + lift * Math.sin(u * Math.PI), f = Math.min(m * l, 1.25);
      return { x: (x / m) * f, y: (y / m) * f, z: (z / m) * f };
    };
    const ring = (rx: number, tilt: number, sc: number, alpha: number, ticks: boolean, spin: number) => {
      cx.save(); cx.translate(W / 2, H / 2);
      cx.strokeStyle = 'rgba(207,239,248,' + alpha + ')'; cx.lineWidth = 1; cx.beginPath();
      const cy = Math.cos(rot.y * spin), sy = Math.sin(rot.y * spin);
      for (let i = 0; i <= 120; i++) {
        const a = (i / 120) * 6.283, x = Math.cos(a) * rx, z = Math.sin(a) * rx;
        const X = x * cy + z * sy, Z = -x * sy + z * cy, Y = Z * Math.sin(tilt + rot.x);
        i ? cx.lineTo(X * sc, Y * sc) : cx.moveTo(X * sc, Y * sc);
      }
      cx.stroke();
      if (ticks) {
        cx.fillStyle = '#CFEFF8';
        for (let i = 0; i < 72; i++) {
          const a = (i / 72) * 6.283, x = Math.cos(a) * rx, z = Math.sin(a) * rx;
          const X = x * cy + z * sy, Z = -x * sy + z * cy, Y = Z * Math.sin(tilt + rot.x);
          const len = i % 6 === 0 ? 7 : 3.5;
          cx.globalAlpha = 0.25 + (0.35 * (Z * Math.cos(tilt + rot.x) + 1)) / 2;
          cx.fillRect(X * sc - 0.5, Y * sc - len / 2, 1, len);
        }
        cx.globalAlpha = 1;
      }
      cx.restore();
    };

    const draw = (t: number, T: number, dt: number) => {
      const asm = reduce ? 1 : T / 2.4;
      const sel = selRef.current;
      if (!drag) {
        rot.y += rot.vy * dt;
        rot.vy += ((reduce ? 0 : 0.09) - rot.vy) * Math.min(1, dt * 0.6);
        rot.x += (-0.28 - rot.x) * Math.min(1, dt * 0.8);
      }
      cx.clearRect(0, 0, W, H);
      const sc = Math.min(W * 0.36, H * 0.42);
      sel.forEach((n) => { if (prevSel.indexOf(n) < 0) shocks.push({ n, t: T }); });
      prevSel = sel.slice();
      ring(1.18, Math.PI / 2, sc, 0.1, true, 0.4); ring(1.3, 0.5, sc, 0.07, false, -0.25); ring(1.05, -0.65, sc, 0.06, false, 0.2);
      const HP = hubs.map((h, i) => P(h, asm - i * 0.02, sc));
      const SP = subs.map((s, i) => P(s, asm - 0.1 - (i % 9) * 0.012, sc));
      proj = HP;
      cx.fillStyle = '#CFEFF8';
      dust.forEach((d) => {
        const p = P({ x: d.x * 1.15, y: d.y * 1.15, z: d.z * 1.15 }, 1, sc);
        const tw = 0.5 + 0.5 * Math.sin(T * 1.3 + d.ph);
        cx.globalAlpha = (0.12 + (0.3 * (p.z + 1)) / 2) * tw;
        cx.beginPath(); cx.arc(p.x, p.y, 0.8 * p.k, 0, 7); cx.fill();
      });
      cx.globalAlpha = 1;
      const anySel = sel.length > 0;
      cx.lineWidth = 0.7;
      links.forEach((l) => {
        const a = SP[l[0]], b = l[1] > -1 ? SP[l[1]] : HP[l[2]], hi = l[1] > -1 ? subs[l[0]].h : l[2], on = isSel(hi);
        const al = ((a.z + b.z) / 2 + 1.4) / 2.8;
        cx.strokeStyle = on ? 'rgba(79,214,236,' + (0.18 + al * 0.5) + ')' : 'rgba(147,163,182,' + (anySel ? 0.05 : 0.1) * (0.4 + al) + ')';
        cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.stroke();
      });
      ties.forEach((e) => {
        const a = hubs[e[0]], b = hubs[e[1]], on = isSel(e[0]) && isSel(e[1]), half = isSel(e[0]) || isSel(e[1]);
        cx.beginPath();
        for (let i = 0; i <= 18; i++) { const p = P(arcPt(a, b, i / 18, 0.16), asm, sc); i ? cx.lineTo(p.x, p.y) : cx.moveTo(p.x, p.y); }
        cx.strokeStyle = on ? 'rgba(207,239,248,.85)' : half ? 'rgba(79,214,236,.5)' : 'rgba(207,239,248,' + (anySel ? 0.09 : 0.2) + ')';
        cx.lineWidth = on ? 1.8 : 1;
                cx.stroke();
      });
      const selIdx: number[] = [];
      hubs.forEach((_, i) => { if (isSel(i)) selIdx.push(i); });
      for (let i = 0; i < selIdx.length - 1; i++) {
        const a = hubs[selIdx[i]], b = hubs[selIdx[i + 1]];
        cx.beginPath();
        for (let j = 0; j <= 24; j++) { const p = P(arcPt(a, b, j / 24, 0.3), 1, sc); j ? cx.lineTo(p.x, p.y) : cx.moveTo(p.x, p.y); }
        cx.strokeStyle = 'rgba(207,239,248,.55)'; cx.setLineDash([3, 5]); cx.lineDashOffset = -T * 14; cx.lineWidth = 1.2; cx.stroke(); cx.setLineDash([]);
      }
      pulses.forEach((pl) => {
        const e = ties[pl.t], on = isSel(e[0]) || isSel(e[1]);
        pl.u += dt * pl.v * (on ? 2.4 : 1) * pl.dir;
        if (pl.u > 1) pl.u -= 1;
        if (pl.u < 0) pl.u += 1;
        if (anySel && !on) return;
        const p = P(arcPt(hubs[e[0]], hubs[e[1]], pl.u, 0.16), 1, sc);
        const g = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 9);
        g.addColorStop(0, on ? 'rgba(255,255,255,.95)' : 'rgba(207,239,248,.8)'); g.addColorStop(1, 'rgba(79,214,236,0)');
        cx.fillStyle = g; cx.beginPath(); cx.arc(p.x, p.y, 9, 0, 7); cx.fill();
      });
      subs.forEach((s, i) => {
        const p = SP[i], on = isSel(s.h), tw = 0.6 + 0.4 * Math.sin(T * 2 + s.ph);
        const al = (0.18 + (0.5 * (p.z + 1)) / 2) * (anySel && !on ? 0.4 : 1);
        cx.fillStyle = on ? 'rgba(207,239,248,' + (al + 0.25) * tw + ')' : 'rgba(147,163,182,' + al + ')';
        cx.beginPath(); cx.arc(p.x, p.y, (on ? 1.9 : 1.3) * s.s * p.k, 0, 7); cx.fill();
      });
      const order = HP.map((_, i) => i).sort((a, b) => HP[a].z - HP[b].z);
      order.forEach((i) => {
        const p = HP[i], on = isSel(i), depth = (p.z + 1.3) / 2.6, r = (on ? 6.5 : 4) * p.k;
        const halo = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * (on ? 7 : 4));
        halo.addColorStop(0, 'rgba(79,214,236,' + (on ? 0.5 : 0.18 * (anySel ? 0.5 : 1)) + ')'); halo.addColorStop(1, 'rgba(79,214,236,0)');
        cx.fillStyle = halo; cx.beginPath(); cx.arc(p.x, p.y, r * (on ? 7 : 4), 0, 7); cx.fill();
        cx.fillStyle = on ? '#FFFFFF' : 'rgba(207,239,248,' + (0.45 + 0.5 * depth) * (anySel ? 0.7 : 1) + ')';
                cx.beginPath(); cx.arc(p.x, p.y, r, 0, 7); cx.fill();
        cx.strokeStyle = 'rgba(207,239,248,' + (on ? 0.9 : 0.35 * depth) + ')'; cx.lineWidth = 1;
        cx.beginPath(); cx.arc(p.x, p.y, r + 3.5, 0, 7); cx.stroke();
        if (on || i === hover) {
          cx.font = "500 11.5px Geist,system-ui,sans-serif";
          const rt = (p.x > W / 2 && p.x < W - 120) || p.x < 120;
          cx.textAlign = rt ? 'left' : 'right';
          const lx = p.x + (rt ? r + 16 : -r - 16);
          cx.strokeStyle = 'rgba(207,239,248,.4)'; cx.beginPath(); cx.moveTo(p.x + (rt ? r + 4 : -r - 4), p.y); cx.lineTo(lx + (rt ? -4 : 4), p.y); cx.stroke();
          cx.fillStyle = '#EAF1F7'; cx.fillText(hubs[i].n, lx, p.y + 4);
          cx.fillStyle = '#93A3B6'; cx.font = "500 9.5px 'Geist Mono',ui-monospace,monospace"; cx.fillText(String(majorsRef.current[i]?.count ?? 0), lx, p.y + 17);
        }
      });
      shocks = shocks.filter((s) => T - s.t < 1.6);
      shocks.forEach((s) => {
        const i = hubs.findIndex((h) => h.n === s.n); if (i < 0) return;
        const p = HP[i], k = (T - s.t) / 1.6;
        cx.strokeStyle = 'rgba(79,214,236,' + (1 - k) * 0.8 + ')'; cx.lineWidth = 1.6; cx.beginPath(); cx.arc(p.x, p.y, 8 + k * 70, 0, 7); cx.stroke();
      });
      cx.fillStyle = 'rgba(147,163,182,.8)'; cx.font = "500 9.5px 'Geist Mono',ui-monospace,monospace";
      cx.textAlign = 'left'; cx.fillText(NH + ' MAJORS  ·  ' + subs.length + ' TOPIC NODES', 14, H - 14);
      cx.textAlign = 'right'; cx.fillText(sel.length ? sel.length + ' SELECTED' : 'ALL MAJORS', W - 14, H - 14);
    };

    const frame = (t: number) => {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (t - lastDraw < 32) return; // ~30fps
      lastDraw = t;
      const dt = Math.min(0.06, (t - last) / 1000 || 0);
      last = t;
      draw(t, (t - T0) / 1000, dt);
    };
    const start = () => {
      if (running || reduce) return;
      running = true; last = performance.now(); raf = requestAnimationFrame(frame);
    };
    const stop = () => { running = false; cancelAnimationFrame(raf); };
    T0 = performance.now();
    if (reduce) draw(T0, 99, 0.016);

    let visible = true;
    const sync = () => { if (visible && !document.hidden) start(); else stop(); };
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { visible = es[0].isIntersecting; sync(); }) : null;
    io?.observe(cv);
    const onVis = () => sync();
    document.addEventListener('visibilitychange', onVis);
    const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { size(); if (reduce) draw(T0, 99, 0.016); }) : null;
    ro?.observe(cv);
    sync();

    const pos = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const nearest = (x: number, y: number, lim: number) => {
      let b = -1, bd = lim;
      proj.forEach((p, i) => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; b = i; } });
      return b;
    };
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY }; moved = 0; try { cv.setPointerCapture(e.pointerId); } catch {} };
    const move = (e: PointerEvent) => {
      const { x, y } = pos(e);
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
        rot.y += dx * 0.008; rot.x = Math.max(-0.9, Math.min(0.9, rot.x + dy * 0.006)); rot.vy = dx * 0.02;
        if (reduce) draw(0, 99, 0.016);
      } else { hover = nearest(x, y, 22); }
    };
    const up = (e: PointerEvent) => {
      const { x, y } = pos(e);
      if (drag && moved < 8) { const b = nearest(x, y, 30); if (b > -1) toggleRef.current(hubs[b].n); }
      drag = null;
    };
    const leave = () => { hover = -1; };
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', () => { drag = null; });
    cv.addEventListener('pointerleave', leave);

    return () => {
      stop(); io?.disconnect(); ro?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up); cv.removeEventListener('pointerleave', leave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // re-draw static frame for reduced motion when selection changes
  return (
    <div ref={wrapRef} className="qb-net">
      <canvas ref={cvRef} aria-label="Majors network. Tap a bright point to select that major." style={{ touchAction: 'pan-y' }} />
    </div>
  );
};

export default MajorsMap;
