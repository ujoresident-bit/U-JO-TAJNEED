import React, { useEffect, useRef, useState } from 'react';

export interface StripItem { s: 'ok' | 'bad' | null; f: boolean }

interface Props {
  items: StripItem[];
  nums?: boolean;
  flagColor?: string;
  onSelect?: (i: number) => void;
  height?: number;
  offset?: number;
  label?: (i: number, it: StripItem) => string;
}

const COL = { ok: '111,224,180', bad: '255,143,163', none: '207,239,248' };

/** Flat, static DNA strip: one pearl per question. Used by the end-block dialog and the results page. */
export const ResultStrip: React.FC<Props> = ({ items, nums, flagColor = '#FF8FA3', onSelect, height = 64, offset = 0, label }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const pts = useRef<{ x: number; y: number; k: number }[]>([]);
  const [tip, setTip] = useState<{ x: number; y: number; t: string } | null>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const draw = () => {
      const d = Math.min(window.devicePixelRatio || 1, 2);
      const r = cv.getBoundingClientRect();
      const W = r.width, H = r.height;
      if (W === 0) return;
      cv.width = W * d; cv.height = H * d;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const N = items.length, pad = 16, gap = N > 1 ? (W - pad * 2) / (N - 1) : 0;
      const R = H * 0.3, rad = Math.max(7, Math.min(13, gap * 0.4)), spin = 0.9;
      const ph = (k: number) => (k / 6) * 6.283 + spin;
      for (let pass = 0; pass < 2; pass++) {
        for (let sd = 0; sd < 2; sd++) {
          let pv: { x: number; y: number; z: number } | null = null;
          for (let a = 0; a <= W; a += 3) {
            const p2 = ph((a - pad) / (gap || 1)), c = Math.cos(p2), z = Math.sin(p2) * (sd ? -1 : 1);
            const y = H / 2 + R * c * (sd ? -1 : 1);
            if (pv && ((z + pv.z) / 2 >= 0) === (pass === 1)) {
              const zz = (z + 1) / 2;
              ctx.strokeStyle = `rgba(${sd ? '180,168,245' : '79,214,236'},${0.16 + 0.6 * zz})`;
              ctx.lineWidth = 1 + 1.8 * zz; ctx.lineCap = 'round';
              ctx.beginPath(); ctx.moveTo(pv.x, pv.y); ctx.lineTo(a, y); ctx.stroke();
            }
            pv = { x: a, y, z };
          }
        }
        if (pass === 0) {
          for (let k = 0; k < N; k++) {
            const ax = pad + k * gap, c2 = Math.cos(ph(k)), s = items[k].s;
            const col = s ? COL[s] : COL.none;
            ctx.strokeStyle = `rgba(${col},${s ? 0.55 : 0.18})`; ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.moveTo(ax, H / 2 - R * c2); ctx.lineTo(ax, H / 2 + R * c2); ctx.stroke();
          }
        }
      }
      const out: { x: number; y: number; k: number }[] = [];
      for (let k = 0; k < N; k++) {
        const ax = pad + k * gap, s = items[k].s, col = s ? COL[s] : COL.none;
        out.push({ x: ax, y: H / 2, k });
        ctx.fillStyle = s === 'ok' ? 'rgba(12,48,36,.97)' : s === 'bad' ? 'rgba(52,16,24,.97)' : 'rgba(11,16,22,.97)';
        ctx.beginPath(); ctx.arc(ax, H / 2, rad, 0, 7); ctx.fill();
        ctx.lineWidth = 1.3; ctx.strokeStyle = `rgba(${col},${s ? 0.95 : 0.4})`; ctx.stroke();
        if (nums) {
          ctx.fillStyle = s === 'ok' ? '#8FEAC6' : s === 'bad' ? '#FFA9B8' : 'rgba(207,239,248,.6)';
          ctx.font = `500 ${rad > 10 ? 10.5 : 9}px 'Geist Mono',ui-monospace,monospace`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(k + 1 + offset), ax, H / 2 + 0.5);
        }
        if (items[k].f) {
          ctx.fillStyle = flagColor; ctx.beginPath(); ctx.arc(ax + rad * 0.8, H / 2 - rad * 0.85, 3.8, 0, 7); ctx.fill();
          ctx.strokeStyle = '#0b1016'; ctx.lineWidth = 1.3; ctx.stroke();
        }
      }
      pts.current = out;
    };
    draw();
    const ro = 'ResizeObserver' in window ? new ResizeObserver(draw) : null;
    ro?.observe(cv);
    window.addEventListener('resize', draw);
    return () => { ro?.disconnect(); window.removeEventListener('resize', draw); };
  }, [items, nums, flagColor, offset]);

  const near = (e: React.PointerEvent | React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best: { k: number } | null = null, bd = 24;
    pts.current.forEach((p) => { const dd = Math.hypot(p.x - x, p.y - y); if (dd < bd) { bd = dd; best = p; } });
    return best as { k: number } | null;
  };

  return (
    <div style={{ position: 'relative', height }}>
      <canvas
        ref={ref}
        style={{ width: '100%', height: '100%', display: 'block', cursor: onSelect ? 'pointer' : 'default' }}
        aria-hidden="true"
        onPointerMove={(e) => {
          if (!label) return;
          const b = near(e);
          if (!b) { setTip(null); return; }
          const r = ref.current!.getBoundingClientRect();
          setTip({ x: e.clientX - r.left, y: e.clientY - r.top, t: label(b.k + offset, items[b.k]) });
        }}
        onPointerLeave={() => setTip(null)}
        onClick={(e) => { if (!onSelect) return; const b = near(e); if (b) onSelect(b.k + offset); }}
      />
      {tip && (
        <div style={{ position: 'absolute', left: Math.min(tip.x + 10, 9999), top: tip.y - 40, padding: '6px 10px', borderRadius: 10, background: '#0c141a', border: '1px solid rgba(207,239,248,.14)', font: "500 11px 'Geist Mono',monospace", pointerEvents: 'none', whiteSpace: 'nowrap', color: '#EAF1F7' }}>{tip.t}</div>
      )}
    </div>
  );
};
