import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart2,
  CreditCard,
  ShieldCheck,
  CheckCircle2,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { resolveSession } from '../services/authService';
import { getSubscriptionStatus, syncSubscriptionFromSupabase } from '../services/subscriptionService';
import { getUserStudyStats } from '../services/progressService';
import { useBlocksSynced } from './useBlocksSynced';
import { getBankPerformance } from '../services/performanceService';
import { getActiveBlockForUser, getQuestionBankMeta, startBlock } from '../services/questionBankService';
import { CountUp } from './PerfKit';
import { NeuralMap, NeuralNode } from './NeuralMap';

interface HomeViewProps {
  onNavigate: (view: string, params?: any) => void;
}

type BankId = 'human_medicine' | 'dentistry';

const BANKS = [
  { id: 'human_medicine', name: 'Human Medicine', shortName: 'Human Medicine', color: 'cyan' as const },
  { id: 'dentistry', name: 'Dentistry', shortName: 'Dentistry', color: 'amber' as const }
];

const INTRO_KEY = 'ujo_home_intro_v1';

// Full cinematic opening on the first visit of a session, a short replay
// afterwards so moving between pages never slows the student down.
const readIntroScale = (): number => {
  try {
    if (typeof sessionStorage === 'undefined') return 1;
    if (sessionStorage.getItem(INTRO_KEY)) return 0.4;
    sessionStorage.setItem(INTRO_KEY, '1');
    return 1;
  } catch {
    return 1;
  }
};

const ARROW = <ArrowRight className="w-[18px] h-[18px]" aria-hidden="true" />;

