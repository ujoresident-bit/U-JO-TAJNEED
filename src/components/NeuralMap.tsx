import React, { useEffect, useMemo, useRef } from 'react';

// The home page hero: a 3D neural network where every node is one subject
// (Major) of the student's exam bank. A node glows in proportion to the
// student's real accuracy in that subject; subjects that were not answered
// yet stay dim. Edges light up between two answered subjects and small
// pulses travel along them. Everything is drawn on two <canvas> elements
// (no extra libraries), runs at ~30fps, pauses when off-screen or hidden and
// renders one still frame when the device asks for reduced motion.

export interface NeuralNode {
  id: string;
  label: string;
  pct: number | null; // null = no answers yet
  total: number; // answered questions in this subject
}

interface NeuralMapProps {
  nodes: NeuralNode[];
  // true when the user has no access: dim, unlabeled network, no numbers.
  decorative?: boolean;
  // 1 = full opening sequence, <1 = shorter replay (e.g. 0.4).
  timeScale?: number;
  onSelect?: (node: NeuralNode | null) => void;
  className?: string;
}

interface Geo {
  x: number; y: number; z: number;
  ox: number; oy: number; oz: number; // scattered start position for the opening
  dl: number; // assembly delay 0..0.42
  d: number; // distance from centre (0..1) drives the ignition wave
  s: number; // size
  k: number; // random phase
  nodeIndex: number; // -1 for dust
}

const hashStr = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

const mulberry = (a: number) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const BEAT = 1.0;
const g = (p: number, c: number, w: number, a: number) => { const d = (p - c) / w; return a * Math.exp(-d * d); };
const ecg = (p: number) => g(p, .12, .03, .14) + g(p, .27, .008, -.16) + g(p, .30, .010, 1) + g(p, .33, .010, -.3) + g(p, .56, .05, .26);

const buildGeometry = (ids: string[], lowPower: boolean) => {
  const seed = hashStr(ids.join('|') || 'ujo');
  const r = mulberry(seed);
  const rx = 1.15, ry = 0.85, rz = 0.9;
  const N = ids.length;
  const pos: { x: number; y: number; z: number }[] = [];
  let dmin2 = Math.pow(0.36, 2);
  let tries = 0;
  while (pos.length < N && tries < 60000) {
    tries++;
    if (tries % 1500 === 0) dmin2 *= 0.86; // relax spacing if the bank has many subjects
    const x = (r() * 2 - 1) * rx, y = (r() * 2 - 1) * ry, z = (r() * 2 - 1) * rz;
    if ((x * x) / (rx * rx) + (y * y) / (ry * ry) + (z * z) / (rz * rz) > 1) continue;
    let ok = true;
    for (const q of pos) {
      if ((q.x - x) ** 2 + (q.y - y) ** 2 + (q.z - z) ** 2 < dmin2) { ok = false; break; }
    }
    if (ok) pos.push({ x, y, z });
  }
  const scatter = () => {
    const th = r() * 6.283, ph = Math.acos(r() * 2 - 1), R = 2.4 + r() * 3.2;
    return { ox: R * Math.sin(ph) * Math.cos(th), oy: R * Math.sin(ph) * Math.sin(th), oz: R * Math.cos(ph) };
  };
  const geo: Geo[] = [];
  pos.forEach((p, i) => {
    geo.push({ ...p, ...scatter(), dl: r() * 0.42, d: Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) / 1.2, s: 1.5 + r() * 0.9, k: r(), nodeIndex: i });
  });
  const nodeCount = geo.length;
  const dust = lowPower ? 170 : 300;
  for (let f = 0; f < dust; f++) {
    const x = (r() * 2 - 1) * 1.2, y = (r() * 2 - 1) * 0.9, z = (r() * 2 - 1) * 0.95;
    if ((x * x) / 1.5 + (y * y) / 0.8 + (z * z) / 0.9 > 1) { f--; continue; }
    geo.push({ x, y, z, ...scatter(), dl: r() * 0.42, d: Math.sqrt(x * x + y * y + z * z) / 1.2, s: 0.5 + r() * 0.45, k: r(), nodeIndex: -1 });
  }
  const edges: [number, number, number][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < nodeCount; i++) {
    const ds: [number, number][] = [];
    for (let j = 0; j < nodeCount; j++) {
      if (i === j) continue;
      ds.push([(geo[i].x - geo[j].x) ** 2 + (geo[i].y - geo[j].y) ** 2 + (geo[i].z - geo[j].z) ** 2, j]);
    }
    ds.sort((a, b) => a[0] - b[0]);
    for (let c = 0; c < Math.min(3, ds.length); c++) {
      const j = ds[c][1];
      const key = Math.min(i, j) + '_' + Math.max(i, j);
      if (!seen.has(key)) { seen.add(key); edges.push([i, j, r()]); }
    }
  }
  return { geo, nodeCount, edges };
};

