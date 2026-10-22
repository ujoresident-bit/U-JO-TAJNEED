import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchDueReviews } from '../services/reviewService';
import { resolveSession } from '../services/authService';
import { getUserStudyStats } from '../services/progressService';
import { getBankPerformance } from '../services/performanceService';
import { getActiveBlockForUser, getQuestionBankMeta } from '../services/questionBankService';
import { CountUp } from './PerfKit';
import { NeuralMap, NeuralNode } from './NeuralMap';

interface SpecialtyHubProps {
  bankId: string;
  bankLabel: string;
  onNavigate: (view: string, params?: any) => void;
}

type Tint = 'cy' | 'gr' | 'am' | 'vi';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' as const };

// One hand-drawn pictogram per destination (replaces the generic icon set).
const Pictos: Record<string, React.ReactNode> = {
  past_years: (
    <svg className="uj-pic" viewBox="0 0 52 52" {...S} aria-hidden="true">
      <rect className="dr" pathLength={1} x="6" y="9" width="40" height="36" rx="2" />
      <path className="dr" pathLength={1} d="M6 18h40M16 5v8M36 5v8" />
      {[[17, 28], [26, 28], [35, 28], [17, 37], [26, 37]].map(([x, y]) => <circle key={`${x}${y}`} className="nd" cx={x} cy={y} r="1.8" fill="currentColor" />)}
    </svg>
  ),
  qbank_basic: (
    <svg className="uj-pic" viewBox="0 0 52 52" {...S} aria-hidden="true">
      <path className="dr" pathLength={1} d="M26 8l16 9v18l-16 9-16-9V17z" />
      <path className="dr" pathLength={1} d="M10 17l16 9 16-9M26 26v18" />
      <circle className="nd" cx="26" cy="26" r="2.2" fill="currentColor" />
    </svg>
  ),
  review: (
    <svg className="uj-pic" viewBox="0 0 52 52" {...S} aria-hidden="true">
      <path className="dr" pathLength={1} d="M42 26a16 16 0 1 1-5-11.6" />
      <path className="dr" pathLength={1} d="M38 6v9h-9" />
      <circle className="nd" cx="26" cy="26" r="2.2" fill="currentColor" />
    </svg>
  ),
  flashcards: (
    <svg className="uj-pic" viewBox="0 0 52 52" {...S} aria-hidden="true">
      <rect className="dr" pathLength={1} x="14" y="6" width="28" height="30" rx="2" />
      <rect className="dr" pathLength={1} x="10" y="12" width="28" height="30" rx="2" />
      <path d="M17 24h14M17 30h9" />
    </svg>
  ),
  most_common: (
    <svg className="uj-pic" viewBox="0 0 52 52" {...S} aria-hidden="true">
      <path className="dr" pathLength={1} d="M8 16h14M30 16h14M8 26h22M38 26h6M8 36h10M26 36h18" />
      <rect className="nd" x="22" y="12" width="8" height="8" rx="1" fill="currentColor" fillOpacity=".25" />
      <rect className="nd" x="30" y="22" width="8" height="8" rx="1" fill="currentColor" fillOpacity=".25" />
    </svg>
  ),
  smart_first_aid: (
    <svg className="uj-pic" viewBox="0 0 52 52" {...S} aria-hidden="true">
      <path className="dr" pathLength={1} d="M26 12c-5-4-13-4-18-1v28c5-3 13-3 18 1 5-4 13-4 18-1V11c-5-3-13-3-18 1z" />
      <path className="dr" pathLength={1} d="M26 12v28" />
      <circle className="nd" cx="17" cy="22" r="1.8" fill="currentColor" />
      <circle className="nd" cx="35" cy="22" r="1.8" fill="currentColor" />
    </svg>
  ),
  videos: (
    <svg className="uj-pic" viewBox="0 0 52 52" {...S} aria-hidden="true">
      <circle className="dr" pathLength={1} cx="26" cy="26" r="18" />
      <path className="dr" pathLength={1} d="M22 18l12 8-12 8z" />
      <circle className="nd" cx="26" cy="26" r="1.4" fill="currentColor" />
    </svg>
  )
};

const INTRO_SCALE = 0.6;