export const HomeView: React.FC<HomeViewProps> = ({ onNavigate }) => {
  useBlocksSynced();
  const [session, setSession] = useState(resolveSession());
  const user = session.user;

  const [subByBank, setSubByBank] = useState(() => ({
    human_medicine: getSubscriptionStatus(user.telegramId, 'human_medicine'),
    dentistry: getSubscriptionStatus(user.telegramId, 'dentistry')
  }));
  const [syncing, setSyncing] = useState(true);

  useEffect(() => {
    Promise.all([
      syncSubscriptionFromSupabase(user.telegramId, user.username, 'human_medicine'),
      syncSubscriptionFromSupabase(user.telegramId, user.username, 'dentistry')
    ])
      .then(() => {
        setSession(resolveSession());
        setSubByBank({
          human_medicine: getSubscriptionStatus(user.telegramId, 'human_medicine'),
          dentistry: getSubscriptionStatus(user.telegramId, 'dentistry')
        });
      })
      .finally(() => setSyncing(false));
  }, [user.telegramId, user.username]);

  const statsByBank = {
    human_medicine: getUserStudyStats(user.telegramId, 'human_medicine'),
    dentistry: getUserStudyStats(user.telegramId, 'dentistry')
  };

  const activeBlockByBank = {
    human_medicine: getActiveBlockForUser(user.telegramId, 'human_medicine'),
    dentistry: getActiveBlockForUser(user.telegramId, 'dentistry')
  };

  const getDaysRemaining = (bankId: string) => {
    const sub = subByBank[bankId as BankId];
    if (sub.status !== 'ACTIVE' || !sub.expiryDate) return 0;
    const diffMs = new Date(sub.expiryDate).getTime() - Date.now();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  };

  // A subscriber only sees the bank they are subscribed to — a Human
  // Medicine subscriber never gets a Dentistry card and vice versa.
  // Visitors with no active subscription (new, pending, expired) and
  // admins see both banks so they can subscribe / manage.
  const activeBankIds = BANKS.filter((b) => subByBank[b.id as BankId].status === 'ACTIVE').map((b) => b.id);
  const visibleBanks = session.isAdmin || activeBankIds.length === 0
    ? BANKS
    : BANKS.filter((b) => activeBankIds.includes(b.id));

  const firstName = user.firstName && user.firstName !== 'Resident' ? user.firstName : '';

  // The bank the hero speaks for: the subscribed bank (admins default to
  // Human Medicine). Visitors without access get the decorative state.
  const heroBankId: BankId | null = (activeBankIds[0] as BankId | undefined) ?? (session.isAdmin ? 'human_medicine' : null);
  const heroBank = heroBankId ? BANKS.find((b) => b.id === heroBankId)! : null;
  const heroStats = heroBankId ? statsByBank[heroBankId] : null;
  const heroBlock = heroBankId ? activeBlockByBank[heroBankId] : null;

  // The question list is mirrored from the server in the background at app
  // start, so the subjects may arrive a moment after this page opens. Poll
  // the local cache briefly and rebuild the network when they appear.
  const [metaTick, setMetaTick] = useState(0);
  useEffect(() => {
    if (!heroBankId) return;
    let last = -1, tries = 0;
    const read = () => {
      try { return getQuestionBankMeta(heroBankId).majors.length; } catch { return 0; }
    };
    last = read();
    const id = setInterval(() => {
      tries++;
      const n = read();
      if (n !== last) { last = n; setMetaTick((x) => x + 1); }
      if (tries >= 10) clearInterval(id);
    }, 1500);
    return () => clearInterval(id);
  }, [heroBankId]);

  // Real subjects (Majors) of the bank, lit by the student's real accuracy.
  const nodes: NeuralNode[] = useMemo(() => {
    if (!heroBankId) return [];
    const perf = getBankPerformance(user.telegramId, heroBankId);
    const byName = new Map(perf.bySubject.map((s) => [s.major, s]));
    let names: string[] = [];
    try {
      names = getQuestionBankMeta(heroBankId).majors.map((m) => m.name);
    } catch {
      names = [];
    }
    if (names.length === 0) names = perf.bySubject.map((s) => s.major);
    return Array.from(new Set(names)).map((name) => {
      const s = byName.get(name);
      return { id: name, label: name, pct: s ? s.pct : null, total: s ? s.total : 0 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroBankId, user.telegramId, heroStats?.totalQuestionsSolved, metaTick]);

  const decorative = !heroBankId || nodes.length < 3;

  const [introScale] = useState(readIntroScale);
  const [entered, setEntered] = useState(false);
  const [selected, setSelected] = useState<NeuralNode | null>(null);
  const [practicing, setPracticing] = useState(false);

  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setEntered(true); return; }
    const t = setTimeout(() => setEntered(true), 1500 * introScale);
    return () => clearTimeout(t);
  }, [introScale]);

  const skipIntro = () => setEntered(true);
  const onSelect = useCallback((n: NeuralNode | null) => setSelected(n), []);

  const practiceSelected = async () => {
    if (!selected || !heroBankId) return;
    setPracticing(true);
    try {
      const block = await startBlock(
        user.telegramId,
        { bankId: heroBankId, majors: [selected.label], statusFilter: 'ALL', userId: user.telegramId, includeQBankBasic: true, questionCount: 20 },
        heroBankId
      );
      onNavigate('question_screen', { blockId: block.id });
    } catch {
      setPracticing(false);
      onNavigate(heroBankId === 'human_medicine' ? 'specialty_hub' : 'bank', { bankId: heroBankId });
    }
  };

  const anyPending = BANKS.some((b) => subByBank[b.id as BankId].status === 'PENDING');
  const anyExpired = BANKS.some((b) => subByBank[b.id as BankId].status === 'EXPIRED');

  // ---- hero copy + primary action, derived from the real state ----
  let headline: string[];
  let sub: string;
  let cta: React.ReactNode;
  const ctaBase =
    'uj-cta group relative flex items-center justify-between gap-3 w-full min-h-[60px] pl-5 pr-2.5 rounded-[10px] text-left font-semibold text-[16px] overflow-hidden';

  if (heroBank && heroBlock) {
    headline = [`Question ${heroBlock.currentIndex + 1}`, 'is waiting.'];
    sub = `${heroBank.name} · block in progress. Pick up exactly where you stopped.`;
    cta = (
      <button className={ctaBase} onClick={() => onNavigate('question_screen', { blockId: heroBlock.id })}>
        <span>
          <span className="block">Resume block</span>
          <small className="block uj-mono opacity-70 mt-0.5">QUESTION {heroBlock.currentIndex + 1} OF {heroBlock.questionIds.length}</small>
        </span>
        <span className="uj-go">{ARROW}</span>
      </button>
    );
  } else if (heroBank) {
    headline = session.isAdmin && activeBankIds.length === 0 ? ['Every bank,', 'one console.'] : ['Ready when', 'you are.'];
    sub = session.isAdmin && activeBankIds.length === 0
      ? 'You have full access to Human Medicine and Dentistry, plus the admin console.'
      : `${heroBank.name} · choose a block and start practicing.`;
    cta = (
      <button
        className={ctaBase}
        onClick={() => onNavigate(heroBank.id === 'human_medicine' ? 'specialty_hub' : 'bank', { bankId: heroBank.id })}
      >
        <span>
          <span className="block">Open {heroBank.name}</span>
          <small className="block uj-mono opacity-70 mt-0.5">{session.isAdmin ? 'ADMIN ACCESS' : 'QUESTION BANK'}</small>
        </span>
        <span className="uj-go">{ARROW}</span>
      </button>
    );
  } else if (anyPending) {
    headline = ['Almost', 'there.'];
    sub = 'Your payment is being reviewed. You will get a Telegram message as soon as it is approved.';
    cta = (
      <button className={`${ctaBase} uj-cta-quiet`} disabled>
        <span>
          <span className="block">Payment under review</span>
          <small className="block uj-mono opacity-70 mt-0.5">NO ACTION NEEDED</small>
        </span>
        <span className="uj-go"><span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" /></span>
      </button>
    );
  } else if (anyExpired) {
    const expiredBank = BANKS.find((b) => subByBank[b.id as BankId].status === 'EXPIRED')!;
    headline = ['Welcome back.', 'Renew to continue.'];
    sub = 'Your subscription has expired. Your progress is kept and waiting for you.';
    cta = (
      <button className={ctaBase} onClick={() => onNavigate('subscription', { bankId: expiredBank.id })}>
        <span>
          <span className="block">Renew subscription</span>
          <small className="block uj-mono opacity-70 mt-0.5">{expiredBank.name.toUpperCase()}</small>
        </span>
        <span className="uj-go">{ARROW}</span>
      </button>
    );
  } else {
    headline = ['Train like', 'the exam.'];
    sub = 'Choose your exam bank, subscribe, and start your first block.';
    cta = (
      <button className={ctaBase} onClick={() => onNavigate('subscription', { bankId: 'human_medicine' })}>
        <span>
          <span className="block">Subscribe</span>
          <small className="block uj-mono opacity-70 mt-0.5">CHOOSE A BANK</small>
        </span>
        <span className="uj-go">{ARROW}</span>
      </button>
    );
  }

  const quickLinks = [
    { key: 'progress', label: 'Performance', hint: 'Accuracy and progress by subject', icon: BarChart2, onClick: () => onNavigate('progress') },
    { key: 'subscription', label: 'Subscriptions', hint: 'Plans, renewals and payment status', icon: CreditCard, onClick: () => onNavigate('subscription') },
    session.isAdmin
      ? { key: 'admin', label: 'Admin console', hint: 'Users, payments and content', icon: ShieldCheck, onClick: () => onNavigate('admin') }
      : { key: 'done', label: 'Completed blocks', hint: 'Review finished question sets', icon: CheckCircle2, onClick: () => onNavigate('progress') }
  ];

  const rise = (delay: number) => ({ ['--d' as any]: `${delay * introScale}s` });

  return (
    <div className={`uj-home relative pb-16 ${entered ? 'uj-in' : ''}`}>
      <style>{`
        .uj-home{--ice:#CFEFF8;--cy:#4FD6EC;--am:#E3A94F;--hair:rgba(190,225,240,.14);--hair2:rgba(190,225,240,.26);--dim:#8E9DB0;
          --serif:'Instrument Serif',Georgia,'Times New Roman',serif;}
        .uj-serif{font-family:var(--serif);font-weight:400;letter-spacing:-.015em}
        .uj-mono{font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase}
        .uj-rise{opacity:0;transform:translateY(16px);transition:opacity 1s cubic-bezier(.16,1,.3,1) var(--d,0s),transform 1.1s cubic-bezier(.16,1,.3,1) var(--d,0s)}
        .uj-in .uj-rise{opacity:1;transform:none}
        .uj-ln{display:block;overflow:hidden;padding-bottom:.1em;margin-bottom:-.1em}
        .uj-li{display:block;transform:translateY(108%);transition:transform 1.2s cubic-bezier(.16,1,.3,1) var(--d,0s)}
        .uj-in .uj-li{transform:none}
        .uj-curtain{position:fixed;inset:0;z-index:60;pointer-events:none;background:#07090c;opacity:1;transition:opacity .9s ease .1s}
        .uj-curtain::after{content:"";position:absolute;left:0;right:0;top:50%;height:1px;background:linear-gradient(90deg,transparent,#CFEFF8,transparent);transform:scaleX(0);animation:uj-line 1.1s cubic-bezier(.16,1,.3,1) .1s forwards}
        @keyframes uj-line{to{transform:scaleX(1)}}
        .uj-curtain.uj-gone{opacity:0}
        .uj-curtain.uj-gone::after{opacity:0;transition:opacity .4s}
        .uj-cta{background:var(--ice);color:#03131B;border:0;cursor:pointer;
          box-shadow:0 0 0 1px rgba(207,239,248,.55),0 12px 44px -12px rgba(79,214,236,.6);
          transition:transform .18s cubic-bezier(.16,1,.3,1),box-shadow .3s}
        .uj-cta:hover{box-shadow:0 0 0 1px #fff,0 16px 54px -10px rgba(79,214,236,.8)}
        .uj-cta:active{transform:scale(.985)}
        .uj-cta::after{content:"";position:absolute;top:0;bottom:0;left:-40%;width:30%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.65),transparent);transform:skewX(-18deg);transition:left .7s cubic-bezier(.16,1,.3,1)}
        .uj-cta:hover::after{left:120%}
        .uj-go{width:40px;height:40px;border-radius:8px;background:#03131B;color:var(--ice);display:flex;align-items:center;justify-content:center;flex:none}
        .uj-cta-quiet{background:transparent;color:#e6eaf0;box-shadow:inset 0 0 0 1px var(--hair2);cursor:default}
        .uj-cta-quiet::after{display:none}
        .uj-cta-quiet:hover{box-shadow:inset 0 0 0 1px var(--hair2)}
        .uj-cta-quiet .uj-go{background:rgba(207,239,248,.08)}
        .uj-cta:focus-visible,.uj-btn:focus-visible,.uj-row:focus-visible{outline:2px solid var(--cy);outline-offset:3px}
        .uj-reg{position:relative;border:1px solid var(--hair);background:linear-gradient(180deg,rgba(10,19,34,.78),rgba(6,11,20,.78));--c:rgba(207,239,248,.65)}
        .uj-reg::before,.uj-reg::after{content:"";position:absolute;width:10px;height:10px;border:1px solid var(--c);pointer-events:none}
        .uj-reg::before{left:-1px;top:-1px;border-right:0;border-bottom:0}
        .uj-reg::after{right:-1px;bottom:-1px;border-left:0;border-top:0}
        .uj-reg.uj-am{--c:rgba(227,169,79,.85)}
        .uj-btn{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:48px;padding:0 16px;border-radius:9px;border:1px solid var(--hair2);background:transparent;color:#e6eaf0;font-weight:600;font-size:14px;cursor:pointer;transition:background .2s,border-color .2s,transform .18s}
        .uj-btn:hover{background:rgba(207,239,248,.07);border-color:rgba(207,239,248,.5)}
        .uj-btn:active{transform:scale(.985)}
        .uj-btn-cy{background:var(--cy);color:#03141A;border-color:var(--cy)}
        .uj-btn-cy:hover{background:#7fe4f5}
        .uj-btn-am{background:var(--am);color:#2A1A02;border-color:var(--am)}
        .uj-btn-am:hover{background:#efbd6c}
        .uj-bar{height:2px;background:var(--hair);position:relative}
        .uj-bar i{position:absolute;inset:0 auto 0 0;background:var(--cy);box-shadow:0 0 10px rgba(79,214,236,.7)}
        .uj-am .uj-bar i{background:var(--am);box-shadow:0 0 10px rgba(227,169,79,.6)}
        .uj-row{display:flex;align-items:center;gap:14px;width:100%;min-height:64px;padding:0 4px;border:0;border-bottom:1px solid var(--hair);background:none;color:#e6eaf0;text-align:left;cursor:pointer;transition:padding .25s cubic-bezier(.16,1,.3,1),background .2s}
        .uj-row:hover{padding-left:10px;background:linear-gradient(90deg,rgba(79,214,236,.08),transparent)}
        @media (prefers-reduced-motion:reduce){
          .uj-rise,.uj-li{transition:none;opacity:1;transform:none}
          .uj-curtain{display:none}
          .uj-cta::after{display:none}
        }
      `}</style>

      <div className={`uj-curtain ${entered ? 'uj-gone' : ''}`} aria-hidden="true" />
      {!entered && (
        <button
          onClick={skipIntro}
          className="fixed right-4 bottom-4 z-[70] uj-mono text-slate-400 p-3"
        >
          Tap to skip
        </button>
      )}

      {/* Hero */}
      <section className="grid grid-cols-1 lg:grid-cols-[5fr_6fr] gap-2 lg:gap-6 items-center lg:min-h-[560px]">
        <div className="pt-2">
          <p className="uj-mono uj-rise text-cyan-300" style={rise(0.15)}>
            {firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
          </p>
          <h1 className="uj-serif mt-2.5 text-[clamp(44px,12.5vw,84px)] leading-[.96] text-white" style={{ textWrap: 'balance' as any }}>
            {headline.map((l, i) => (
              <span key={l} className="uj-ln">
                <span className="uj-li" style={rise(0.1 + i * 0.14)}>
                  {i === headline.length - 1 ? <em className="text-[#CFEFF8]">{l}</em> : l}
                </span>
              </span>
            ))}
          </h1>
          <p className="uj-rise mt-3.5 max-w-[46ch] text-[15px] leading-relaxed text-slate-400" style={rise(0.5)}>{sub}</p>
          <div className="uj-rise mt-5 max-w-[520px]" style={rise(0.75)}>
            {syncing && !heroBank && !anyPending && !anyExpired ? (
              <div className="flex items-center gap-2 text-xs text-slate-500 min-h-[60px]">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Checking your subscription…</span>
              </div>
            ) : (
              cta
            )}
          </div>
        </div>

        <div className="uj-rise" style={rise(0.45)}>
          <div className="relative">
            <NeuralMap nodes={nodes} decorative={decorative} timeScale={introScale} onSelect={onSelect} />

            {!decorative && heroStats && (
              <>
                <div className="pointer-events-none absolute left-2 top-1 uj-mono text-slate-500 leading-relaxed max-w-[170px]">
                  Each node = a subject<br />Brightness = accuracy<br />Tap a node
                </div>
                <div className="pointer-events-none absolute left-2 bottom-[62px]">
                  <div className="uj-serif tabular-nums text-[64px] leading-none text-[#CFEFF8]">
                    <CountUp value={heroStats.accuracyPercentage || 0} duration={1900 * introScale} delay={2000 * introScale} />
                    <span className="text-[28px] text-slate-500">%</span>
                  </div>
                  <div className="uj-mono text-slate-500 mt-1.5">Accuracy</div>
                </div>
                <div className="pointer-events-none absolute right-2 bottom-[62px] text-right">
                  <div className="uj-serif tabular-nums text-[34px] leading-none text-[#CFEFF8]">
                    <CountUp value={heroStats.totalQuestionsSolved || 0} duration={1900 * introScale} delay={2000 * introScale} />
                  </div>
                  <div className="uj-mono text-slate-500 mt-1.5">Solved</div>
                </div>
              </>
            )}
            {decorative && (
              <div className="pointer-events-none absolute left-2 top-1 uj-mono text-slate-500 leading-relaxed max-w-[170px]">
                Unlocks with<br />a subscription
              </div>
            )}
          </div>

          {!decorative && selected && (
            <div className="mt-2 flex items-center justify-between gap-3 border border-white/10 rounded-lg px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-100 truncate">{selected.label}</p>
                <p className="uj-mono text-slate-500 mt-0.5">
                  {selected.pct == null ? 'Not started yet' : `${selected.pct}% · ${selected.total} answered`}
                </p>
              </div>
              <button
                onClick={practiceSelected}
                disabled={practicing}
                className="shrink-0 min-h-[44px] px-4 rounded-lg bg-cyan-400 hover:bg-cyan-300 disabled:opacity-60 text-[#04202a] text-xs font-bold flex items-center gap-2"
              >
                {practicing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Practice 20</span>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Exam banks */}
      <div className="uj-rise mt-9" style={rise(0.9)}>
        <div className="flex items-center gap-3">
          <span className="uj-mono text-slate-400">{visibleBanks.length === 1 ? 'Your exam bank' : 'Choose your exam bank'}</span>
          <span className="flex-1 h-px bg-white/10" />
        </div>
        <div className={`mt-3.5 grid grid-cols-1 gap-4 ${visibleBanks.length > 1 ? 'md:grid-cols-2' : 'max-w-xl'}`}>
          {visibleBanks.map((bank) => {
            const key = bank.id as BankId;
            const sub = subByBank[key];
            const isActive = sub.status === 'ACTIVE';
            const canEnter = isActive || session.isAdmin;
            const activeBlock = activeBlockByBank[key];
            const stats = statsByBank[key];
            const isAmber = bank.color === 'amber';
            const statusLabel = session.isAdmin ? 'Admin' : isActive ? 'Active' : sub.status === 'PENDING' ? 'Pending' : sub.status === 'EXPIRED' ? 'Expired' : 'Not subscribed';
            const statusColor = session.isAdmin || isActive ? 'text-emerald-300' : sub.status === 'PENDING' ? 'text-amber-300' : 'text-slate-400';
            const acc = Math.min(100, Math.round(stats.accuracyPercentage || 0));

            return (
              <article key={bank.id} className={`uj-reg p-[18px] flex flex-col gap-4 ${isAmber ? 'uj-am' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="uj-serif text-[30px] leading-none text-white">{bank.name}</h2>
                    <p className="uj-mono text-slate-500 mt-2">{isAmber ? '20 JOD · 3 months' : '15 JOD · 3 months'}</p>
                  </div>
                  <span className={`uj-mono inline-flex items-center gap-1.5 shrink-0 ${statusColor}`}>
                    <span className={`w-1.5 h-1.5 rounded-full bg-current ${sub.status === 'PENDING' && !session.isAdmin ? 'animate-pulse' : ''}`} />
                    {statusLabel}
                  </span>
                </div>

                {canEnter ? (
                  <>
                    <div>
                      <div className="flex justify-between uj-mono text-slate-500"><span>Accuracy</span><b className="font-medium text-[#CFEFF8] tabular-nums">{acc}%</b></div>
                      <div className="uj-bar mt-2"><i style={{ width: `${acc}%` }} /></div>
                    </div>
                    <div className="flex justify-between uj-mono text-slate-500"><span>Questions solved</span><b className="font-medium text-[#CFEFF8] tabular-nums">{stats.totalQuestionsSolved || 0}</b></div>
                  </>
                ) : (
                  <p className="text-[13.5px] text-slate-400 leading-relaxed">
                    {sub.status === 'PENDING'
                      ? 'Your payment is being reviewed. You will get a Telegram message as soon as it is approved.'
                      : sub.status === 'EXPIRED'
                      ? 'Your subscription has expired. Renew to keep practicing.'
                      : 'Subscribe to unlock the full question bank, flashcards and study tools.'}
                  </p>
                )}

                {canEnter && activeBlock && bank.id !== heroBankId && (
                  <button
                    onClick={() => onNavigate('question_screen', { blockId: activeBlock.id })}
                    className="uj-btn"
                  >
                    <span className="text-left">
                      <span className="block uj-mono text-slate-500">Continue where you left off</span>
                      <span className="block text-sm font-medium">Question {activeBlock.currentIndex + 1} of {activeBlock.questionIds.length}</span>
                    </span>
                    {ARROW}
                  </button>
                )}

                <div className="mt-auto space-y-2">
                  {canEnter ? (
                    <button
                      onClick={() => onNavigate(bank.id === 'human_medicine' ? 'specialty_hub' : 'bank', { bankId: bank.id })}
                      className={`uj-btn ${isAmber ? 'uj-btn-am' : 'uj-btn-cy'}`}
                    >
                      <span>Open {bank.name}</span>
                      {ARROW}
                    </button>
                  ) : sub.status === 'PENDING' ? (
                    <button className="uj-btn opacity-60 cursor-default" disabled>
                      <span>Awaiting approval</span>
                    </button>
                  ) : (
                    <button onClick={() => onNavigate('subscription', { bankId: bank.id })} className="uj-btn">
                      <span>{sub.status === 'EXPIRED' ? 'Renew subscription' : 'Subscribe'}</span>
                      <CreditCard className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                  {isActive && (
                    <p className="uj-mono text-slate-500 text-center">Expires in {getDaysRemaining(bank.id)} days</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {/* Shortcuts */}
      <nav className="uj-rise mt-7 grid grid-cols-1 md:grid-cols-3 md:gap-x-6" style={rise(1.05)} aria-label="Shortcuts">
        {quickLinks.map((l) => {
          const LIcon = l.icon;
          return (
            <button key={l.key} onClick={l.onClick} className="uj-row">
              <span className="w-[34px] h-[34px] rounded-lg border border-white/20 flex items-center justify-center text-[#CFEFF8] shrink-0">
                <LIcon className="w-[17px] h-[17px]" aria-hidden="true" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-medium text-slate-100">{l.label}</span>
                <span className="block text-xs text-slate-500 truncate">{l.hint}</span>
              </span>
              <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" aria-hidden="true" />
            </button>
          );
        })}
      </nav>
    </div>
  );
};
