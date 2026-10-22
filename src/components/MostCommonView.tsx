import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, Bookmark, X } from 'lucide-react';
import { getFlashcards, syncFlashcardsFromSupabase } from '../services/flashcardService';
import { resolveSession } from '../services/authService';
import { Flashcard } from '../types';
import { FeedbackButton } from './FeedbackButton';

interface MostCommonViewProps {
  onNavigate: (view: string, params?: any) => void;
}

// Per-browser memory of the student's place and saved cards (by card id, so
// adding or reordering cards later does not shift what they saved).
interface McState { lastId?: string; far?: number; saved: string[] }
const stateKey = (uid: string) => `ujo_mc_state_v1_${uid}`;
const loadState = (uid: string): McState => {
  try {
    const raw = JSON.parse(localStorage.getItem(stateKey(uid)) || 'null');
    if (raw && typeof raw === 'object') return { lastId: raw.lastId, far: Number(raw.far) || 0, saved: Array.isArray(raw.saved) ? raw.saved.filter((x: any) => typeof x === 'string') : [] };
  } catch { /* storage unavailable */ }
  return { saved: [] };
};
const saveState = (uid: string, s: McState) => {
  try { localStorage.setItem(stateKey(uid), JSON.stringify(s)); } catch { /* ignore */ }
};