export const NeuralMap: React.FC<NeuralMapProps> = ({ nodes, decorative = false, timeScale = 1, onSelect, className = '' }) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);
  const ecgRef = useRef<HTMLCanvasElement>(null);

  // Decorative mode shows an anonymous network of fixed size.
  const effNodes: NeuralNode[] = useMemo(
    () => (decorative ? Array.from({ length: 26 }, (_, i) => ({ id: `d${i}`, label: '', pct: null, total: 0 })) : nodes),
    [decorative, nodes]
  );
  const idKey = effNodes.map((n) => n.id).join('|');

  const lowPower = typeof navigator !== 'undefined' && ((navigator as any).hardwareConcurrency || 8) <= 4;
  const geom = useMemo(() => buildGeometry(effNodes.map((n) => n.id), lowPower), [idKey, lowPower]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mutable state read by the draw loop (avoids re-rendering React per frame).
  const live = useRef({ nodes: effNodes, decorative, selected: -1, scale: timeScale, intro: 0 });
  live.current.nodes = effNodes;
  live.current.decorative = decorative;

  const firstGeom = useRef(true);
  useEffect(() => {
    live.current.intro = performance.now() / 1000;
    // Subjects arrived after the first paint (background question sync):
    // replay a short assembly instead of popping the network into place.
    live.current.scale = firstGeom.current ? timeScale : Math.min(timeScale, 0.5);
    firstGeom.current = false;
  }, [geom, timeScale, decorative]);

  useEffect(() => {
    const stage = stageRef.current, cv = mainRef.current, ec = ecgRef.current;
    if (!stage || !cv || !ec) return;
    const cx = cv.getContext('2d'), ex = ec.getContext('2d');
    if (!cx || !ex) return;

    const reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let W = 0, H = 0, EW = 0, EH = 0, dpr = 1;
    let px = 0, py = 0, tx = 0, ty = 0;
    let running = true, visible = true, last = 0, raf = 0;
    let screen: { x: number; y: number; r: number }[] = [];
    let ptrDown: { x: number; y: number } | null = null;

    const size = () => {
      dpr = Math.min(lowPower ? 1.5 : 2, window.devicePixelRatio || 1);
      const b = cv.getBoundingClientRect(); W = b.width; H = b.height;
      cv.width = Math.max(1, W * dpr); cv.height = Math.max(1, H * dpr); cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const e = ec.getBoundingClientRect(); EW = e.width; EH = e.height;
      ec.width = Math.max(1, EW * dpr); ec.height = Math.max(1, EH * dpr); ex.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const drawEcg = (now: number, T: number, lit: boolean) => {
      ex.clearRect(0, 0, EW, EH);
      const span = 2.8 * BEAT, mid = EH * 0.62;
      const amp = EH * 0.5 * clamp01((T - 0.55) / 0.7);
      const xmax = EW * clamp01(T / 1.2);
      const grad = ex.createLinearGradient(0, 0, EW, 0);
      grad.addColorStop(0, 'rgba(79,214,236,0)'); grad.addColorStop(0.7, 'rgba(79,214,236,.55)');
      grad.addColorStop(1, lit || T < 2 ? 'rgba(207,239,248,1)' : 'rgba(190,225,240,.35)');
      ex.strokeStyle = grad; ex.lineWidth = 1.6; ex.lineJoin = 'round'; ex.beginPath();
      let headY = mid;
      for (let x = 0; x <= xmax; x += 2) {
        const tt = now - (1 - x / EW) * span;
        const ph = (((tt % BEAT) + BEAT) % BEAT) / BEAT;
        const y = mid - ecg(ph) * amp;
        if (x === 0) ex.moveTo(x, y); else ex.lineTo(x, y);
        headY = y;
      }
      ex.stroke();
      if (lit || T < 2) {
        ex.fillStyle = '#CFEFF8'; ex.beginPath(); ex.arc(xmax - 2, headY, 3, 0, 6.283); ex.fill();
        ex.fillStyle = 'rgba(79,214,236,.25)'; ex.beginPath(); ex.arc(xmax - 2, headY, 8, 0, 6.283); ex.fill();
      }
    };

    const draw = (ts: number) => {
      const L = live.current;
      const now = ts / 1000;
      const k = L.scale;
      const T = reduce ? 99 : Math.max(0, now - L.intro) / k; // normalised to the full-length timeline
      const asm = reduce ? 1 : clamp01((T - 0.3) / 1.8);
      const wave = reduce ? 1 : clamp01((T - 1.9) / 1.3);
      const prog = reduce ? 1 : clamp01((T - 2.0) / 1.9);
      const e = prog >= 1 ? 1 : 1 - Math.pow(2, -10 * prog);
      const el = !L.decorative;
      px += (tx - px) * 0.06; py += (ty - py) * 0.06;
      const ph = (now % BEAT) / BEAT;
      const breathe = reduce ? 0 : Math.exp(-Math.pow((ph - 0.31) / 0.05, 2)) * (el ? 1 : 0.35);
      const dolly = 1 - Math.pow(1 - asm, 3);
      const ang = (reduce ? 0.5 : now * 0.2) + px * 0.55 + (1 - dolly) * 1.9;
      const tilt = py * 0.12 - (1 - dolly) * 0.25;
      const S = Math.min(W, H) * 0.34 * (0.72 + 0.28 * dolly) * (1 + breathe * 0.015);
      const cX = W * 0.52, cY = H * 0.46;
      const ca = Math.cos(ang), sa = Math.sin(ang), ct = Math.cos(tilt), st = Math.sin(tilt);
      const { geo, nodeCount, edges } = geom;

      cx.clearRect(0, 0, W, H);
      const rg = cx.createRadialGradient(cX, cY, 0, cX, cY, S * 1.7);
      rg.addColorStop(0, `rgba(79,214,236,${el ? 0.14 + breathe * 0.06 : 0.05})`); rg.addColorStop(1, 'rgba(79,214,236,0)');
      cx.fillStyle = rg; cx.fillRect(0, 0, W, H);
      cx.strokeStyle = 'rgba(207,239,248,.26)'; cx.lineWidth = 1; cx.beginPath();
      cx.ellipse(W / 2, H * 1.55, W * 1.05, H * 0.95, 0, Math.PI * 1.12, Math.PI * 1.88); cx.stroke();

      // project
      const list: number[] = new Array(geo.length * 6);
      for (let i = 0; i < geo.length; i++) {
        const p = geo[i];
        const u = clamp01((asm - p.dl) / (1 - 0.42)), eu = 1 - Math.pow(1 - u, 3);
        const X = p.x * eu + p.ox * (1 - eu), Y = p.y * eu + p.oy * (1 - eu), Z = p.z * eu + p.oz * (1 - eu);
        const x1 = X * ca + Y * sa, d1 = -X * sa + Y * ca;
        const y1 = Z * ct - d1 * st, d2 = d1 * ct + Z * st;
        const persp = 1 / Math.max(0.3, 1 + d2 * 0.22);
        const o = i * 6;
        list[o] = cX + x1 * S * persp; list[o + 1] = cY - y1 * S * persp; list[o + 2] = d2; list[o + 3] = persp; list[o + 4] = clamp01(u * 3);
      }
      const intensity = (idx: number): number => {
        const n = L.nodes[idx];
        if (!n || n.pct == null || L.decorative) return 0;
        return (n.pct / 100) * e;
      };

      cx.globalCompositeOperation = 'lighter';
      // edges
      cx.lineWidth = 1;
      for (const [a, b, seed] of edges) {
        const ia = a * 6, ib = b * 6;
        const gate = wave * 1.18 > geo[a].d && wave * 1.18 > geo[b].d;
        const inten = Math.min(intensity(a), intensity(b));
        const fa = Math.min(list[ia + 4], list[ib + 4]);
        const depth = clamp01(0.55 - (list[ia + 2] + list[ib + 2]) * 0.25) * fa;
        const lit = el && gate && inten > 0.2;
        cx.strokeStyle = lit ? `rgba(79,214,236,${(0.12 + 0.38 * inten) * depth})` : `rgba(150,185,210,${(0.05 + 0.1 * depth) * fa})`;
        cx.beginPath(); cx.moveTo(list[ia], list[ia + 1]); cx.lineTo(list[ib], list[ib + 1]); cx.stroke();
        if (lit && !reduce) {
          const q = (now * 0.45 + seed) % 1;
          cx.fillStyle = `rgba(207,239,248,${0.85 * depth})`;
          cx.beginPath(); cx.arc(list[ia] + (list[ib] - list[ia]) * q, list[ia + 1] + (list[ib + 1] - list[ia + 1]) * q, 1.6, 0, 6.283); cx.fill();
        }
      }
      // points
      screen = new Array(nodeCount);
      for (let i = 0; i < geo.length; i++) {
        const p = geo[i], o = i * 6;
        const sx = list[o], sy = list[o + 1], dd = list[o + 2], pe = list[o + 3], fa = list[o + 4];
        const near = clamp01(0.5 - dd * 0.55);
        const rad = p.s * pe * (0.8 + near * 0.9);
        if (p.nodeIndex >= 0) {
          const gI = el && wave * 1.18 > p.d ? intensity(p.nodeIndex) : 0;
          const tw = reduce ? 1 : 0.85 + 0.15 * Math.sin(now * 2 + p.k * 9);
          const hr = rad * (2 + gI * 3.4);
          const hg = cx.createRadialGradient(sx, sy, 0, sx, sy, hr);
          hg.addColorStop(0, `rgba(79,214,236,${(0.04 + gI * 0.5 * tw) * fa * (0.4 + near * 0.6)})`); hg.addColorStop(1, 'rgba(79,214,236,0)');
          cx.fillStyle = hg; cx.beginPath(); cx.arc(sx, sy, hr, 0, 6.283); cx.fill();
          cx.fillStyle = gI > 0 ? `rgba(207,239,248,${(0.45 + gI * 0.55) * fa * (0.5 + near * 0.5)})` : `rgba(150,185,210,${(0.25 + near * 0.3) * fa})`;
          cx.beginPath(); cx.arc(sx, sy, rad * (1 + gI * 0.5), 0, 6.283); cx.fill();
          screen[p.nodeIndex] = { x: sx, y: sy, r: rad };
        } else {
          cx.fillStyle = `rgba(150,185,210,${(0.1 + near * 0.28) * fa})`;
          cx.beginPath(); cx.arc(sx, sy, rad * 0.9, 0, 6.283); cx.fill();
        }
      }
      cx.globalCompositeOperation = 'source-over';

      // ignition shockwave
      if (el && wave > 0 && wave < 1) {
        cx.strokeStyle = `rgba(207,239,248,${0.5 * (1 - wave)})`; cx.lineWidth = 1.2;
        cx.beginPath(); cx.arc(cX, cY, wave * Math.min(W, H) * 0.62, 0, 6.283); cx.stroke();
      }

      // selected node: ring + label
      const sel = L.selected;
      if (sel >= 0 && screen[sel] && L.nodes[sel]) {
        const s = screen[sel], n = L.nodes[sel];
        cx.strokeStyle = 'rgba(207,239,248,.9)'; cx.lineWidth = 1.2;
        cx.beginPath(); cx.arc(s.x, s.y, s.r * 2.6 + 4, 0, 6.283); cx.stroke();
        const text = n.pct == null ? `${n.label} · not started` : `${n.label} · ${n.pct}% · ${n.total} answered`;
        cx.font = '500 12px Geist, Inter, system-ui, sans-serif';
        const tw2 = cx.measureText(text).width + 20;
        const bx = Math.min(W - tw2 - 4, Math.max(4, s.x - tw2 / 2)), by = Math.max(4, s.y - s.r * 2.6 - 38);
        cx.fillStyle = 'rgba(4,8,14,.92)'; cx.fillRect(bx, by, tw2, 26);
        cx.strokeStyle = 'rgba(207,239,248,.35)'; cx.strokeRect(bx + 0.5, by + 0.5, tw2 - 1, 25);
        cx.fillStyle = '#E9F0F6'; cx.textBaseline = 'middle'; cx.fillText(text, bx + 10, by + 13);
      }

      drawEcg(reduce ? 0.2 : now, reduce ? 99 : T, el);
    };

    const loop = (ts: number) => {
      raf = 0;
      if (!running || !visible) return;
      if (ts - last >= 30) { last = ts; draw(ts); }
      raf = requestAnimationFrame(loop);
    };
    const kick = () => { if (reduce) { draw(performance.now()); return; } if (!raf && running && visible) raf = requestAnimationFrame(loop); };

    size(); kick();
    const onResize = () => { size(); kick(); };
    window.addEventListener('resize', onResize);
    const onVis = () => { running = !document.hidden; kick(); };
    document.addEventListener('visibilitychange', onVis);
    const io = new IntersectionObserver((en) => { visible = en[0]?.isIntersecting ?? true; kick(); }, { threshold: 0.05 });
    io.observe(stage);

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerType !== 'mouse') return;
      const b = stage.getBoundingClientRect();
      tx = ((ev.clientX - b.left) / b.width) * 2 - 1; ty = ((ev.clientY - b.top) / b.height) * 2 - 1;
    };
    const onLeave = () => { tx = 0; ty = 0; };
    const onDown = (ev: PointerEvent) => { ptrDown = { x: ev.clientX, y: ev.clientY }; };
    const onUp = (ev: PointerEvent) => {
      if (!ptrDown) return;
      const moved = Math.hypot(ev.clientX - ptrDown.x, ev.clientY - ptrDown.y);
      ptrDown = null;
      if (moved > 8 || live.current.decorative) return;
      const b = cv.getBoundingClientRect();
      const x = ev.clientX - b.left, y = ev.clientY - b.top;
      let best = -1, bd = 26 * 26;
      screen.forEach((s, i) => { if (!s) return; const d = (s.x - x) ** 2 + (s.y - y) ** 2; if (d < bd) { bd = d; best = i; } });
      live.current.selected = best === live.current.selected ? -1 : best;
      onSelect?.(live.current.selected >= 0 ? live.current.nodes[live.current.selected] : null);
      if (reduce) draw(performance.now());
    };
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerleave', onLeave);
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointerup', onUp);

    return () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      io.disconnect();
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointerup', onUp);
    };
  }, [geom, lowPower, onSelect]);

  return (
    <div className={className}>
      <div ref={stageRef} className="relative w-full h-[min(92vw,400px)] lg:h-[480px]" style={{ touchAction: 'pan-y' }}>
        <canvas
          ref={mainRef}
          className="absolute inset-0 w-full h-full block"
          role="img"
          aria-label={decorative ? 'Decorative network of connected points' : 'A three-dimensional network of your exam subjects. Brighter nodes are subjects where your accuracy is higher.'}
        />
      </div>
      <canvas ref={ecgRef} className="block w-full" style={{ height: 54 }} aria-hidden="true" />
    </div>
  );
};
