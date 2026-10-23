import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Flame, Repeat, Target, ChevronRight, Loader2, TrendingUp, TrendingDown, Minus, Lock, Trophy, Crown } from 'lucide-react';
import { PerfStyles, Ring, EcgLine, CountUp, tierFor } from './PerfKit';
import { resolveSession } from '../services/authService';
import { getSubscriptionStatus } from '../services/subscriptionService';
import { getBankPerformance } from '../services/performanceService';
import { startBlock } from '../services/questionBankService';
import { fetchDueReviews } from '../services/reviewService';
import { useBlocksSynced } from './useBlocksSynced';

interface ProgressViewProps {
  onNavigate: (view: string, params?: any) => void;
}

const BANKS = [
  { id: 'human_medicine', label: 'Human Medicine' },
  { id: 'dentistry', label: 'Dentistry' }
];

const tone = (pct: number) =>
  pct >= 70 ? { bar: 'bg-emerald-400', text: 'text-emerald-300' }
  : pct >= 50 ? { bar: 'bg-amber-400', text: 'text-amber-300' }
  : { bar: 'bg-rose-400', text: 'text-rose-300' };

export const ProgressView: React.FC<ProgressViewProps> = ({ onNavigate }) => {
  const syncTick = useBlocksSynced();
  const session = resolveSession();
  const user = session.user;

  // Same visibility rule as the home page: a subscriber only sees their own bank.
  const visibleBanks = useMemo(() => {
    const active = BANKS.filter((b) => getSubscriptionStatus(user.telegramId, b.id).status === 'ACTIVE');
    return session.isAdmin || active.length === 0 ? BANKS : active;
  }, [user.telegramId, session.isAdmin]);

  const [bankId, setBankId] = useState(visibleBanks[0].id);
  const [dueCount, setDueCount] = useState(0);
  const [startingWeak, setStartingWeak] = useState(false);

  const perf = useMemo(() => getBankPerformance(user.telegramId, bankId), [user.telegramId, bankId, syncTick]);

  useEffect(() => {
    fetchDueReviews(bankId).then((r) => setDueCount(r.due.length)).catch(() => setDueCount(0));
  }, [bankId]);

  const practiceWeakest = async () => {
    if (!perf.weakest) return;
    setStartingWeak(true);
    try {
      const block = await startBlock(
        user.telegramId,
        { bankId, majors: [perf.weakest.major], statusFilter: 'ALL', userId: user.telegramId, includeQBankBasic: true, questionCount: 20 },
        bankId
      );
      onNavigate('question_screen', { blockId: block.id });
    } catch {
      setStartingWeak(false);
      onNavigate(bankId === 'human_medicine' ? 'specialty_hub' : 'bank', { bankId });
    }
  };

  const maxDay = Math.max(1, ...perf.days.map((d) => d.total));
  const bankLabel = BANKS.find((b) => b.id === bankId)?.label || '';
  const hasData = perf.total > 0;
  const [picked, setPicked] = useState<number | null>(null);

  const tier = tierFor(perf.accuracy);

  // Level system based on questions solved
  const LEVELS = [
    { name: 'Intern', min: 0, emoji: '🩺' },
    { name: 'Resident', min: 50, emoji: '💉' },
    { name: 'Specialist', min: 200, emoji: '🧠' },
    { name: 'Consultant', min: 500, emoji: '⭐' },
    { name: 'Professor', min: 1000, emoji: '👑' }
  ];
  const levelIdx = LEVELS.reduce((acc, l, i) => (perf.total >= l.min ? i : acc), 0);
  const level = LEVELS[levelIdx];
  const nextLevel = LEVELS[levelIdx + 1];
  const levelPct = nextLevel ? Math.round(((perf.total - level.min) / (nextLevel.min - level.min)) * 100) : 100;

  // Trend: last 7 days vs the 7 days before
  const trend = useMemo(() => {
    const acc = (slice: typeof perf.days) => {
      const t = slice.reduce((n, d) => n + d.total, 0);
      const c = slice.reduce((n, d) => n + d.correct, 0);
      return t > 0 ? { pct: Math.round((c / t) * 100), total: t } : null;
    };
    const cur = acc(perf.days.slice(-7));
    const prev = acc(perf.days.slice(-14, -7));
    if (!cur) return null;
    return { cur: cur.pct, delta: prev ? cur.pct - prev.pct : null, solved: cur.total };
  }, [perf.days]);

  const strongest = perf.bySubject.length > 1 ? [...perf.bySubject].filter((s) => s.total >= 5).sort((a, b) => b.pct - a.pct)[0] : null;

  const achievements = [
    { id: 'q50', label: 'First 50', desc: 'Solve 50 questions', icon: '🎯', done: perf.total >= 50 },
    { id: 'q250', label: 'Grinder', desc: 'Solve 250 questions', icon: '⚡', done: perf.total >= 250 },
    { id: 'q1000', label: 'Marathon', desc: 'Solve 1000 questions', icon: '🏔️', done: perf.total >= 1000 },
    { id: 's3', label: 'On fire', desc: '3-day streak', icon: '🔥', done: perf.streak >= 3 },
    { id: 's7', label: 'Unstoppable', desc: '7-day streak', icon: '🚀', done: perf.streak >= 7 },
    { id: 'acc', label: 'Sharp mind', desc: '80%+ accuracy (50+ Qs)', icon: '🧬', done: perf.total >= 50 && perf.accuracy >= 80 },
    { id: 'b10', label: 'Block master', desc: 'Complete 10 blocks', icon: '🏆', done: perf.blocksCompleted >= 10 },
    { id: 'days', label: 'Consistent', desc: '15 active days / 30', icon: '📅', done: perf.activeDays >= 15 }
  ];
  const unlocked = achievements.filter((a) => a.done).length;

  const dayTone = (d: { total: number; correct: number }) => {
    if (d.total === 0) return 'rgba(255,255,255,0.06)';
    return tierFor(Math.round((d.correct / d.total) * 100)).color;
  };
  const sel = picked !== null ? perf.days[picked] : null;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16">
      <PerfStyles />
      <div className="space-y-4">
        <button onClick={() => onNavigate('back')} className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors">
          <ArrowLeft className="w-4 h-4" /><span>Back</span>
        </button>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-semibold tracking-tight text-white">Performance</h1>
            <p className="text-sm text-slate-400">How you are doing in {bankLabel}.</p>
          </div>
          {visibleBanks.length > 1 && (
            <div className="inline-flex p-1 rounded-xl bg-white/[0.04] border border-white/[0.06]">
              {visibleBanks.map((b) => (
                <button
                  key={b.id}
                  onClick={() => { setBankId(b.id); setPicked(null); }}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    bankId === b.id ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Spaced-repetition nudge */}
      {bankId === 'human_medicine' && dueCount > 0 && (
        <button
          onClick={() => onNavigate('review', { bankId })}
          className="pf-rise w-full glass-panel ujo-card-hover p-4 flex items-center gap-4 text-left border-amber-400/30"
          style={{ ['--pf-glow' as any]: 'rgba(251,191,36,.35)', animation: 'pf-rise .6s both, pf-pulse 2.4s ease-in-out 1s infinite' }}
        >
          <div className="w-10 h-10 rounded-xl bg-amber-400/10 border border-amber-400/25 text-amber-300 flex items-center justify-center shrink-0">
            <Repeat className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">{dueCount} item{dueCount === 1 ? '' : 's'} due for review today</p>
            <p className="text-xs text-slate-400">Questions and cards you missed are ready to be revised.</p>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
        </button>
      )}

      {/* Hero */}
      <div
        className="relative rounded-3xl border border-white/[0.08] p-6 md:p-8 overflow-hidden"
        style={{ background: `radial-gradient(600px 280px at 20% 0%, ${hasData ? tier.soft : 'rgba(100,116,139,.12)'}, transparent 70%), #0b1016` }}
      >
        <div className="flex flex-col md:flex-row items-center gap-8">
          <Ring value={perf.accuracy} size={190} stroke={14} color={hasData ? tier.color : '#475569'}>
            <div className="text-5xl font-black text-white tabular-nums leading-none">
              <CountUp value={perf.accuracy} suffix="%" delay={200} duration={1400} />
            </div>
            <div className="text-[11px] text-slate-400 mt-1.5">overall accuracy</div>
          </Ring>

          <div className="flex-1 w-full space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="pf-pop flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-white/[0.05] border border-white/[0.09]">
                <span className="text-2xl" style={{ animation: 'pf-float 2.6s ease-in-out infinite' }}>{level.emoji}</span>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Level {levelIdx + 1}</div>
                  <div className="text-sm font-bold text-white leading-tight">{level.name}</div>
                </div>
              </div>
              <div className="pf-pop flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-orange-400/[0.08] border border-orange-400/25" style={{ animationDelay: '.15s' }}>
                <Flame className="w-6 h-6 text-orange-400" style={{ animation: perf.streak > 0 ? 'pf-flame 1.4s ease-in-out infinite' : undefined }} />
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-orange-300/70">Day streak</div>
                  <div className="text-sm font-bold text-white leading-tight tabular-nums"><CountUp value={perf.streak} delay={300} duration={900} /> {perf.streak === 1 ? 'day' : 'days'}</div>
                </div>
              </div>
              {trend && (
                <div className="pf-pop flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-white/[0.05] border border-white/[0.09]" style={{ animationDelay: '.3s' }}>
                  {trend.delta === null ? <Minus className="w-5 h-5 text-slate-400" /> : trend.delta >= 0 ? <TrendingUp className="w-5 h-5 text-emerald-400" /> : <TrendingDown className="w-5 h-5 text-rose-400" />}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">This week</div>
                    <div className="text-sm font-bold text-white leading-tight tabular-nums">
                      {trend.cur}%{trend.delta !== null && <span className={`ml-1 text-xs ${trend.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{trend.delta >= 0 ? '+' : ''}{trend.delta}</span>}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>{nextLevel ? `${perf.total} / ${nextLevel.min} questions to ${nextLevel.name}` : 'Top level reached'}</span>
                <span className="tabular-nums">{levelPct}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-white/[0.07] overflow-hidden">
                <div data-pf-anim className="pf-shimmer h-full rounded-full origin-left"
                  style={{ width: `${levelPct}%`, backgroundColor: '#22d3ee', animation: 'pf-fill 1.2s cubic-bezier(.2,.8,.2,1) .4s both, pf-shimmer 2.4s linear infinite' }} />
              </div>
            </div>
          </div>
        </div>
        <div className="mt-6 opacity-70"><EcgLine color={hasData ? tier.color : '#475569'} seconds={hasData ? (perf.accuracy >= 80 ? 2 : perf.accuracy >= 60 ? 3 : 4.5) : 7} /></div>
      </div>

      {/* Key numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Accuracy', value: perf.accuracy, suffix: '%', sub: `${perf.correct} of ${perf.total} correct` },
          { label: 'Questions solved', value: perf.total, suffix: '', sub: `${perf.blocksCompleted} completed block${perf.blocksCompleted === 1 ? '' : 's'}` },
          { label: 'Day streak', value: perf.streak, suffix: '', sub: perf.streak > 0 ? 'Keep it going' : 'Study today to start', icon: Flame },
          { label: 'Active days', value: perf.activeDays, suffix: '', sub: 'in the last 30 days' }
        ].map((t, i) => (
          <div key={t.label} className="pf-rise glass-panel p-4" style={{ animationDelay: `${0.1 + i * 0.08}s` }}>
            <p className="text-[11px] text-slate-500 flex items-center gap-1">
              {t.icon && <t.icon className="w-3 h-3 text-orange-400" />}{t.label}
            </p>
            <p className="text-2xl font-semibold text-white tabular-nums mt-1"><CountUp value={t.value} suffix={t.suffix} delay={200 + i * 80} duration={1000} /></p>
            <p className="text-[11px] text-slate-500 mt-0.5">{t.sub}</p>
          </div>
        ))}
      </div>

      {!hasData ? (
        <div className="glass-panel p-10 text-center space-y-3">
          <BookOpen className="w-8 h-8 text-slate-600 mx-auto" style={{ animation: 'pf-float 3s ease-in-out infinite' }} />
          <h2 className="text-base font-semibold text-slate-100">No answers yet in {bankLabel}</h2>
          <p className="text-xs text-slate-400">Solve a few questions and your breakdown will appear here.</p>
          <button
            onClick={() => onNavigate(bankId === 'human_medicine' ? 'specialty_hub' : 'bank', { bankId })}
            className="px-5 py-2.5 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-[#04202a] text-xs font-bold"
          >
            Start practicing
          </button>
        </div>
      ) : (
        <>
          {/* Last 30 days */}
          <section className="pf-rise glass-panel p-5 space-y-4" style={{ animationDelay: '.3s' }}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">Last 30 days</h2>
              <span className="text-[11px] text-slate-500">Height = questions · Color = accuracy</span>
            </div>
            <div className="flex items-end gap-[3px] h-32" role="img" aria-label="Questions solved per day over the last 30 days">
              {perf.days.map((d, i) => {
                const h = d.total === 0 ? 3 : Math.max(8, Math.round((d.total / maxDay) * 100));
                const isToday = i === perf.days.length - 1;
                return (
                  <button
                    key={d.key}
                    onClick={() => setPicked(picked === i ? null : i)}
                    className="flex-1 h-full flex items-end group outline-none"
                    aria-label={d.total ? `${d.label}: ${d.total} questions` : `${d.label}: no activity`}
                  >
                    <div
                      data-pf-anim
                      className={`w-full rounded-sm origin-bottom transition-all group-hover:brightness-125 ${picked === i ? 'ring-2 ring-white/70' : ''}`}
                      style={{
                        height: `${h}%`,
                        background: dayTone(d),
                        boxShadow: d.total && isToday ? `0 0 12px ${dayTone(d)}` : undefined,
                        animation: `pf-grow .7s cubic-bezier(.2,.8,.2,1) ${0.35 + i * 0.025}s both`
                      }}
                    />
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-slate-600">
              <span>{perf.days[0].label}</span>
              <span>{perf.days[perf.days.length - 1].label}</span>
            </div>
            <div className="min-h-[1.25rem] text-xs text-slate-300">
              {sel
                ? sel.total
                  ? <span><b className="text-white">{sel.label}</b> · {sel.total} questions · <b style={{ color: tierFor(Math.round((sel.correct / sel.total) * 100)).color }}>{Math.round((sel.correct / sel.total) * 100)}%</b> correct</span>
                  : <span><b className="text-white">{sel.label}</b> · no activity</span>
                : <span className="text-slate-500">Tap a bar to see that day.</span>}
            </div>
          </section>

          {/* By subject */}
          <section className="pf-rise glass-panel p-5 space-y-5" style={{ animationDelay: '.4s' }}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-100">By subject</h2>
              <span className="text-[11px] text-slate-500">Weakest first</span>
            </div>
            <div className="space-y-4">
              {perf.bySubject.map((s, i) => {
                const t = tierFor(s.pct);
                const isStrong = strongest && strongest.major === s.major;
                return (
                  <div key={s.major} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-slate-200 flex items-center gap-1.5">
                        {s.major}
                        {isStrong && <span className="inline-flex items-center gap-1 text-[10px] text-amber-300 bg-amber-400/10 border border-amber-400/25 rounded-full px-1.5 py-0.5"><Crown className="w-3 h-3" />Best</span>}
                      </span>
                      <span className="text-xs text-slate-500 tabular-nums">
                        <span className="font-semibold" style={{ color: t.color }}>{s.pct}%</span> · {s.correct}/{s.total}
                      </span>
                    </div>
                    <div className="h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
                      <div data-pf-anim className="h-full rounded-full origin-left"
                        style={{ width: `${s.pct}%`, background: t.color, boxShadow: `0 0 10px ${t.color}`, animation: `pf-fill 1s cubic-bezier(.2,.8,.2,1) ${0.5 + i * 0.09}s both` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {perf.weakest && (
              <div className="rounded-xl border border-rose-400/25 bg-rose-400/[0.06] p-4 flex flex-wrap items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-rose-400/10 text-rose-300 flex items-center justify-center shrink-0">
                  <Target className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-[12rem]">
                  <p className="text-sm font-semibold text-white">Weakest: {perf.weakest.major} ({perf.weakest.pct}%)</p>
                  <p className="text-xs text-slate-400">A focused 20-question block on this subject is the fastest way to improve.</p>
                </div>
                <button
                  onClick={practiceWeakest}
                  disabled={startingWeak}
                  className="px-4 py-2.5 rounded-xl bg-rose-400 hover:bg-rose-300 text-[#2a0710] text-xs font-bold disabled:opacity-60 flex items-center gap-2 active:scale-[.98]"
                >
                  {startingWeak && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Practice {perf.weakest.major}
                </button>
              </div>
            )}
          </section>

          {/* Achievements */}
          <section className="pf-rise glass-panel p-5 space-y-4" style={{ animationDelay: '.5s' }}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2"><Trophy className="w-4 h-4 text-amber-300" />Achievements</h2>
              <span className="text-[11px] text-slate-500 tabular-nums">{unlocked}/{achievements.length} unlocked</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {achievements.map((a, i) => (
                <div
                  key={a.id}
                  className={`pf-pop relative rounded-2xl border p-3 text-center ${a.done ? 'border-amber-400/30 bg-amber-400/[0.07]' : 'border-white/[0.06] bg-white/[0.02] opacity-60'}`}
                  style={{ animationDelay: `${0.6 + i * 0.07}s` }}
                >
                  <div className="text-2xl" style={a.done ? { animation: 'pf-float 3s ease-in-out infinite' } : { filter: 'grayscale(1)' }}>{a.icon}</div>
                  <div className="text-xs font-semibold text-white mt-1">{a.label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{a.desc}</div>
                  {!a.done && <Lock className="w-3 h-3 text-slate-600 absolute top-2 right-2" />}
                </div>
              ))}
            </div>
          </section>

          {/* Sessions */}
          <section className="pf-rise glass-panel overflow-hidden" style={{ animationDelay: '.6s' }}>
            <div className="px-5 py-4 flex items-center justify-between border-b border-white/[0.06]">
              <h2 className="text-sm font-semibold text-slate-100">Completed blocks</h2>
              <span className="text-[11px] text-slate-500">{perf.sessions.length} total</span>
            </div>
            {perf.sessions.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs text-slate-500">Finish a block to see it here.</p>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {perf.sessions.slice(0, 15).map((b) => {
                  const score = typeof b.score === 'number' ? b.score : 0;
                  const t = tierFor(score);
                  const subjects = b.filters?.majors?.length ? b.filters.majors.join(', ') : (b.filters?.major && b.filters.major !== 'All' ? b.filters.major : 'All subjects');
                  return (
                    <div key={b.id} className="px-5 py-3.5 flex items-center gap-4 hover:bg-white/[0.02] transition-colors">
                      <Ring value={score} size={44} stroke={5} color={t.color} delay={400}>
                        <span className="text-[10px] font-bold text-white tabular-nums">{score}</span>
                      </Ring>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-200 truncate">{subjects}</p>
                        <p className="text-xs text-slate-500">{b.questionIds.length} questions · {new Date(b.updatedAt).toLocaleDateString()}</p>
                      </div>
                      <span className="hidden sm:inline text-[10px] font-bold px-2 py-1 rounded-full border" style={{ color: t.color, borderColor: `${t.color}55`, background: t.soft }}>{t.label}</span>
                      <button
                        onClick={() => onNavigate('question_screen', { blockId: b.id, reviewMode: 'all' })}
                        className="px-3 py-1.5 rounded-lg border border-white/[0.1] hover:bg-white/[0.05] text-xs font-medium text-slate-200 active:scale-[.97]"
                      >
                        Review
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};
