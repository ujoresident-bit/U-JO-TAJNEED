import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Bookmark, X, HelpCircle, CheckCircle2 } from 'lucide-react';
import { getFlashcards, syncFlashcardsFromSupabase } from '../services/flashcardService';
import { resolveSession } from '../services/authService';
import { recordReview } from '../services/reviewService';
import { Flashcard } from '../types';
import { FeedbackButton } from './FeedbackButton';

interface FlashcardsViewProps {
  onNavigate: (view: string) => void;
}

// Per-browser memory plus an account copy (Supabase) of the student's place,
// saved cards and got-it / missed ratings. Keyed by card id.
type Ratings = Record<string, 1 | -1>;
interface FcState { lastId?: string; far?: number; saved: string[]; ratings: Ratings; ts?: number }
const stateKey = (uid: string) => `ujo_fc_state_v1_${uid}`;
const cleanRatings = (r: any): Ratings => {
  const out: Ratings = {};
  if (r && typeof r === 'object') for (const k of Object.keys(r)) if (r[k] === 1 || r[k] === -1) out[k] = r[k];
  return out;
};
const loadState = (uid: string): FcState => {
  try {
    const raw = JSON.parse(localStorage.getItem(stateKey(uid)) || 'null');
    if (raw && typeof raw === 'object') {
      return {
        lastId: raw.lastId, far: Number(raw.far) || 0, ts: Number(raw.ts) || 0,
        saved: Array.isArray(raw.saved) ? raw.saved.filter((x: any) => typeof x === 'string') : [],
        ratings: cleanRatings(raw.ratings)
      };
    }
  } catch { /* storage unavailable */ }
  return { saved: [], ratings: {} };
};
const saveState = (uid: string, s: FcState) => {
  try { localStorage.setItem(stateKey(uid), JSON.stringify(s)); } catch { /* ignore */ }
};
const authHeaders = (): Record<string, string> => {
  const u = resolveSession().user;
  return { 'x-telegram-user-id': u.telegramId || '', 'x-telegram-username': u.username || '' };
};
const fetchRemoteState = async (): Promise<{ lastId: string | null; far: number; saved: string[]; ratings: Ratings; updatedAt: string } | null> => {
  try {
    const res = await fetch('/api/most-common/state?cardType=flashcard', { headers: authHeaders() });
    const data = await res.json();
    if (!data?.success || !data.state) return null;
    return { ...data.state, ratings: cleanRatings(data.state.ratings) };
  } catch { return null; }
};
const pushRemoteState = (s: FcState): void => {
  try {
    fetch('/api/most-common/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ cardType: 'flashcard', lastId: s.lastId || null, far: s.far || 0, saved: s.saved, ratings: s.ratings })
    }).catch(() => {});
  } catch { /* ignore */ }
};

