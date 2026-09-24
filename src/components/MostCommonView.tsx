import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, Sparkles } from 'lucide-react';
import { getStoredQuestions, syncQuestionsWithSupabase } from '../services/questionBankService';
import { Question } from '../types';

interface MostCommonViewProps {
  bankId: string;
  onNavigate: (view: string, params?: any) => void;
}

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E'] as const;

// Deliberately styled differently from FlashcardsView's 3D flip card:
// no rotation, no "front/back" — instead the question stem is shown with
// the correct option blanked out (fill-in-the-blank style), and a single
// tap reveals it in place along with a short explanation.
export const MostCommonView: React.FC<MostCommonViewProps> = ({ bankId, onNavigate }) => {
  const [questions, setQuestions] = useState<Question[]>(() =>
    getStoredQuestions().filter((q) => q.bankId === bankId && q.isMostCommon)
  );
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    syncQuestionsWithSupabase()
      .then((synced) => {
        if (synced && synced.length > 0) {
          setQuestions(synced.filter((q) => q.bankId === bankId && q.isMostCommon));
        }
      })
      .catch(() => {});
  }, [bankId]);

  const current = questions[index];

  const optionText = useMemo(() => {
    if (!current) return '';
    const key = current.correctAnswer;
    return (current.options as any)[key] || '';
  }, [current]);

  const goNext = () => {
    setRevealed(false);
    setIndex((i) => Math.min(i + 1, Math.max(questions.length - 1, 0)));
  };
  const goPrev = () => {
    setRevealed(false);
    setIndex((i) => Math.max(i - 1, 0));
  };

  if (questions.length === 0) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 pb-12 text-center">
        <button
          onClick={() => onNavigate('specialty_hub', { bankId })}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors mx-auto"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <div className="glass-panel p-10 space-y-3">
          <Sparkles className="w-10 h-10 text-amber-400 mx-auto" />
          <h2 className="text-lg font-bold text-slate-100">No Most Common items yet</h2>
          <p className="text-xs text-slate-400">Your admin hasn't marked any questions as "Most Common" for this bank yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <button
          onClick={() => onNavigate('specialty_hub', { bankId })}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <span className="text-xs font-bold text-slate-500">{index + 1} / {questions.length}</span>
      </div>

      <div className="glass-panel p-6 sm:p-8 space-y-6 border-l-4 border-amber-500">
        <div className="flex items-center gap-2 text-amber-400 text-[11px] font-bold uppercase tracking-widest">
          <Sparkles className="w-4 h-4" />
          <span>Most Common</span>
        </div>

        <p className="text-slate-100 text-base leading-relaxed">{current.question}</p>

        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="text-slate-400">Answer:</span>
          {revealed ? (
            <span className="px-3 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 font-bold border border-emerald-500/30">
              {OPTION_LABELS.find((k) => k === current.correctAnswer)}. {optionText}
            </span>
          ) : (
            <span className="px-6 py-1 rounded-lg border-b-2 border-dashed border-slate-600 text-transparent select-none">
              ____________________
            </span>
          )}
        </div>

        {!revealed ? (
          <button
            onClick={() => setRevealed(true)}
            className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black uppercase tracking-wider text-xs flex items-center justify-center gap-2 transition-all active:scale-95"
          >
            <Eye className="w-4 h-4" />
            <span>Reveal Answer</span>
          </button>
        ) : (
          current.explanation && (
            <div className="p-4 rounded-xl bg-white/5 border border-white/5 text-xs text-slate-300 leading-relaxed">
              {current.explanation}
            </div>
          )
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={goPrev}
          disabled={index === 0}
          className="flex-1 py-3 rounded-xl glass-panel border border-white/10 text-slate-300 font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-30"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Previous</span>
        </button>
        <button
          onClick={goNext}
          disabled={index >= questions.length - 1}
          className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-30"
        >
          <span>Next</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