// Landing hub shown after choosing a specialty. Questions first, then the
// study tools, then media and the book. Same visual language as the home
// page: a free-floating network of the student's real subjects, soft cards
// with glowing pictogram orbs, staggered reveal.
export const SpecialtyHub: React.FC<SpecialtyHubProps> = ({ bankId, bankLabel, onNavigate }) => {
  const [dueCount, setDueCount] = useState<number | null>(null);
  useEffect(() => {
    fetchDueReviews(bankId).then((r) => setDueCount(r.due.length)).catch(() => {});
  }, [bankId]);

  const user = resolveSession().user;
  const stats = getUserStudyStats(user.telegramId, bankId);
  const activeBlock = getActiveBlockForUser(user.telegramId, bankId);

  // The subjects may arrive after the first paint (background question sync).
  const [metaTick, setMetaTick] = useState(0);
  useEffect(() => {
    let last = -1, tries = 0;
    const read = () => { try { return getQuestionBankMeta(bankId).majors.length; } catch { return 0; } };
    last = read();
    const id = setInterval(() => {
      tries++;
      const n = read();
      if (n !== last) { last = n; setMetaTick((x) => x + 1); }
      if (tries >= 10) clearInterval(id);
    }, 1500);
    return () => clearInterval(id);
  }, [bankId]);

  const nodes: NeuralNode[] = useMemo(() => {
    const perf = getBankPerformance(user.telegramId, bankId);
    const byName = new Map(perf.bySubject.map((s) => [s.major, s]));
    let names: string[] = [];
    try { names = getQuestionBankMeta(bankId).majors.map((m) => m.name); } catch { names = []; }
    if (names.length === 0) names = perf.bySubject.map((s) => s.major);
    return Array.from(new Set(names)).map((name) => {
      const s = byName.get(name);
      return { id: name, label: name, pct: s ? s.pct : null, total: s ? s.total : 0 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId, user.telegramId, stats.totalQuestionsSolved, metaTick]);

  const showNetwork = nodes.length >= 3;
  const hasData = (stats.totalQuestionsSolved || 0) > 0;

  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setEntered(true); return; }
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const rise = (d: number) => ({ ['--d' as any]: `${d}s` });

  const groups: { title: string; cols: 'two' | 'three'; items: { key: string; title: string; description: string; tint: Tint; badge?: string; onClick: () => void }[] }[] = [
    {
      title: 'Practice',
      cols: 'two',
      items: [
        { key: 'past_years', title: 'Past Years', description: 'TAJNEED and MADANI sets, filtered by year.', tint: 'cy', onClick: () => onNavigate('bank', { bankId }) },
        { key: 'qbank_basic', title: 'QBANK BASIC', description: 'Pharmacology, Microbiology, Immunology and Anatomy.', tint: 'gr', onClick: () => onNavigate('qbank_basic', { bankId }) }
      ]
    },
    {
      title: 'Revise',
      cols: 'three',
      items: [
        {
          key: 'review', title: 'Review',
          description: dueCount === null
            ? 'Missed items return after 1, 3, then 7 days.'
            : dueCount > 0 ? `${dueCount} item${dueCount === 1 ? '' : 's'} due today.` : 'Nothing due today.',
          tint: 'am',
          badge: dueCount && dueCount > 0 ? `${dueCount} due` : undefined,
          onClick: () => onNavigate('review', { bankId })
        },
        { key: 'flashcards', title: 'Flashcards', description: 'Flip through quick-recall cards.', tint: 'cy', onClick: () => onNavigate('flashcards', { bankId }) },
        { key: 'most_common', title: 'Most Common', description: 'Fill-in-the-blank review of high-yield facts.', tint: 'am', onClick: () => onNavigate('most_common', { bankId }) }
      ]
    },
    {
      title: 'Learn',
      cols: 'two',
      items: [
        { key: 'smart_first_aid', title: 'Smart First Aid Step1', description: 'Read by part with quizzes, summaries, highlights and bookmarks.', tint: 'vi', onClick: () => onNavigate('smart_first_aid', { bankId }) },
        { key: 'videos', title: 'Videos', description: 'Browse the video library.', tint: 'vi', onClick: () => onNavigate('videos', { bankId }) }
      ]
    }
  ];

  const words = bankLabel.split(' ');
  const firstWords = words.length > 1 ? words.slice(0, -1).join(' ') : bankLabel;
  const lastWord = words.length > 1 ? words[words.length - 1] : '';
  const dur = 1900 * INTRO_SCALE;
  const del = 2000 * INTRO_SCALE;

  let delay = 0.8;
  return (
    <div className={`uj-hub max-w-4xl mx-auto pb-16 ${entered ? 'uj-in' : ''}`}>
      <style>{`
        .uj-hub{--ice:#CFEFF8;--cy:#4FD6EC;--am:#E8B66A;--vi:#B4A8F5;--gr:#6FE0B4;--dim:#93A3B6;--serif:'Instrument Serif',Georgia,'Times New Roman',serif}
        .uj-hub .serif{font-family:var(--serif);font-weight:400;letter-spacing:-.015em}
        .uj-hub .mono{font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase}
        .uj-hub .rise{opacity:0;transform:translateY(16px);transition:opacity 1.1s cubic-bezier(.16,1,.3,1) var(--d,0s),transform 1.1s cubic-bezier(.16,1,.3,1) var(--d,0s)}
        .uj-hub.uj-in .rise{opacity:1;transform:none}
        .uj-hub .ln{display:block;overflow:hidden;padding-bottom:.1em;margin-bottom:-.1em}
        .uj-hub .li{display:block;transform:translateY(108%);transition:transform 1.2s cubic-bezier(.16,1,.3,1) var(--d,0s)}
        .uj-hub.uj-in .li{transform:none}
        .uj-hub .resume{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;max-width:400px;min-height:58px;padding:0 10px 0 22px;border:0;border-radius:16px;background:linear-gradient(180deg,#DDF4FB,#BFE6F2);color:#03131B;font-weight:600;font-size:15px;cursor:pointer;text-align:left;box-shadow:0 14px 50px -14px rgba(79,214,236,.6);transition:transform .25s cubic-bezier(.16,1,.3,1),box-shadow .3s}
        .uj-hub .resume:hover{transform:translateY(-2px);box-shadow:0 20px 60px -12px rgba(79,214,236,.8)}
        .uj-hub .resume:active{transform:scale(.985)}
        .uj-hub .resume .go{width:40px;height:40px;border-radius:12px;background:#03131B;color:var(--ice);display:grid;place-items:center;flex:none}
        .uj-hub .pill{display:inline-flex;align-items:baseline;gap:8px;padding:8px 14px;border-radius:999px;background:rgba(207,239,248,.05);border:1px solid rgba(207,239,248,.12)}
        .uj-hub .pill b{font:400 22px/1 var(--serif);color:var(--ice);font-variant-numeric:tabular-nums}
        .uj-hub .grp{display:flex;align-items:center;gap:12px;margin:34px 4px 12px}
        .uj-hub .grp::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,rgba(190,225,240,.18),transparent)}
        .uj-hub .it{position:relative;display:flex;align-items:center;gap:16px;width:100%;text-align:left;cursor:pointer;color:inherit;padding:18px 20px;border-radius:22px;border:1px solid rgba(207,239,248,.09);background:linear-gradient(160deg,rgba(207,239,248,.055),rgba(207,239,248,.015));transition:transform .35s cubic-bezier(.16,1,.3,1),border-color .3s,background .3s,box-shadow .4s}
        .uj-hub .it:hover{transform:translateY(-3px);border-color:rgba(var(--t),.38);background:linear-gradient(160deg,rgba(var(--t),.10),rgba(207,239,248,.02));box-shadow:0 18px 50px -20px rgba(var(--t),.5)}
        .uj-hub .it:active{transform:scale(.985)}
        .uj-hub .it:focus-visible,.uj-hub .resume:focus-visible{outline:2px solid var(--cy);outline-offset:3px}
        .uj-hub .cy{--t:79,214,236;color:var(--cy)}.uj-hub .am{--t:232,182,106;color:var(--am)}.uj-hub .vi{--t:180,168,245;color:var(--vi)}.uj-hub .gr{--t:111,224,180;color:var(--gr)}
        .uj-hub .orb{flex:none;width:58px;height:58px;border-radius:50%;display:grid;place-items:center;color:rgb(var(--t));background:radial-gradient(circle at 35% 30%,rgba(var(--t),.28),rgba(var(--t),.06) 70%);box-shadow:inset 0 0 0 1px rgba(var(--t),.28),0 0 30px -6px rgba(var(--t),.45);transition:box-shadow .4s,transform .4s cubic-bezier(.16,1,.3,1)}
        .uj-hub .it:hover .orb{transform:scale(1.07);box-shadow:inset 0 0 0 1px rgba(var(--t),.6),0 0 44px -4px rgba(var(--t),.75)}
        .uj-hub .uj-pic{width:30px;height:30px}
        .uj-hub .uj-pic *{vector-effect:non-scaling-stroke}
        .uj-hub .uj-pic .nd{transition:transform .4s cubic-bezier(.16,1,.3,1);transform-box:fill-box;transform-origin:center}
        .uj-hub .it:hover .uj-pic .nd{transform:scale(1.5)}
        .uj-hub .it:hover .uj-pic .dr{animation:uj-redraw .9s cubic-bezier(.16,1,.3,1)}
        @keyframes uj-redraw{from{stroke-dasharray:1;stroke-dashoffset:1}to{stroke-dasharray:1;stroke-dashoffset:0}}
        .uj-hub .tx{min-width:0;color:#EAF1F7}
        .uj-hub .tx h3{margin:0;font:400 25px/1.05 var(--serif);letter-spacing:-.01em}
        .uj-hub .tx p{margin:6px 0 0;font-size:13px;line-height:1.5;color:var(--dim)}
        .uj-hub .chev{margin-left:auto;color:var(--dim);flex:none;transition:transform .3s cubic-bezier(.16,1,.3,1),color .3s}
        .uj-hub .it:hover .chev{transform:translateX(5px);color:var(--ice)}
        .uj-hub .badge{display:inline-flex;align-items:center;gap:6px;margin-left:10px;font:500 10.5px 'Geist Mono',ui-monospace,monospace;letter-spacing:.1em;color:var(--am);vertical-align:middle;text-transform:uppercase}
        .uj-hub .badge i{width:7px;height:7px;border-radius:50%;background:var(--am);box-shadow:0 0 10px rgba(232,182,106,.9);animation:uj-pls 2.2s ease-in-out infinite}
        @keyframes uj-pls{50%{opacity:.3}}
        .uj-hub .list{display:grid;gap:12px;grid-template-columns:minmax(0,1fr)}
        @media (min-width:860px){
          .uj-hub .list.two{grid-template-columns:repeat(2,minmax(0,1fr))}
          .uj-hub .list.three{grid-template-columns:repeat(3,minmax(0,1fr))}
          .uj-hub .list.three .it{flex-direction:column;align-items:flex-start;padding:22px;gap:16px;min-height:200px}
          .uj-hub .list.three .chev{position:absolute;right:18px;top:20px;margin:0}
          .uj-hub .hero.has-net{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:end;gap:36px}
        }
        @media (prefers-reduced-motion:reduce){
          .uj-hub .rise,.uj-hub .li{transition:none;opacity:1;transform:none}
          .uj-hub .badge i{animation:none}
        }
      `}</style>

      <button
        onClick={() => onNavigate('back')}
        className="rise flex items-center gap-1.5 min-h-[44px] text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
        style={rise(0.05)}
      >
        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        <span>Back</span>
      </button>

      {/* Hero */}
      <section className={`hero grid grid-cols-1 gap-5 mt-1 ${showNetwork ? 'has-net' : ''}`}>
        <div>
          <p className="mono rise text-cyan-300" style={rise(0.1)}>Exam bank</p>
          <h1 className="serif mt-2 text-[clamp(46px,13vw,80px)] leading-[.96] text-white">
            <span className="ln"><span className="li" style={rise(0.15)}>{firstWords}</span></span>
            {lastWord && <span className="ln"><span className="li" style={rise(0.29)}><em className="text-[#CFEFF8]">{lastWord}</em></span></span>}
          </h1>
          <p className="rise mt-3 text-[15px] leading-relaxed text-slate-400 max-w-[40ch]" style={rise(0.45)}>Pick what you want to study today.</p>
          {activeBlock && (
            <button className="resume rise mt-5" style={rise(0.6)} onClick={() => onNavigate('question_screen', { blockId: activeBlock.id })}>
              <span>
                <span className="block">Resume block</span>
                <small className="block mono opacity-70 mt-0.5" style={{ fontSize: 11, letterSpacing: '.07em' }}>
                  QUESTION {activeBlock.currentIndex + 1} OF {activeBlock.questionIds.length}
                </small>
              </span>
              <span className="go"><ChevronRight className="w-[18px] h-[18px]" aria-hidden="true" /></span>
            </button>
          )}
        </div>

        {showNetwork && (
          <div className="rise" style={rise(0.5)}>
            <NeuralMap
              nodes={nodes}
              timeScale={INTRO_SCALE}
              showEcg={false}
              fade
              stageClass="h-[230px] lg:h-[330px]"
            />
            {hasData && (
              <div className="flex flex-wrap justify-center gap-2 -mt-1.5 lg:-mt-4">
                <span className="pill"><span className="mono text-slate-500">Accuracy</span><b><CountUp value={stats.accuracyPercentage || 0} duration={dur} delay={del} suffix="%" /></b></span>
                <span className="pill"><span className="mono text-slate-500">Solved</span><b><CountUp value={stats.totalQuestionsSolved || 0} duration={dur} delay={del} /></b></span>
                {dueCount !== null && (
                  <span className="pill"><span className="mono text-slate-500">Due today</span><b><CountUp value={dueCount} duration={dur} delay={del} /></b></span>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {groups.map((g) => {
        const gd = (delay += 0.12);
        return (
          <section key={g.title}>
            <div className="grp rise" style={rise(gd)}><span className="mono text-slate-400">{g.title}</span></div>
            <div className={`list ${g.cols}`}>
              {g.items.map((card) => {
                const d = (delay += 0.07);
                return (
                  <button key={card.key} onClick={card.onClick} className={`it ${card.tint} rise`} style={rise(d)}>
                    <span className="orb">{Pictos[card.key]}</span>
                    <span className="tx">
                      <h3>
                        {card.title}
                        {card.badge && <span className="badge"><i />{card.badge}</span>}
                      </h3>
                      <p>{card.description}</p>
                    </span>
                    <ChevronRight className="chev w-[18px] h-[18px]" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
};
