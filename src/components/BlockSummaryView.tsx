import React, { useMemo } from 'react';
import { CheckCircle2, XCircle, HelpCircle, ArrowLeft, RotateCcw, BookOpen, Timer, Zap, Award } from 'lucide-react';
import { Block, Question, BlockAnswer } from '../types';
import { PerfStyles, Ring, Confetti, EcgLine, CountUp, tierFor, formatDuration } from './PerfKit';

interface BlockSummaryViewProps {
  block: Block;
  questions: Question[];
  onReviewBlock: (filterMode?: 'incorrect' | 'all') => void;
  onNavigate: (view: string) => void;
}

const MESSAGES: Record<string, string[]> = {
  excellent: ['Outstanding work. This is exam-ready performance.', 'You crushed this block. Keep this rhythm going.'],
  pass: ['Solid result. A little review on the misses and you are above the bar.', 'Good block. Your weak spots are now easy to see.'],
  warn: ['You are close. Review the explanations and retry in a day.', 'Progress is built from blocks like this one. Review and go again.'],
  low: ['This block shows exactly where to focus. Review each miss carefully.', 'Every miss you review now is a mark saved in the exam.']
};

export const BlockSummaryView: React.FC<BlockSummaryViewProps> = ({ block, questions, onReviewBlock, onNavigate }) => {
  const total = questions.length;
  const answeredList = Object.values(block.answers) as BlockAnswer[];
  const correctCount = answeredList.filter((a) => a.isCorrect).length;
  const incorrectCount = answeredList.filter((a) => !a.isCorrect).length;
  const unansweredCount = Math.max(0, total - answeredList.length);
  const scorePct = block.score ?? (total > 0 ? Math.round((correctCount / total) * 100) : 0);
  const tier = tierFor(scorePct);
  const message = useMemo(() => {
    const list = MESSAGES[tier.key];
    return list[(block.id?.length || 0) % list.length];
  }, [tier.key, block.id]);

  const seconds = block.timeSpentSeconds || 0;
  const avgSec = answeredList.length > 0 && seconds > 0 ? Math.round(seconds / answeredList.length) : 0;

  const qById = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const orderedIds = block.questionIds?.length ? block.questionIds : questions.map((q) => q.id);

  const bySubject = useMemo(() => {
    const m = new Map<string, { total: number; correct: number }>();
    answeredList.forEach((a) => {
      const major = qById.get(a.questionId)?.major || 'Other';
      const s = m.get(major) || { total: 0, correct: 0 };
      s.total += 1;
      if (a.isCorrect) s.correct += 1;
      m.set(major, s);
    });
    return Array.from(m.entries())
      .map(([major, v]) => ({ major, ...v, pct: Math.round((v.correct / v.total) * 100) }))
      .sort((a, b) => a.pct - b.pct || b.total - a.total);
  }, [answeredList, qById]);

  const stats = [
    { label: 'Correct', value: correctCount, icon: CheckCircle2, color: 'text-emerald-400', glow: 'rgba(52,211,153,.25)' },
    { label: 'Incorrect', value: incorrectCount, icon: XCircle, color: 'text-rose-400', glow: 'rgba(251,113,133,.25)' },
    { label: 'Unanswered', value: unansweredCount, icon: HelpCircle, color: 'text-slate-400', glow: 'rgba(148,163,184,.2)' }
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-12">
      <PerfStyles />

      {/* Hero */}
      <div
        className="relative rounded-3xl border border-white/[0.08] p-6 md:p-8 text-center overflow-hidden"
        style={{ background: `radial-gradient(520px 260px at 50% 0%, ${tier.soft}, transparent 70%), #0b1016` }}
      >
        {scorePct >= 65 && <Confetti count={scorePct >= 80 ? 60 : 30} />}

        <div className="pf-rise inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold border"
          style={{ color: tier.color, borderColor: `${tier.color}55`, background: tier.soft }}>
          <Award className="w-3.5 h-3.5" />
          <span>Block Performance Summary</span>
        </div>

        <div className="mt-5 flex flex-col items-center">
          <div className="relative">
            <Ring value={scorePct} size={200} stroke={14} color={tier.color} delay={250}>
              <div className="text-5xl font-black text-white tabular-nums leading-none">
                <CountUp value={scorePct} duration={1500} delay={250} suffix="%" />
              </div>
              <div className="text-[11px] text-slate-400 mt-1.5 tabular-nums">{correctCount}/{total} correct</div>
            </Ring>
            <span
              data-pf-anim
              className="absolute -top-2 -right-2 text-4xl"
              style={{ animation: 'pf-bounce 1.6s ease-in-out 1.4s 2' }}
              aria-hidden="true"
            >
              {tier.emoji}
            </span>
          </div>

          <div className="pf-pop mt-4 inline-block px-4 py-1.5 rounded-full text-xs font-extrabold tracking-wide border"
            style={{ color: tier.color, borderColor: `${tier.color}66`, background: tier.soft, animationDelay: '1.2s' }}>
            {tier.label.toUpperCase()}
          </div>
          <p className="pf-rise mt-3 text-sm text-slate-300 max-w-sm" style={{ animationDelay: '1.4s' }}>{message}</p>
        </div>

        <div className="mt-5 opacity-80"><EcgLine color={tier.color} seconds={scorePct >= 80 ? 2 : scorePct >= 65 ? 3 : 4.5} /></div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s, i) => (
          <div key={s.label} className="pf-rise rounded-2xl bg-[#0e1217] border border-white/[0.07] p-4 text-center" style={{ animationDelay: `${0.15 + i * 0.1}s` }}>
            <div className={`flex items-center justify-center mb-1 ${s.color}`}><s.icon className="w-5 h-5" /></div>
            <div className="text-3xl font-black text-white tabular-nums"><CountUp value={s.value} delay={300 + i * 100} duration={900} /></div>
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Time */}
      {seconds > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="pf-rise rounded-2xl bg-[#0e1217] border border-white/[0.07] p-4 flex items-center gap-3" style={{ animationDelay: '.45s' }}>
            <div className="w-10 h-10 rounded-xl bg-cyan-400/10 text-cyan-300 flex items-center justify-center"><Timer className="w-5 h-5" /></div>
            <div><div className="text-lg font-bold text-white tabular-nums">{formatDuration(seconds)}</div><div className="text-[11px] text-slate-500">Total time</div></div>
          </div>
          <div className="pf-rise rounded-2xl bg-[#0e1217] border border-white/[0.07] p-4 flex items-center gap-3" style={{ animationDelay: '.55s' }}>
            <div className="w-10 h-10 rounded-xl bg-amber-400/10 text-amber-300 flex items-center justify-center"><Zap className="w-5 h-5" /></div>
            <div><div className="text-lg font-bold text-white tabular-nums">{avgSec}s</div><div className="text-[11px] text-slate-500">Avg. per question</div></div>
          </div>
        </div>
      )}

      {/* Question map */}
      <div className="pf-rise rounded-2xl bg-[#0e1217] border border-white/[0.07] p-5 space-y-3" style={{ animationDelay: '.6s' }}>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Question map</h3>
          <div className="flex items-center gap-3 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-emerald-400 inline-block" />Correct</span>
            <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-rose-400 inline-block" />Incorrect</span>
            <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-slate-600 inline-block" />Skipped</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {orderedIds.map((id, i) => {
            const a = block.answers[id];
            const cls = !a ? 'bg-slate-700/60 text-slate-400' : a.isCorrect ? 'bg-emerald-400/90 text-emerald-950' : 'bg-rose-400/90 text-rose-950';
            return (
              <span
                key={id}
                className={`pf-pop w-7 h-7 rounded-md text-[10px] font-bold flex items-center justify-center ${cls}`}
                style={{ animationDelay: `${0.7 + Math.min(i, 60) * 0.018}s` }}
                title={`Q${i + 1}: ${!a ? 'Unanswered' : a.isCorrect ? 'Correct' : 'Incorrect'}`}
              >
                {i + 1}
              </span>
            );
          })}
        </div>
      </div>

      {/* By subject */}
      {bySubject.length > 0 && (
        <div className="pf-rise rounded-2xl bg-[#0e1217] border border-white/[0.07] p-5 space-y-4" style={{ animationDelay: '.7s' }}>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Performance by subject</h3>
          {bySubject.map((s, i) => {
            const t = tierFor(s.pct);
            return (
              <div key={s.major} className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-slate-200">{s.major}</span>
                  <span className="text-xs text-slate-500 tabular-nums"><b style={{ color: t.color }}>{s.pct}%</b> · {s.correct}/{s.total}</span>
                </div>
                <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                  <div data-pf-anim className="h-full rounded-full origin-left"
                    style={{ width: `${s.pct}%`, background: t.color, boxShadow: `0 0 10px ${t.color}`, animation: `pf-fill .9s cubic-bezier(.2,.8,.2,1) ${0.9 + i * 0.1}s both` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div className="pf-rise rounded-2xl bg-[#0e1217] border border-white/[0.07] p-5 space-y-3" style={{ animationDelay: '.8s' }}>
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 pb-2 border-b border-white/[0.06]">What next?</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {incorrectCount > 0 && (
            <button onClick={() => onReviewBlock('incorrect')}
              className="py-3 px-4 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-[.98]">
              <XCircle className="w-4 h-4" /><span>Review Incorrect ({incorrectCount})</span>
            </button>
          )}
          <button onClick={() => onReviewBlock('all')}
            className="py-3 px-4 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-[.98]">
            <BookOpen className="w-4 h-4" /><span>Review All Questions</span>
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <button onClick={() => onNavigate('bank')}
            className="pf-shimmer py-3 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-extrabold flex items-center justify-center gap-2 transition-all shadow-lg shadow-cyan-500/25 active:scale-[.98]">
            <RotateCcw className="w-4 h-4" /><span>Start New Block</span>
          </button>
          <button onClick={() => onNavigate('home')}
            className="py-3 px-4 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] text-slate-200 border border-white/[0.1] text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-[.98]">
            <ArrowLeft className="w-4 h-4" /><span>Return to Home</span>
          </button>
        </div>
      </div>
    </div>
  );
};
