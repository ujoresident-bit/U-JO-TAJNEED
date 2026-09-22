import React from 'react';
import { Award, CheckCircle2, XCircle, HelpCircle, ArrowLeft, RotateCcw, BookOpen } from 'lucide-react';
import { Block, Question, BlockAnswer } from '../types';

interface BlockSummaryViewProps {
  block: Block;
  questions: Question[];
  onReviewBlock: (filterMode?: 'incorrect' | 'all') => void;
  onNavigate: (view: string) => void;
}

export const BlockSummaryView: React.FC<BlockSummaryViewProps> = ({
  block,
  questions,
  onReviewBlock,
  onNavigate
}) => {
  const total = questions.length;
  const answeredList = Object.values(block.answers) as BlockAnswer[];
  const correctCount = answeredList.filter((a) => a.isCorrect).length;
  const incorrectCount = answeredList.filter((a) => !a.isCorrect).length;
  const unansweredCount = total - answeredList.length;

  const scorePct = block.score ?? (total > 0 ? Math.round((correctCount / total) * 100) : 0);

  const getScoreBadge = () => {
    if (scorePct >= 80) return { label: 'High Pass', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' };
    if (scorePct >= 65) return { label: 'Pass', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' };
    return { label: 'Needs Review', color: 'text-rose-400 bg-rose-500/10 border-rose-500/30' };
  };

  const badge = getScoreBadge();

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-12">
      {/* Header Banner */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 md:p-8 text-center space-y-4 shadow-xl relative overflow-hidden">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-semibold">
          <Award className="w-4 h-4" />
          <span>Block Performance Summary</span>
        </div>

        {/* Big Radial/Card Score */}
        <div className="space-y-2">
          <div className="text-5xl font-black text-slate-100 tracking-tight">
            {scorePct}%
          </div>
          <div className={`inline-block px-3 py-1 rounded-full text-xs font-bold border ${badge.color}`}>
            {badge.label}
          </div>
        </div>

        <p className="text-xs text-slate-400">
          You answered <strong className="text-emerald-400">{correctCount}</strong> out of{' '}
          <strong className="text-slate-200">{total}</strong> questions correctly.
        </p>
      </div>

      {/* Metrics Breakdown */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 text-center space-y-1">
          <div className="flex items-center justify-center text-emerald-400 mb-1">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="text-2xl font-black text-slate-100">{correctCount}</div>
          <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
            Correct
          </div>
        </div>

        <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 text-center space-y-1">
          <div className="flex items-center justify-center text-rose-400 mb-1">
            <XCircle className="w-5 h-5" />
          </div>
          <div className="text-2xl font-black text-slate-100">{incorrectCount}</div>
          <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
            Incorrect
          </div>
        </div>

        <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 text-center space-y-1">
          <div className="flex items-center justify-center text-slate-400 mb-1">
            <HelpCircle className="w-5 h-5" />
          </div>
          <div className="text-2xl font-black text-slate-100">{unansweredCount}</div>
          <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
            Unanswered
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-5 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 pb-2 border-b border-slate-800">
          Review Actions
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {incorrectCount > 0 && (
            <button
              onClick={() => onReviewBlock('incorrect')}
              className="py-3 px-4 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold flex items-center justify-center gap-2 transition-all"
            >
              <XCircle className="w-4 h-4 text-rose-400" />
              <span>Review Incorrect ({incorrectCount})</span>
            </button>
          )}

          <button
            onClick={() => onReviewBlock('all')}
            className="py-3 px-4 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-bold flex items-center justify-center gap-2 transition-all"
          >
            <BookOpen className="w-4 h-4 text-cyan-400" />
            <span>Review All Questions</span>
          </button>
        </div>

        <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => onNavigate('bank')}
            className="py-3 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-extrabold flex items-center justify-center gap-2 transition-all shadow-md shadow-cyan-500/20"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Start New Block</span>
          </button>

          <button
            onClick={() => onNavigate('home')}
            className="py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center justify-center gap-2 transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Home</span>
          </button>
        </div>
      </div>
    </div>
  );
};
