import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, Sparkles } from 'lucide-react';
import { getFlashcards, syncFlashcardsFromSupabase } from '../services/flashcardService';
import { Flashcard } from '../types';

interface MostCommonViewProps {
  onNavigate: (view: string, params?: any) => void;
}

// Most Common is a simple Q&A content set — NOT tied to any question
// bank — reusing the exact same underlying data model as Flashcards
// (cardType: 'most_common'), but displayed with a fill-in-the-blank
// reveal style instead of a flip animation, to feel visually distinct.
export const MostCommonView: React.FC<MostCommonViewProps> = ({ onNavigate }) => {
  const [cards, setCards] = useState<Flashcard[]>(() => getFlashcards('most_common'));
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    syncFlashcardsFromSupabase('most_common')
      .then((synced) => {
        if (synced && synced.length > 0) setCards(synced);
      })
      .catch(() => {});
  }, []);

  const current = cards[index];

  const goNext = () => {
    setRevealed(false);
    setIndex((i) => Math.min(i + 1, Math.max(cards.length - 1, 0)));
  };
  const goPrev = () => {
    setRevealed(false);
    setIndex((i) => Math.max(i - 1, 0));
  };

  if (cards.length === 0) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 pb-12 text-center">
        <button
          onClick={() => onNavigate('home')}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors mx-auto"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <div className="glass-panel p-10 space-y-3">
          <Sparkles className="w-10 h-10 text-amber-400 mx-auto" />
          <h2 className="text-lg font-bold text-slate-100">No Most Common cards yet</h2>
          <p className="text-xs text-slate-400">Your admin hasn't added any Most Common cards yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <button
          onClick={() => onNavigate('home')}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <span className="text-xs font-bold text-slate-500">{index + 1} / {cards.length}</span>
      </div>

      <div className="glass-panel p-6 sm:p-8 space-y-6 border-l-4 border-amber-500">
        <div className="flex items-center gap-2 text-amber-400 text-[11px] font-bold uppercase tracking-widest">
          <Sparkles className="w-4 h-4" />
          <span>Most Common</span>
        </div>

        <p className="text-slate-100 text-base leading-relaxed">{current.question}</p>

        {/* Fill-in-the-blank style: a dashed blank until revealed */}
        <div className="space-y-2">
          <span className="text-slate-400 text-sm">Answer:</span>
          {revealed ? (
            <p className="p-3 rounded-lg bg-emerald-500/15 text-emerald-300 font-medium border border-emerald-500/30 leading-relaxed">
              {current.answer}
            </p>
          ) : (
            <div className="p-3 rounded-lg border-b-2 border-dashed border-slate-600">
              <span className="text-transparent select-none">____________________________________</span>
            </div>
          )}
        </div>

        {!revealed && (
          <button
            onClick={() => setRevealed(true)}
            className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black uppercase tracking-wider text-xs flex items-center justify-center gap-2 transition-all active:scale-95"
          >
            <Eye className="w-4 h-4" />
            <span>Reveal Answer</span>
          </button>
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
          disabled={index >= cards.length - 1}
          className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-30"
        >
          <span>Next</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