export const FlashcardsView: React.FC<FlashcardsViewProps> = ({ onNavigate }) => {
  const uid = resolveSession().user.telegramId;
  const [cards, setCards] = useState<Flashcard[]>(() => getFlashcards());
  const initial = useMemo(() => loadState(uid), [uid]);
  const [saved, setSaved] = useState<string[]>(initial.saved);
  const [ratings, setRatings] = useState<Ratings>(initial.ratings);
  const [far, setFar] = useState<number>(initial.far || 0);
  const [index, setIndex] = useState<number>(() => {
    const i = initial.lastId ? cards.findIndex((c) => c.id === initial.lastId) : -1;
    return i >= 0 ? i : 0;
  });
  const [flipped, setFlipped] = useState(false);
  const [sheet, setSheet] = useState<null | 'go' | 'saved'>(null);
  const [num, setNum] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<any>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const ratingsRef = useRef(ratings);
  ratingsRef.current = ratings;

  useEffect(() => {
    syncFlashcardsFromSupabase()
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

  const stateTs = useRef<number>(initial.ts || 0);
  const remoteReady = useRef(false);
  const pushTimer = useRef<any>(null);
  useEffect(() => {
    if (!current) return;
    // Keep the old stamp until the account copy has been read.
    const ts = remoteReady.current ? Date.now() : stateTs.current;
    stateTs.current = ts;
    const s: FcState = { lastId: current.id, far, saved, ratings, ts };
    saveState(uid, s);
    if (!remoteReady.current) return;
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => pushRemoteState(s), 800);
  }, [uid, current, far, saved, ratings]);
  useEffect(() => () => clearTimeout(pushTimer.current), []);

  useEffect(() => {
    let dead = false;
    fetchRemoteState().then((remote) => {
      if (dead) return;
      const local = loadState(uid);
      const remoteTs = remote ? Date.parse(remote.updatedAt) || 0 : 0;
      if (remote && remoteTs > (local.ts || 0)) {
        setSaved(remote.saved);
        setRatings(remote.ratings);
        setFar((f) => Math.max(remote.far || 0, 0) || f);
        if (remote.lastId) {
          const i = cardsRef.current.findIndex((c) => c.id === remote.lastId);
          if (i >= 0) { setIndex(i); setFlipped(false); }
        }
        saveState(uid, { lastId: remote.lastId || undefined, far: remote.far, saved: remote.saved, ratings: remote.ratings, ts: remoteTs });
      } else if (local.lastId || local.saved.length > 0 || Object.keys(local.ratings).length > 0) {
        pushRemoteState(local);
      }
      remoteReady.current = true;
    });
    return () => { dead = true; };
  }, [uid]);

  const say = (t: string) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const goTo = useCallback((t: number, msg?: string) => {
    const n = cardsRef.current.length;
    const to = Math.max(0, Math.min(n - 1, t));
    if (to === indexRef.current) return;
    setFlipped(false);
    setIndex(to);
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

  const rate = (ok: boolean) => {
    if (!current) return;
    recordReview('flashcard', current.id, ok);
    setRatings((r) => ({ ...r, [current.id]: ok ? 1 : -1 }));
    if (!ok) say('Will return in 1 day');
    if (index < N - 1) goTo(index + 1);
    else setFlipped(false);
  };

  const counts = useMemo(() => {
    let got = 0, miss = 0;
    for (const c of cards) { const r = ratings[c.id]; if (r === 1) got++; else if (r === -1) miss++; }
    return { got, miss };
  }, [cards, ratings]);

  const jumpNum = () => {
    const v = parseInt(num, 10);
    if (!v || v < 1 || v > N) { say(`Enter a number from 1 to ${N}`); return; }
    goTo(v - 1, `Card ${v}`);
    setSheet(null);
    setNum('');
  };
  const nextMissed = () => {
    for (let k = 1; k <= N; k++) {
      const q = (index + k) % N;
      if (ratings[cards[q].id] === -1) { goTo(q, `Card ${q + 1}`); setSheet(null); return; }
    }
    say('No missed cards');
  };

  // ---- Vessel: a vertical artery, one branch per group of cards. Progress meter + scrubber.
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const live = useRef({ index: 0, n: 1, far: 0, saved: [] as number[], status: [] as number[] });
  const status = useMemo(() => cards.map((c) => (ratings[c.id] === 1 ? 1 : ratings[c.id] === -1 ? -1 : 0)), [cards, ratings]);
  live.current = { index, n: Math.max(N, 1), far, saved: savedIdx, status };
  const PADY = 16;

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const cx = cv.getContext('2d');
    if (!cx) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const lowPower = (navigator.hardwareConcurrency || 8) <= 4;
    let W = 0, H = 0, ph = 0, last = 0, raf = 0, visible = true, acc = 0;
    let pos = live.current.index;
    const cells = Array.from({ length: lowPower ? 14 : 26 }, () => ({ u: Math.random(), v: 0.5 + Math.random() * 0.9, o: (Math.random() - 0.5) * 0.8 }));
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = cv.getBoundingClientRect();
      W = r.width; H = r.height;
      cv.width = Math.max(1, W * dpr); cv.height = Math.max(1, H * dpr);
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    const ro = new ResizeObserver(size); ro.observe(cv);
    const io = new IntersectionObserver((e) => { visible = e[0]?.isIntersecting ?? true; }, { threshold: 0 }); io.observe(cv);

    const draw = (dt: number) => {
      const { n, far: fr, saved: sv, status: st } = live.current;
      cx.clearRect(0, 0, W, H);
      const y0 = PADY, y1 = H - PADY, len = Math.max(y1 - y0, 1);
      const rows = Math.max(1, Math.min(n, Math.floor(len / 15))), per = n / rows, gap = len / rows;
      const mx = W / 2, R = Math.max(4, Math.min(7, W * 0.06)), reach = W * 0.34;
      const tx = (y: number) => mx + Math.sin(y * 0.022 + ph * 0.5) * W * 0.045;
      const py = y0 + len * (pos / Math.max(n - 1, 1));
      [-1, 1].forEach((sg) => {
        cx.beginPath();
        for (let y = y0; y <= y1; y += 3) { const x = tx(y) + sg * R; y === y0 ? cx.moveTo(x, y) : cx.lineTo(x, y); }
        cx.lineWidth = 1.2; cx.strokeStyle = 'rgba(147,163,182,.28)'; cx.stroke();
        cx.save(); cx.beginPath(); cx.rect(0, 0, W, py); cx.clip(); cx.beginPath();
        for (let y = y0; y <= py; y += 3) { const x = tx(y) + sg * R; y === y0 ? cx.moveTo(x, y) : cx.lineTo(x, y); }
        cx.lineWidth = 1.6; cx.strokeStyle = 'rgba(207,239,248,.85)';
        if (!lowPower) { cx.shadowColor = 'rgba(79,214,236,.8)'; cx.shadowBlur = 7; }
        cx.stroke(); cx.restore();
      });
      cx.save(); cx.beginPath(); cx.rect(0, 0, W, py); cx.clip(); cx.beginPath();
      for (let y = y0; y <= py; y += 3) { const x = tx(y); y === y0 ? cx.moveTo(x, y) : cx.lineTo(x, y); }
      cx.lineWidth = R * 2 - 3; cx.strokeStyle = 'rgba(79,214,236,.16)'; cx.stroke(); cx.restore();

      for (let r = 0; r < rows; r++) {
        const a = Math.floor(r * per), b = Math.max(a + 1, Math.floor((r + 1) * per));
        let mc = 0, gc = 0, seen = false;
        for (let k = a; k < b && k < n; k++) { if (st[k] === -1) mc++; else if (st[k] === 1) gc++; if (k <= fr) seen = true; }
        const y = y0 + gap * (r + 0.5), sg = r % 2 ? 1 : -1;
        const sx = tx(y) + sg * R, ex = tx(y) + sg * reach * (0.75 + 0.25 * Math.sin(r * 2.3)), ey = y + gap * 0.45;
        let col = 'rgba(147,163,182,', glow: string | null = null;
        const lit = y <= py;
        if (mc > 0 && mc >= gc) { col = 'rgba(255,107,129,'; glow = 'rgba(255,107,129,.9)'; }
        else if (gc > 0) { col = 'rgba(111,224,180,'; glow = 'rgba(111,224,180,.9)'; }
        else if (seen) col = 'rgba(207,239,248,';
        const al = seen || lit ? 0.75 : 0.28;
        cx.beginPath(); cx.moveTo(sx, y); cx.quadraticCurveTo(sx + sg * reach * 0.35, y + gap * 0.05, ex, ey);
        cx.lineWidth = 1.3; cx.strokeStyle = col + al + ')'; cx.stroke();
        cx.beginPath(); cx.moveTo(sx + sg * reach * 0.45, y + gap * 0.12); cx.lineTo(sx + sg * reach * 0.6, y - gap * 0.28);
        cx.lineWidth = 0.8; cx.strokeStyle = col + al * 0.7 + ')'; cx.stroke();
        cx.fillStyle = col + (seen || lit ? 0.95 : 0.4) + ')';
        if (glow && (seen || lit) && !lowPower) { cx.shadowColor = glow; cx.shadowBlur = 8; }
        cx.beginPath(); cx.arc(ex, ey, seen || lit ? 3.4 : 2.4, 0, 7); cx.fill(); cx.shadowBlur = 0;
      }
      cx.fillStyle = 'rgba(207,239,248,.9)';
      if (py - y0 >= 6) {
        cells.forEach((c) => {
          c.u += dt * 0.16 * c.v; if (c.u > 1) c.u -= 1;
          const y = y0 + (py - y0) * c.u, x = tx(y) + c.o * R * 0.9;
          cx.globalAlpha = 0.4 + 0.5 * c.u; cx.beginPath(); cx.ellipse(x, y, 2.2, 3.4, 0, 0, 7); cx.fill();
        });
      }
      cx.globalAlpha = 1;
      sv.forEach((idx) => {
        const fy = y0 + (len * idx) / Math.max(n - 1, 1);
        cx.fillStyle = '#4FD6EC'; cx.beginPath(); cx.moveTo(0, fy - 4); cx.lineTo(7, fy); cx.lineTo(0, fy + 4); cx.closePath(); cx.fill();
      });
      const beat = (Math.sin(ph * 5) + 1) / 2, hx = tx(py);
      const g = cx.createRadialGradient(hx, py, 0, hx, py, 18 + beat * 6);
      g.addColorStop(0, 'rgba(207,239,248,.65)'); g.addColorStop(1, 'rgba(207,239,248,0)');
      cx.fillStyle = g; cx.beginPath(); cx.arc(hx, py, 24, 0, 7); cx.fill();
      cx.fillStyle = '#CFEFF8'; cx.beginPath(); cx.arc(hx, py, 4.2, 0, 7); cx.fill();
    };

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
      acc += dt;
      if (document.hidden || !visible) return;
      if (acc < 1 / 30) return;
      const step = acc; acc = 0;
      ph += step;
      pos += (live.current.index - pos) * Math.min(1, step * 8);
      draw(step);
    };
    if (reduce) {
      pos = live.current.index; draw(0);
      const id = setInterval(() => { pos = live.current.index; draw(0); }, 400);
      return () => { clearInterval(id); ro.disconnect(); io.disconnect(); };
    }
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
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); goTo(idxAt(e)); };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => { if (dragging.current) goTo(idxAt(e)); };
  const onUp = () => { dragging.current = false; };

  const pct = N > 1 ? Math.round((index / (N - 1)) * 100) : N === 1 ? 100 : 0;

  const style = (
    <style>{`
      .uj-fc{--ice:#CFEFF8;--cy:#4FD6EC;--gr:#6FE0B4;--dim:#93A3B6;--serif:'Instrument Serif',Georgia,'Times New Roman',serif}
      .uj-fc .mono{font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim)}
      .uj-fc .serif{font-family:var(--serif);font-weight:400}
      .uj-fc .layout{display:grid;grid-template-columns:minmax(0,1fr) 64px;gap:14px;align-items:start}
      .uj-fc .rail{position:sticky;top:12px;height:min(520px,calc(100vh - 40px));min-height:360px;display:flex;flex-direction:column;align-items:center;gap:6px}
      .uj-fc .rail canvas{width:64px;flex:1;min-height:0;display:block;cursor:ns-resize;touch-action:none}
      .uj-fc .pos{font:500 11px 'Geist Mono',ui-monospace,monospace;color:var(--ice);text-align:center;line-height:1.3;font-variant-numeric:tabular-nums}
      .uj-fc .pos span{display:block;color:var(--dim);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase}
      @media(min-width:760px){.uj-fc .layout{grid-template-columns:minmax(0,1fr) 120px;gap:28px}.uj-fc .rail canvas{width:120px}}
      .uj-fc .card{border-radius:26px;padding:24px 22px 22px;border:1px solid rgba(79,214,236,.22);background:linear-gradient(160deg,rgba(79,214,236,.085),rgba(207,239,248,.02) 55%);box-shadow:0 30px 80px -44px rgba(79,214,236,.4)}
      .uj-fc .swap{animation:ujfc-swap .55s cubic-bezier(.16,1,.3,1)}
      @keyframes ujfc-swap{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
      .uj-fc .orb{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:var(--cy);background:radial-gradient(circle at 35% 30%,rgba(79,214,236,.3),rgba(79,214,236,.05) 70%);box-shadow:inset 0 0 0 1px rgba(79,214,236,.3),0 0 22px -4px rgba(79,214,236,.5)}
      .uj-fc .ic{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;border:1px solid rgba(207,239,248,.14);background:rgba(207,239,248,.04);color:var(--dim);transition:all .3s;cursor:pointer}
      .uj-fc .ic:hover{color:#EAF1F7;border-color:rgba(207,239,248,.32)}
      .uj-fc .ic.on{color:#03131B;background:var(--cy);border-color:var(--cy);box-shadow:0 0 26px -4px rgba(79,214,236,.8)}
      .uj-fc .ic.on svg{fill:currentColor}
      .uj-fc .q{margin:20px 0 22px;font:400 clamp(25px,6.2vw,32px)/1.22 var(--serif);color:#EAF1F7;text-wrap:balance}
      .uj-fc .slot{border-radius:16px;min-height:72px;padding:16px 18px;display:flex;align-items:center;margin-top:10px}
      .uj-fc .slot.blank{border:1px dashed rgba(207,239,248,.2);background:rgba(207,239,248,.02)}
      .uj-fc .slot.shown{border:1px solid rgba(111,224,180,.35);background:linear-gradient(160deg,rgba(111,224,180,.12),rgba(111,224,180,.03));box-shadow:0 0 40px -14px rgba(111,224,180,.6);animation:ujfc-ink .8s cubic-bezier(.16,1,.3,1)}
      @keyframes ujfc-ink{from{clip-path:inset(0 100% 0 0);opacity:.2}to{clip-path:inset(0)}}
      .uj-fc .slot p{margin:0;font-size:17px;line-height:1.5;color:#D8F7EA;font-weight:500}
      .uj-fc .cta{margin-top:16px;width:100%;min-height:54px;border:0;border-radius:16px;display:flex;align-items:center;justify-content:space-between;padding:0 10px 0 22px;font:600 15px 'Geist',system-ui,sans-serif;color:#03131B;background:linear-gradient(180deg,#DDF4FB,#BFE6F2);box-shadow:0 14px 50px -14px rgba(79,214,236,.6);cursor:pointer;transition:transform .25s cubic-bezier(.16,1,.3,1)}
      .uj-fc .cta:hover{transform:translateY(-2px)}.uj-fc .cta:active{transform:scale(.985)}
      .uj-fc .cta .go{width:36px;height:36px;border-radius:12px;background:#03131B;color:var(--ice);display:grid;place-items:center}
      .uj-fc .nav{display:grid;grid-template-columns:1fr auto 1.3fr;gap:10px;margin-top:24px}
      .uj-fc .nb{min-height:56px;border-radius:16px;display:flex;align-items:center;justify-content:center;gap:8px;font:600 14px 'Geist',system-ui,sans-serif;border:1px solid rgba(207,239,248,.14);background:rgba(207,239,248,.04);color:#EAF1F7;padding:0 14px;cursor:pointer;transition:transform .25s,border-color .3s}
      .uj-fc .nb:hover:not(:disabled){transform:translateY(-2px);border-color:rgba(207,239,248,.32)}
      .uj-fc .nb.next{background:linear-gradient(180deg,#DDF4FB,#BFE6F2);color:#03131B;border:0;box-shadow:0 14px 44px -14px rgba(79,214,236,.55)}
      .uj-fc .nb.jump{flex-direction:column;gap:1px;min-width:78px;font-size:12px;border-color:rgba(79,214,236,.35);color:var(--cy)}
      .uj-fc .nb.jump b{font:500 14px 'Geist Mono',ui-monospace,monospace;color:var(--ice)}
      .uj-fc .nb:disabled{opacity:.3;cursor:default}
      .uj-fc .savedlink{margin:16px auto 0;display:flex;align-items:center;justify-content:center;gap:8px;background:none;border:0;color:var(--cy);font:500 12px 'Geist',system-ui,sans-serif;min-height:40px;cursor:pointer}
      .uj-fc .scrim{position:fixed;inset:0;background:rgba(3,6,9,.62);backdrop-filter:blur(3px);z-index:60}
      .uj-fc .sheet{position:fixed;left:0;right:0;bottom:0;z-index:61;max-width:720px;margin:0 auto;border-radius:28px 28px 0 0;border:1px solid rgba(207,239,248,.12);border-bottom:0;background:linear-gradient(180deg,#10161d,#0a0e13);padding:12px 20px calc(24px + env(safe-area-inset-bottom,0px));max-height:82vh;display:flex;flex-direction:column;box-shadow:0 -30px 80px -20px rgba(79,214,236,.25);animation:ujfc-up .5s cubic-bezier(.16,1,.3,1)}
      @keyframes ujfc-up{from{transform:translateY(100%)}to{transform:none}}
      .uj-fc .grab{width:42px;height:4px;border-radius:4px;background:rgba(207,239,248,.2);margin:0 auto 14px}
      .uj-fc .tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:4px;border-radius:14px;background:rgba(207,239,248,.05)}
      .uj-fc .tabs button{min-height:42px;border:0;border-radius:11px;background:none;color:var(--dim);font:600 13px 'Geist',system-ui,sans-serif;cursor:pointer}
      .uj-fc .tabs button[aria-selected=true]{background:rgba(79,214,236,.16);color:var(--cy)}
      .uj-fc .pane{overflow:auto;padding-top:18px}
      .uj-fc .row{display:flex;gap:10px}
      .uj-fc .numin{flex:1;min-width:0;height:56px;border-radius:16px;border:1px solid rgba(207,239,248,.16);background:rgba(207,239,248,.04);color:#EAF1F7;font:400 30px var(--serif);padding:0 18px}
      .uj-fc .numin:focus{outline:2px solid var(--cy)}
      .uj-fc .gobtn{height:56px;padding:0 24px;border:0;border-radius:16px;background:linear-gradient(180deg,#DDF4FB,#BFE6F2);color:#03131B;font:700 14px 'Geist',system-ui,sans-serif;cursor:pointer}
      .uj-fc .chips{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
      .uj-fc .chip{min-height:48px;border-radius:14px;border:1px solid rgba(207,239,248,.14);background:rgba(207,239,248,.035);color:#EAF1F7;font:500 15px 'Geist Mono',ui-monospace,monospace;cursor:pointer}
      .uj-fc .chip:hover:not(:disabled){border-color:rgba(79,214,236,.5);color:var(--cy)}
      .uj-fc .chip:disabled{opacity:.3;cursor:default}
      .uj-fc .quick{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
      .uj-fc .quick button{min-height:42px;padding:0 14px;border-radius:999px;border:1px solid rgba(207,239,248,.14);background:none;color:var(--dim);font:500 12px 'Geist',system-ui,sans-serif;cursor:pointer}
      .uj-fc .quick button:hover{color:#EAF1F7}
      .uj-fc .sv{display:grid;gap:10px}
      .uj-fc .si{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:14px 14px 14px 16px;border-radius:18px;border:1px solid rgba(207,239,248,.09);background:linear-gradient(160deg,rgba(79,214,236,.06),rgba(207,239,248,.015));color:#EAF1F7;cursor:pointer}
      .uj-fc .si:hover{border-color:rgba(79,214,236,.4)}
      .uj-fc .si .n{font:400 28px/1 var(--serif);color:var(--cy);min-width:44px;font-variant-numeric:tabular-nums}
      .uj-fc .si .t{flex:1;min-width:0;font-size:13.5px;line-height:1.4;color:#D3DDE8;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .uj-fc .si .x{width:34px;height:34px;border-radius:50%;border:0;background:rgba(207,239,248,.05);color:var(--dim);display:grid;place-items:center;flex:none;cursor:pointer}
      .uj-fc .si .x:hover{color:#ff9a9a}
      .uj-fc .none{text-align:center;color:var(--dim);font-size:14px;padding:26px 10px;line-height:1.6}
      .uj-fc .toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:70;padding:11px 18px;border-radius:999px;background:#17202a;border:1px solid rgba(79,214,236,.4);font:500 13px 'Geist',system-ui,sans-serif;color:var(--ice);white-space:nowrap;animation:ujfc-t .4s cubic-bezier(.16,1,.3,1)}
      @keyframes ujfc-t{from{opacity:0;transform:translate(-50%,30px)}to{opacity:1;transform:translate(-50%,0)}}
      .uj-fc button:focus-visible,.uj-fc input:focus-visible{outline:2px solid var(--cy);outline-offset:3px}
      @media (prefers-reduced-motion:reduce){.uj-fc *{animation:none!important;transition:none!important}}
    
      .uj-fc .flip{position:relative;height:clamp(250px,62vw,320px);perspective:1100px;cursor:pointer;-webkit-tap-highlight-color:transparent}
      .uj-fc .flip .in{position:absolute;inset:0;transition:transform .7s cubic-bezier(.16,1,.3,1);transform-style:preserve-3d}
      .uj-fc .flip.f .in{transform:rotateY(180deg)}
      .uj-fc .face{position:absolute;inset:0;border-radius:26px;padding:20px 22px;display:flex;flex-direction:column;backface-visibility:hidden;-webkit-backface-visibility:hidden}
      .uj-fc .face.fr{border:1px solid rgba(79,214,236,.22);background:linear-gradient(160deg,#0b1a20,#0a1217 60%);box-shadow:0 30px 80px -44px rgba(79,214,236,.4)}
      .uj-fc .face.bk{transform:rotateY(180deg);border:1px solid rgba(111,224,180,.38);background:linear-gradient(160deg,#0c1f1a,#0a1215 60%);box-shadow:0 30px 80px -44px rgba(111,224,180,.5)}
      .uj-fc .face .mid{flex:1;display:grid;place-items:center;text-align:center;padding:8px 4px;overflow:auto}
      .uj-fc .face .mid p{margin:0;font:400 clamp(24px,6vw,31px)/1.25 var(--serif);color:#EAF1F7;text-wrap:balance;white-space:pre-wrap}
      .uj-fc .face.bk .mid p{color:#D8F7EA}
      .uj-fc .face .ft{display:flex;justify-content:center}
      .uj-fc .rate{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
      .uj-fc .rate button{min-height:54px;border-radius:16px;font:600 14px 'Geist',system-ui,sans-serif;border:1px solid;cursor:pointer;transition:transform .25s}
      .uj-fc .rate button:hover{transform:translateY(-2px)}
      .uj-fc .rate .miss{color:#FFB4C0;background:rgba(255,107,129,.10);border-color:rgba(255,107,129,.38)}
      .uj-fc .rate .got{color:#BFF5DF;background:rgba(111,224,180,.12);border-color:rgba(111,224,180,.4)}
      .uj-fc .pill{display:inline-flex;align-items:baseline;gap:8px;padding:7px 13px;border-radius:999px;background:rgba(207,239,248,.05);border:1px solid rgba(207,239,248,.12)}
      .uj-fc .pill b{font:400 20px/1 var(--serif);font-variant-numeric:tabular-nums}
      .uj-fc .pill.g b{color:var(--gr)}.uj-fc .pill.m b{color:#FF8FA3}
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
        Flash<em className="text-[#CFEFF8]">cards</em>
      </h1>
    </div>
  );

  if (N === 0) {
    return (
      <div className="uj-fc max-w-2xl mx-auto pb-12">
        {style}
        {Back}
        {Title}
        <div className="mt-8 text-center rounded-[26px] px-6 py-11" style={{ border: '1px solid rgba(207,239,248,.09)', background: 'linear-gradient(160deg,rgba(79,214,236,.06),rgba(207,239,248,.015))' }}>
          <div className="orb mx-auto mb-4" style={{ width: 64, height: 64 }}><HelpCircle className="w-7 h-7" aria-hidden="true" /></div>
          <h2 className="serif text-[32px] leading-tight text-white">No flashcards yet</h2>
          <p className="mt-2.5 mx-auto text-sm text-slate-400 max-w-[32ch] leading-relaxed">Your admin hasn't added any flashcards yet. Check back soon.</p>
        </div>
      </div>
    );
  }

  const chip = (d: number) => (
    <button key={d} className="chip" disabled={index + d < 0 || index + d >= N} onClick={() => { goTo(index + d, `Card ${Math.max(0, Math.min(N - 1, index + d)) + 1}`); setSheet(null); }}>
      {d > 0 ? `+${d}` : `−${Math.abs(d)}`}
    </button>
  );
  const flip = () => setFlipped((f) => !f);

  return (
    <div className="uj-fc max-w-3xl mx-auto pb-16">
      {style}
      {Back}
      <section className="flex items-end justify-between gap-4 mt-1">
        <div>
          {Title}
          <div className="flex flex-wrap gap-2 mt-3">
            <span className="pill g"><span className="mono">Got it</span><b>{counts.got}</b></span>
            <span className="pill m"><span className="mono">Missed</span><b>{counts.miss}</b></span>
          </div>
        </div>
        <div className="text-right pb-1">
          <b className="serif block text-[54px] leading-none text-white" style={{ fontVariantNumeric: 'tabular-nums' }}>{pct}<small className="text-[26px] text-slate-400">%</small></b>
          <span className="mono">Completed</span>
        </div>
      </section>

      <div className="layout mt-6">
        <div className="min-w-0">
          <div
            className={`flip ${flipped ? 'f' : ''}`}
            role="button" tabIndex={0} aria-label="Flip card"
            onClick={(e) => { if ((e.target as HTMLElement).closest('.acts')) return; flip(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } }}
          >
            <div className="in">
              <div className="face fr" aria-hidden={flipped}>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2.5">
                    <span className="orb"><HelpCircle className="w-[17px] h-[17px]" aria-hidden="true" /></span>
                    <span className="mono whitespace-nowrap" style={{ color: 'var(--cy)' }}>Card {index + 1}</span>
                  </span>
                  <div className="acts flex items-center gap-2">
                    <button className={`ic ${isSaved ? 'on' : ''}`} onClick={toggleSave} aria-pressed={isSaved} aria-label={isSaved ? 'Remove from saved' : 'Save this card'}>
                      <Bookmark className="w-[18px] h-[18px]" aria-hidden="true" />
                    </button>
                    <FeedbackButton kind="flashcard" itemId={current.id} />
                  </div>
                </div>
                <div className="mid"><p>{current.question}</p></div>
                <div className="ft"><span className="mono">Tap to flip</span></div>
              </div>
              <div className="face bk" aria-hidden={!flipped}>
                <div className="flex items-center">
                  <span className="inline-flex items-center gap-2.5">
                    <span className="orb" style={{ color: 'var(--gr)', background: 'radial-gradient(circle at 35% 30%,rgba(111,224,180,.3),rgba(111,224,180,.05) 70%)', boxShadow: 'inset 0 0 0 1px rgba(111,224,180,.3),0 0 22px -4px rgba(111,224,180,.5)' }}>
                      <CheckCircle2 className="w-[17px] h-[17px]" aria-hidden="true" />
                    </span>
                    <span className="mono whitespace-nowrap" style={{ color: 'var(--gr)' }}>Answer {index + 1}</span>
                  </span>
                </div>
                <div className="mid"><p>{current.answer}</p></div>
                <div className="ft"><span className="mono">Tap to flip back</span></div>
              </div>
            </div>
          </div>

          {flipped && (
            <div className="rate">
              <button className="miss" onClick={() => rate(false)}>Missed it, review later</button>
              <button className="got" onClick={() => rate(true)}>Got it</button>
            </div>
          )}

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
            aria-label="Your progress through the flashcards. Drag up or down to jump."
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
                  <button onClick={nextMissed}>Next missed card</button>
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