// Most Common is a simple Q&A content set — NOT tied to any question
// bank — reusing the same data model as Flashcards (cardType:
// 'most_common'), shown as fill-in-the-blank with a reveal.
export const MostCommonView: React.FC<MostCommonViewProps> = ({ onNavigate }) => {
  const uid = resolveSession().user.telegramId;
  const [cards, setCards] = useState<Flashcard[]>(() => getFlashcards('most_common'));
  const initial = useMemo(() => loadState(uid), [uid]);
  const [saved, setSaved] = useState<string[]>(initial.saved);
  const [far, setFar] = useState<number>(initial.far || 0);
  const [index, setIndex] = useState<number>(() => {
    const i = initial.lastId ? cards.findIndex((c) => c.id === initial.lastId) : -1;
    return i >= 0 ? i : 0;
  });
  const [revealed, setRevealed] = useState(false);
  const [sheet, setSheet] = useState<null | 'go' | 'saved'>(null);
  const [num, setNum] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [swapKey, setSwapKey] = useState(0);
  const toastTimer = useRef<any>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  useEffect(() => {
    syncFlashcardsFromSupabase('most_common')
      .then((synced) => {
        if (synced && synced.length > 0) {
          const curId = cardsRef.current[indexRef.current]?.id;
          const ni = curId ? synced.findIndex((c) => c.id === curId) : -1;
          setCards(synced);
          if (ni >= 0) setIndex(ni);
          else {
            const li = initial.lastId ? synced.findIndex((c) => c.id === initial.lastId) : -1;
            setIndex(li >= 0 ? li : Math.min(indexRef.current, synced.length - 1));
          }
        }
      })
      .catch(() => {});
  }, [initial.lastId]);

  const N = cards.length;
  const current = cards[index];

  useEffect(() => {
    if (!current) return;
    setFar((f) => Math.max(f, index));
  }, [index, current]);
  useEffect(() => {
    if (!current) return;
    saveState(uid, { lastId: current.id, far, saved });
  }, [uid, current, far, saved]);

  const say = (t: string) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const goTo = useCallback((t: number, msg?: string, animate = true) => {
    const n = cardsRef.current.length;
    const to = Math.max(0, Math.min(n - 1, t));
    if (to === indexRef.current) return;
    setRevealed(false);
    setIndex(to);
    if (animate) setSwapKey((k) => k + 1);
    if (msg) say(msg);
  }, []);

  const isSaved = !!current && saved.includes(current.id);
  const toggleSave = () => {
    if (!current) return;
    if (isSaved) { setSaved((s) => s.filter((x) => x !== current.id)); say('Removed from saved'); }
    else { setSaved((s) => [...s, current.id]); say(`Saved card ${index + 1}`); }
  };
  const savedIdx = useMemo(
    () => saved.map((id) => cards.findIndex((c) => c.id === id)).filter((i) => i >= 0).sort((a, b) => a - b),
    [saved, cards]
  );

  const jumpNum = () => {
    const v = parseInt(num, 10);
    if (!v || v < 1 || v > N) { say(`Enter a number from 1 to ${N}`); return; }
    goTo(v - 1, `Card ${v}`);
    setSheet(null);
    setNum('');
  };

  // ---- DNA helix (vertical, 3D). Progress meter + scrubber.
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const live = useRef({ index: 0, n: 1, saved: [] as number[] });
  live.current = { index, n: Math.max(N, 1), saved: savedIdx };
  const PADY = 16;

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const cx = cv.getContext('2d');
    if (!cx) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const lowPower = (navigator.hardwareConcurrency || 8) <= 4;
    let W = 0, H = 0, dpr = 1, ph = 0, last = 0, prog = live.current.index / Math.max(live.current.n - 1, 1), raf = 0, visible = true, acc = 0;
    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = cv.getBoundingClientRect();
      W = r.width; H = r.height;
      cv.width = Math.max(1, W * dpr); cv.height = Math.max(1, H * dpr);
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    const ro = new ResizeObserver(size); ro.observe(cv);
    const io = new IntersectionObserver((e) => { visible = e[0]?.isIntersecting ?? true; }, { threshold: 0 }); io.observe(cv);

    const draw = () => {
      const { index: ix, n, saved: sv } = live.current;
      cx.clearRect(0, 0, W, H);
      const cxm = W / 2, R = Math.min(W * 0.34, 34), y0 = PADY, y1 = H - PADY, len = Math.max(y1 - y0, 1);
      const turns = Math.max(3.2, len / 92), k = (Math.PI * 2 * turns) / len;
      const py = y0 + len * prog, step = Math.max(8, len / 46);
      type It = { y: number; xa: number; za: number; lit: boolean };
      const items: It[] = [];
      for (let y = y0; y <= y1; y += step) {
        const a = (y - y0) * k + ph;
        items.push({ y, xa: Math.cos(a) * R, za: Math.sin(a), lit: y <= py });
      }
      const rung = (it: It) => {
        const d = (it.za + 1) / 2;
        cx.strokeStyle = it.lit ? `rgba(79,214,236,${0.12 + 0.4 * d})` : `rgba(207,239,248,${0.05 + 0.1 * d})`;
        cx.lineWidth = 1; cx.beginPath(); cx.moveTo(cxm + it.xa, it.y); cx.lineTo(cxm - it.xa, it.y); cx.stroke();
      };
      const node = (it: It, sg: number) => {
        const z = sg * it.za, d = (z + 1) / 2, r = 1.6 + d * 2.6, x = cxm + sg * it.xa;
        if (it.lit) { cx.fillStyle = `rgba(207,239,248,${0.45 + 0.55 * d})`; cx.shadowColor = 'rgba(79,214,236,.9)'; cx.shadowBlur = lowPower ? 0 : 6 + 8 * d; }
        else { cx.fillStyle = `rgba(147,163,182,${0.2 + 0.45 * d})`; cx.shadowBlur = 0; }
        cx.beginPath(); cx.arc(x, it.y, r, 0, 7); cx.fill(); cx.shadowBlur = 0;
      };
      const draws: { z: number; f: () => void }[] = [];
      items.forEach((it) => {
        draws.push({ z: it.za, f: () => rung(it) });
        draws.push({ z: it.za, f: () => node(it, 1) });
        draws.push({ z: -it.za, f: () => node(it, -1) });
      });
      draws.sort((a, b) => a.z - b.z);
      [1, -1].forEach((sg) => {
        cx.beginPath();
        for (let y = y0; y <= y1; y += 2) { const a = (y - y0) * k + ph, x = cxm + sg * Math.cos(a) * R; y === y0 ? cx.moveTo(x, y) : cx.lineTo(x, y); }
        cx.lineWidth = 1; cx.strokeStyle = 'rgba(207,239,248,.14)'; cx.stroke();
        cx.save(); cx.beginPath(); cx.rect(0, 0, W, py); cx.clip(); cx.beginPath();
        for (let y = y0; y <= py; y += 2) { const a = (y - y0) * k + ph, x = cxm + sg * Math.cos(a) * R; y === y0 ? cx.moveTo(x, y) : cx.lineTo(x, y); }
        cx.lineWidth = 1.6; cx.strokeStyle = 'rgba(207,239,248,.8)'; if (!lowPower) { cx.shadowColor = 'rgba(79,214,236,.9)'; cx.shadowBlur = 8; } cx.stroke(); cx.restore();
      });
      draws.forEach((d) => d.f());
      sv.forEach((idx) => {
        const fy = y0 + (len * idx) / Math.max(n - 1, 1);
        cx.fillStyle = '#4FD6EC'; cx.beginPath(); cx.moveTo(0, fy - 4); cx.lineTo(8, fy); cx.lineTo(0, fy + 4); cx.closePath(); cx.fill();
      });
      const g = cx.createRadialGradient(cxm, py, 0, cxm, py, 24);
      g.addColorStop(0, 'rgba(207,239,248,.6)'); g.addColorStop(1, 'rgba(207,239,248,0)');
      cx.fillStyle = g; cx.beginPath(); cx.arc(cxm, py, 24, 0, 7); cx.fill();
      cx.fillStyle = '#CFEFF8'; cx.beginPath(); cx.arc(cxm, py, 4.2, 0, 7); cx.fill();
      void ix;
    };

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
      acc += dt;
      if (document.hidden || !visible) return;
      if (acc < 1 / 30) return; // ~30fps
      const step = acc; acc = 0;
      ph += step * 0.9;
      const target = live.current.index / Math.max(live.current.n - 1, 1);
      prog += (target - prog) * Math.min(1, step * 7);
      draw();
    };
    if (reduce) { prog = live.current.index / Math.max(live.current.n - 1, 1); draw(); const id = setInterval(() => { prog = live.current.index / Math.max(live.current.n - 1, 1); draw(); }, 400); return () => { clearInterval(id); ro.disconnect(); io.disconnect(); }; }
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [N > 0]);

  const dragging = useRef(false);
  const idxAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientY - r.top - PADY) / Math.max(r.height - 2 * PADY, 1);
    return Math.round(Math.max(0, Math.min(1, f)) * (cardsRef.current.length - 1));
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); goTo(idxAt(e), undefined, false); };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => { if (dragging.current) goTo(idxAt(e), undefined, false); };
  const onUp = () => { if (dragging.current) { dragging.current = false; setSwapKey((k) => k + 1); } };

  const pct = N > 1 ? Math.round((index / (N - 1)) * 100) : N === 1 ? 100 : 0;

  const style = (
    <style>{`
      .uj-mc{--ice:#CFEFF8;--cy:#4FD6EC;--gr:#6FE0B4;--dim:#93A3B6;--serif:'Instrument Serif',Georgia,'Times New Roman',serif}
      .uj-mc .mono{font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim)}
      .uj-mc .serif{font-family:var(--serif);font-weight:400}
      .uj-mc .layout{display:grid;grid-template-columns:minmax(0,1fr) 64px;gap:14px;align-items:start}
      .uj-mc .rail{position:sticky;top:12px;height:min(520px,calc(100vh - 40px));min-height:360px;display:flex;flex-direction:column;align-items:center;gap:6px}
      .uj-mc .rail canvas{width:64px;flex:1;min-height:0;display:block;cursor:ns-resize;touch-action:none}
      .uj-mc .pos{font:500 11px 'Geist Mono',ui-monospace,monospace;color:var(--ice);text-align:center;line-height:1.3;font-variant-numeric:tabular-nums}
      .uj-mc .pos span{display:block;color:var(--dim);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase}
      @media(min-width:760px){.uj-mc .layout{grid-template-columns:minmax(0,1fr) 120px;gap:28px}.uj-mc .rail canvas{width:120px}}
      .uj-mc .card{border-radius:26px;padding:24px 22px 22px;border:1px solid rgba(79,214,236,.22);background:linear-gradient(160deg,rgba(79,214,236,.085),rgba(207,239,248,.02) 55%);box-shadow:0 30px 80px -44px rgba(79,214,236,.4)}
      .uj-mc .swap{animation:ujmc-swap .55s cubic-bezier(.16,1,.3,1)}
      @keyframes ujmc-swap{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
      .uj-mc .orb{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:var(--cy);background:radial-gradient(circle at 35% 30%,rgba(79,214,236,.3),rgba(79,214,236,.05) 70%);box-shadow:inset 0 0 0 1px rgba(79,214,236,.3),0 0 22px -4px rgba(79,214,236,.5)}
      .uj-mc .ic{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;border:1px solid rgba(207,239,248,.14);background:rgba(207,239,248,.04);color:var(--dim);transition:all .3s;cursor:pointer}
      .uj-mc .ic:hover{color:#EAF1F7;border-color:rgba(207,239,248,.32)}
      .uj-mc .ic.on{color:#03131B;background:var(--cy);border-color:var(--cy);box-shadow:0 0 26px -4px rgba(79,214,236,.8)}
      .uj-mc .ic.on svg{fill:currentColor}
      .uj-mc .q{margin:20px 0 22px;font:400 clamp(25px,6.2vw,32px)/1.22 var(--serif);color:#EAF1F7;text-wrap:balance}
      .uj-mc .slot{border-radius:16px;min-height:72px;padding:16px 18px;display:flex;align-items:center;margin-top:10px}
      .uj-mc .slot.blank{border:1px dashed rgba(207,239,248,.2);background:rgba(207,239,248,.02)}
      .uj-mc .slot.shown{border:1px solid rgba(111,224,180,.35);background:linear-gradient(160deg,rgba(111,224,180,.12),rgba(111,224,180,.03));box-shadow:0 0 40px -14px rgba(111,224,180,.6);animation:ujmc-ink .8s cubic-bezier(.16,1,.3,1)}
      @keyframes ujmc-ink{from{clip-path:inset(0 100% 0 0);opacity:.2}to{clip-path:inset(0)}}
      .uj-mc .slot p{margin:0;font-size:17px;line-height:1.5;color:#D8F7EA;font-weight:500}
      .uj-mc .cta{margin-top:16px;width:100%;min-height:54px;border:0;border-radius:16px;display:flex;align-items:center;justify-content:space-between;padding:0 10px 0 22px;font:600 15px 'Geist',system-ui,sans-serif;color:#03131B;background:linear-gradient(180deg,#DDF4FB,#BFE6F2);box-shadow:0 14px 50px -14px rgba(79,214,236,.6);cursor:pointer;transition:transform .25s cubic-bezier(.16,1,.3,1)}
      .uj-mc .cta:hover{transform:translateY(-2px)}.uj-mc .cta:active{transform:scale(.985)}
      .uj-mc .cta .go{width:36px;height:36px;border-radius:12px;background:#03131B;color:var(--ice);display:grid;place-items:center}
      .uj-mc .nav{display:grid;grid-template-columns:1fr auto 1.3fr;gap:10px;margin-top:24px}
      .uj-mc .nb{min-height:56px;border-radius:16px;display:flex;align-items:center;justify-content:center;gap:8px;font:600 14px 'Geist',system-ui,sans-serif;border:1px solid rgba(207,239,248,.14);background:rgba(207,239,248,.04);color:#EAF1F7;padding:0 14px;cursor:pointer;transition:transform .25s,border-color .3s}
      .uj-mc .nb:hover:not(:disabled){transform:translateY(-2px);border-color:rgba(207,239,248,.32)}
      .uj-mc .nb.next{background:linear-gradient(180deg,#DDF4FB,#BFE6F2);color:#03131B;border:0;box-shadow:0 14px 44px -14px rgba(79,214,236,.55)}
      .uj-mc .nb.jump{flex-direction:column;gap:1px;min-width:78px;font-size:12px;border-color:rgba(79,214,236,.35);color:var(--cy)}
      .uj-mc .nb.jump b{font:500 14px 'Geist Mono',ui-monospace,monospace;color:var(--ice)}
      .uj-mc .nb:disabled{opacity:.3;cursor:default}
      .uj-mc .savedlink{margin:16px auto 0;display:flex;align-items:center;justify-content:center;gap:8px;background:none;border:0;color:var(--cy);font:500 12px 'Geist',system-ui,sans-serif;min-height:40px;cursor:pointer}
      .uj-mc .scrim{position:fixed;inset:0;background:rgba(3,6,9,.62);backdrop-filter:blur(3px);z-index:60}
      .uj-mc .sheet{position:fixed;left:0;right:0;bottom:0;z-index:61;max-width:720px;margin:0 auto;border-radius:28px 28px 0 0;border:1px solid rgba(207,239,248,.12);border-bottom:0;background:linear-gradient(180deg,#10161d,#0a0e13);padding:12px 20px calc(24px + env(safe-area-inset-bottom,0px));max-height:82vh;display:flex;flex-direction:column;box-shadow:0 -30px 80px -20px rgba(79,214,236,.25);animation:ujmc-up .5s cubic-bezier(.16,1,.3,1)}
      @keyframes ujmc-up{from{transform:translateY(100%)}to{transform:none}}
      .uj-mc .grab{width:42px;height:4px;border-radius:4px;background:rgba(207,239,248,.2);margin:0 auto 14px}
      .uj-mc .tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:4px;border-radius:14px;background:rgba(207,239,248,.05)}
      .uj-mc .tabs button{min-height:42px;border:0;border-radius:11px;background:none;color:var(--dim);font:600 13px 'Geist',system-ui,sans-serif;cursor:pointer}
      .uj-mc .tabs button[aria-selected=true]{background:rgba(79,214,236,.16);color:var(--cy)}
      .uj-mc .pane{overflow:auto;padding-top:18px}
      .uj-mc .row{display:flex;gap:10px}
      .uj-mc .numin{flex:1;min-width:0;height:56px;border-radius:16px;border:1px solid rgba(207,239,248,.16);background:rgba(207,239,248,.04);color:#EAF1F7;font:400 30px var(--serif);padding:0 18px}
      .uj-mc .numin:focus{outline:2px solid var(--cy)}
      .uj-mc .gobtn{height:56px;padding:0 24px;border:0;border-radius:16px;background:linear-gradient(180deg,#DDF4FB,#BFE6F2);color:#03131B;font:700 14px 'Geist',system-ui,sans-serif;cursor:pointer}
      .uj-mc .chips{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
      .uj-mc .chip{min-height:48px;border-radius:14px;border:1px solid rgba(207,239,248,.14);background:rgba(207,239,248,.035);color:#EAF1F7;font:500 15px 'Geist Mono',ui-monospace,monospace;cursor:pointer}
      .uj-mc .chip:hover:not(:disabled){border-color:rgba(79,214,236,.5);color:var(--cy)}
      .uj-mc .chip:disabled{opacity:.3;cursor:default}
      .uj-mc .quick{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
      .uj-mc .quick button{min-height:42px;padding:0 14px;border-radius:999px;border:1px solid rgba(207,239,248,.14);background:none;color:var(--dim);font:500 12px 'Geist',system-ui,sans-serif;cursor:pointer}
      .uj-mc .quick button:hover{color:#EAF1F7}
      .uj-mc .sv{display:grid;gap:10px}
      .uj-mc .si{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:14px 14px 14px 16px;border-radius:18px;border:1px solid rgba(207,239,248,.09);background:linear-gradient(160deg,rgba(79,214,236,.06),rgba(207,239,248,.015));color:#EAF1F7;cursor:pointer}
      .uj-mc .si:hover{border-color:rgba(79,214,236,.4)}
      .uj-mc .si .n{font:400 28px/1 var(--serif);color:var(--cy);min-width:44px;font-variant-numeric:tabular-nums}
      .uj-mc .si .t{flex:1;min-width:0;font-size:13.5px;line-height:1.4;color:#D3DDE8;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .uj-mc .si .x{width:34px;height:34px;border-radius:50%;border:0;background:rgba(207,239,248,.05);color:var(--dim);display:grid;place-items:center;flex:none;cursor:pointer}
      .uj-mc .si .x:hover{color:#ff9a9a}
      .uj-mc .none{text-align:center;color:var(--dim);font-size:14px;padding:26px 10px;line-height:1.6}
      .uj-mc .toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:70;padding:11px 18px;border-radius:999px;background:#17202a;border:1px solid rgba(79,214,236,.4);font:500 13px 'Geist',system-ui,sans-serif;color:var(--ice);white-space:nowrap;animation:ujmc-t .4s cubic-bezier(.16,1,.3,1)}
      @keyframes ujmc-t{from{opacity:0;transform:translate(-50%,30px)}to{opacity:1;transform:translate(-50%,0)}}
      .uj-mc button:focus-visible,.uj-mc input:focus-visible{outline:2px solid var(--cy);outline-offset:3px}
      @media (prefers-reduced-motion:reduce){.uj-mc *{animation:none!important;transition:none!important}}
    `}</style>
  );

  const Back = (
    <button onClick={() => onNavigate('back')} className="flex items-center gap-1.5 min-h-[44px] text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors">
      <ChevronLeft className="w-4 h-4" aria-hidden="true" /><span>Back</span>
    </button>
  );
  const Title = (
    <div>
      <div className="mono" style={{ color: 'var(--cy)' }}>Revise</div>
      <h1 className="serif mt-2 text-[clamp(46px,12vw,66px)] leading-[.96] text-white" style={{ letterSpacing: '-.015em' }}>
        Most <em className="text-[#CFEFF8]">Common</em>
      </h1>
    </div>
  );

  if (N === 0) {
    return (
      <div className="uj-mc max-w-2xl mx-auto pb-12">
        {style}
        {Back}
        {Title}
        <div className="mt-8 text-center rounded-[26px] px-6 py-11" style={{ border: '1px solid rgba(207,239,248,.09)', background: 'linear-gradient(160deg,rgba(79,214,236,.06),rgba(207,239,248,.015))' }}>
          <div className="orb mx-auto mb-4" style={{ width: 64, height: 64 }}><Bookmark className="w-7 h-7" aria-hidden="true" /></div>
          <h2 className="serif text-[32px] leading-tight text-white">No cards yet</h2>
          <p className="mt-2.5 mx-auto text-sm text-slate-400 max-w-[32ch] leading-relaxed">Your admin hasn't added any Most Common cards yet. Check back soon.</p>
        </div>
      </div>
    );
  }

  const quick = (d: number) => goTo(index + d, `Card ${Math.max(0, Math.min(N - 1, index + d)) + 1}`);
  const chip = (d: number) => (
    <button key={d} className="chip" disabled={index + d < 0 || index + d >= N} onClick={() => { quick(d); setSheet(null); }}>
      {d > 0 ? `+${d}` : `−${Math.abs(d)}`}
    </button>
  );

  return (
    <div className="uj-mc max-w-3xl mx-auto pb-16">
      {style}
      {Back}
      <section className="flex items-end justify-between gap-4 mt-1">
        {Title}
        <div className="text-right pb-1">
          <b className="serif block text-[54px] leading-none text-white" style={{ fontVariantNumeric: 'tabular-nums' }}>{pct}<small className="text-[26px] text-slate-400">%</small></b>
          <span className="mono">Completed</span>
        </div>
      </section>

      <div className="layout mt-6">
        <div className="min-w-0">
          <article key={swapKey} className={`card ${swapKey ? 'swap' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2.5">
                <span className="orb"><Eye className="w-[17px] h-[17px]" aria-hidden="true" /></span>
                <span className="mono whitespace-nowrap" style={{ color: 'var(--cy)' }}>Card {index + 1}</span>
              </span>
              <div className="flex items-center gap-2">
                <button className={`ic ${isSaved ? 'on' : ''}`} onClick={toggleSave} aria-pressed={isSaved} aria-label={isSaved ? 'Remove from saved' : 'Save this card'}>
                  <Bookmark className="w-[18px] h-[18px]" aria-hidden="true" />
                </button>
                <FeedbackButton kind="most_common" itemId={current.id} />
              </div>
            </div>

            <p className="q">{current.question}</p>

            <span className="mono">Answer</span>
            {revealed ? (
              <div className="slot shown"><p>{current.answer}</p></div>
            ) : (
              <div className="slot blank" aria-hidden="true" />
            )}

            {!revealed && (
              <button className="cta" onClick={() => setRevealed(true)}>
                <span>Reveal answer</span>
                <span className="go"><Eye className="w-[18px] h-[18px]" aria-hidden="true" /></span>
              </button>
            )}
          </article>

          <div className="nav">
            <button className="nb" onClick={() => goTo(index - 1)} disabled={index === 0}>
              <ChevronLeft className="w-4 h-4" aria-hidden="true" /><span>Previous</span>
            </button>
            <button className="nb jump" onClick={() => setSheet('go')} aria-label="Jump to a card">
              <b>{index + 1}</b><span>Jump</span>
            </button>
            <button className="nb next" onClick={() => goTo(index + 1)} disabled={index >= N - 1}>
              <span>Next</span><ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
          <button className="savedlink" onClick={() => setSheet('saved')}>
            <Bookmark className="w-4 h-4" aria-hidden="true" /><span>Saved cards ({savedIdx.length})</span>
          </button>
        </div>

        <aside className="rail">
          <canvas
            ref={cvRef}
            role="img"
            aria-label="Progress through Most Common cards. Drag up or down to jump."
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
          <div className="pos"><span>Card</span><b>{index + 1}</b></div>
        </aside>
      </div>

      {sheet && (
        <>
          <div className="scrim" onClick={() => setSheet(null)} />
          <div className="sheet" role="dialog" aria-label="Jump and saved cards">
            <div className="grab" />
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={sheet === 'go'} onClick={() => setSheet('go')}>Go to card</button>
              <button role="tab" aria-selected={sheet === 'saved'} onClick={() => setSheet('saved')}>Saved ({savedIdx.length})</button>
            </div>
            {sheet === 'go' ? (
              <div className="pane">
                <div className="row">
                  <input className="numin" type="number" inputMode="numeric" min={1} max={N} value={num} placeholder={`1 – ${N}`} aria-label="Card number"
                    onChange={(e) => setNum(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') jumpNum(); }} autoFocus />
                  <button className="gobtn" onClick={jumpNum}>Go</button>
                </div>
                <div className="chips">{[-100, -50, -10, 10, 50, 100].map(chip)}</div>
                <div className="quick">
                  <button onClick={() => { goTo(0, 'Card 1'); setSheet(null); }}>First card</button>
                  <button onClick={() => { goTo(far, `Card ${far + 1}`); setSheet(null); }}>Furthest reached</button>
                  <button onClick={() => { goTo(N - 1, `Card ${N}`); setSheet(null); }}>Last card</button>
                </div>
              </div>
            ) : (
              <div className="pane">
                {savedIdx.length === 0 ? (
                  <div className="none">No saved cards yet.<br />Tap the bookmark on any card to keep it here.</div>
                ) : (
                  <div className="sv">
                    {savedIdx.map((i) => (
                      <div key={cards[i].id} className="si" role="button" tabIndex={0}
                        onClick={() => { goTo(i, `Card ${i + 1}`); setSheet(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { goTo(i, `Card ${i + 1}`); setSheet(null); } }}>
                        <span className="n">{i + 1}</span>
                        <span className="t">{cards[i].question}</span>
                        <button className="x" aria-label="Remove from saved" onClick={(e) => { e.stopPropagation(); setSaved((s) => s.filter((x) => x !== cards[i].id)); }}>
                          <X className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
};
