import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Flame, Repeat, Target, ChevronRight, Loader2 } from 'lucide-react';
import { resolveSession } from '../services/authService';
import { getSubscriptionStatus } from '../services/subscriptionService';
import { getBankPerformance } from '../services/performanceService';
import { startBlock } from '../services/questionBankService';
import { fetchDueReviews } from '../services/reviewService';

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

  const perf = useMemo(() => getBankPerformance(user.telegramId, bankId), [user.telegramId, bankId]);

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

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-16">
      <div className="space-y-4">
        <button onClick={() => onNavigate('home')} className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors">
          <ArrowLeft className="w-4 h-4" /><span>Home</span>
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
                  onClick={() => setBankId(b.id)}
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
          className="w-full glass-panel ujo-card-hover p-4 flex items-center gap-4 text-left border-amber-400/30"
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

      {/* Key numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Accuracy', value: `${perf.accuracy}%`, sub: `${perf.correct} of ${perf.total} correct` },
          { label: 'Questions solved', value: String(perf.total), sub: `${perf.blocksCompleted} completed block${perf.blocksCompleted === 1 ? '' : 's'}` },
          { label: 'Day streak', value: String(perf.streak), sub: perf.streak > 0 ? 'Keep it going' : 'Study today to start', icon: Flame },
          { label: 'Active days', value: String(perf.activeDays), sub: 'in the last 30 days' }
        ].map((t) => (
          <div key={t.label} className="glass-panel p-4">
            <p className="text-[11px] text-slate-500 flex items-center gap-1">
              {t.icon && <t.icon className="w-3 h-3 text-orange-400" />}{t.label}
            </p>
            <p className="text-2xl font-semibold text-white tabular-nums mt-1">{t.value}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{t.sub}</p>
          </div>
        ))}
      </div>

      {!hasData ? (
        <div className="glass-panel p-10 text-center space-y-3">
          <BookOpen className="w-8 h-8 text-slate-600 mx-auto" />
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
          <section className="glass-panel p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">Last 30 days</h2>
              <span className="text-[11px] text-slate-500">Questions per day</span>
            </div>
            <div className="flex items-end gap-[3px] h-28" role="img" aria-label="Questions solved per day over the last 30 days">
              {perf.days.map((d) => {
                const h = d.total === 0 ? 3 : Math.max(8, Math.round((d.total / maxDay) * 100));
                const pct = d.total ? Math.round((d.correct / d.total) * 100) : 0;
                return (
                  <div key={d.key} className="flex-1 h-full flex items-end" title={d.total ? `${d.label}: ${d.total} questions, ${pct}% correct` : `${d.label}: no activity`}>
                    <div
                      className={`w-full rounded-sm ${d.total === 0 ? 'bg-white/[0.06]' : 'bg-cyan-400/80'}`}
                      style={{ height: `${h}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-slate-600">
              <span>{perf.days[0].label}</span>
              <span>{perf.days[perf.days.length - 1].label}</span>
            </div>
          </section>

          {/* By subject */}
          <section className="glass-panel p-5 space-y-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-100">By subject</h2>
              <span className="text-[11px] text-slate-500">Weakest first</span>
            </div>
            <div className="space-y-4">
              {perf.bySubject.map((s) => {
                const t = tone(s.pct);
                return (
                  <div key={s.major} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-slate-200">{s.major}</span>
                      <span className="text-xs text-slate-500 tabular-nums">
                        <span className={`font-semibold ${t.text}`}>{s.pct}%</span> · {s.correct}/{s.total}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                      <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${s.pct}%` }} />
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
                  className="px-4 py-2.5 rounded-xl bg-rose-400 hover:bg-rose-300 text-[#2a0710] text-xs font-bold disabled:opacity-60 flex items-center gap-2"
                >
                  {startingWeak && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Practice {perf.weakest.major}
                </button>
              </div>
            )}
          </section>

          {/* Sessions */}
          <section className="glass-panel overflow-hidden">
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
                  const t = tone(score);
                  const subjects = b.filters?.majors?.length ? b.filters.majors.join(', ') : (b.filters?.major && b.filters.major !== 'All' ? b.filters.major : 'All subjects');
                  return (
                    <div key={b.id} className="px-5 py-3.5 flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-200 truncate">{subjects}</p>
                        <p className="text-xs text-slate-500">{b.questionIds.length} questions · {new Date(b.updatedAt).toLocaleDateString()}</p>
                      </div>
                      <span className={`text-sm font-semibold tabular-nums ${t.text}`}>{score}%</span>
                      <button
                        onClick={() => onNavigate('question_screen', { blockId: b.id, reviewMode: 'all' })}
                        className="px-3 py-1.5 rounded-lg border border-white/[0.1] hover:bg-white/[0.05] text-xs font-medium text-slate-200"
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
