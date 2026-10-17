import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, RotateCcw, CheckCircle2, XCircle, Loader2, Repeat } from 'lucide-react';
import { fetchDueReviews, recordReview, DueReviewItem } from '../services/reviewService';
import { getStoredQuestions } from '../services/questionBankService';
import { getFlashcards, syncFlashcardsFromSupabase } from '../services/flashcardService';
import { Flashcard, OptionKey, Question } from '../types';

interface ReviewViewProps {
  bankId: string;
  onNavigate: (view: string, params?: any) => void;
}

type ReviewEntry =
  | { kind: 'question'; id: string; question: Question }
  | { kind: 'flashcard'; id: string; card: Flashcard };

// Daily spaced-repetition session: everything the student previously got
// wrong that is now due (1 day → 3 days → 7 days), questions and flashcards.
export const ReviewView: React.FC<ReviewViewProps> = ({ bankId, onNavigate }) => {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<ReviewEntry[]>([]);
  const [totalQueued, setTotalQueued] = useState(0);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<OptionKey | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [answeredThisCard, setAnsweredThisCard] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    (async () => {
      const { due, totalQueued: queued } = await fetchDueReviews(bankId);
      setTotalQueued(queued);
      // Make sure local flashcard caches are fresh before mapping ids.
      await Promise.all([
        syncFlashcardsFromSupabase('flashcard').catch(() => {}),
        syncFlashcardsFromSupabase('most_common').catch(() => {})
      ]);
      const questionsById = new Map(getStoredQuestions().map((q) => [q.id, q]));
      const cardsById = new Map<string, Flashcard>();
      [...getFlashcards('flashcard'), ...getFlashcards('most_common')].forEach((c) => cardsById.set(c.id, c));

      const built: ReviewEntry[] = [];
      due.forEach((d: DueReviewItem) => {
        if (d.itemType === 'question') {
          const q = questionsById.get(d.itemId);
          if (q) built.push({ kind: 'question', id: d.itemId, question: q });
        } else {
          const c = cardsById.get(d.itemId);
          if (c) built.push({ kind: 'flashcard', id: d.itemId, card: c });
        }
      });
      setEntries(built);
      setLoading(false);
    })();
  }, [bankId]);

  const current = entries[index];

  const advance = () => {
    if (index + 1 >= entries.length) {
      setFinished(true);
      return;
    }
    setIndex(index + 1);
    setPicked(null);
    setFlipped(false);
    setAnsweredThisCard(false);
  };

  const answerQuestion = (key: OptionKey) => {
    if (!current || current.kind !== 'question' || answeredThisCard) return;
    const ok = key === current.question.correctAnswer;
    setPicked(key);
    setAnsweredThisCard(true);
    if (ok) setCorrectCount((c) => c + 1);
    recordReview('question', current.id, ok, current.question.bankId || bankId);
  };

  const answerCard = (ok: boolean) => {
    if (!current || current.kind !== 'flashcard') return;
    if (ok) setCorrectCount((c) => c + 1);
    recordReview('flashcard', current.id, ok, bankId);
    advance();
  };

  const header = (
    <button
      onClick={() => onNavigate('specialty_hub', { bankId })}
      className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
    >
      <ChevronLeft className="w-4 h-4" />
      <span>Back</span>
    </button>
  );

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center text-slate-500 text-sm flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading your review...
      </div>
    );
  }

  if (entries.length === 0 || finished) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 pb-12">
        {header}
        <div className="glass-panel p-10 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          {finished ? (
            <>
              <h2 className="text-lg font-bold text-slate-100">Review complete</h2>
              <p className="text-xs text-slate-400">
                You got {correctCount} of {entries.length} right. Missed items come back tomorrow; correct ones move to a longer interval.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-bold text-slate-100">Nothing due right now</h2>
              <p className="text-xs text-slate-400">
                {totalQueued > 0
                  ? `${totalQueued} item${totalQueued === 1 ? '' : 's'} are scheduled for later. Come back when they're due.`
                  : 'Questions and flashcards you miss will show up here automatically — after 1 day, then 3 days, then 7 days.'}
              </p>
            </>
          )}
          <button
            onClick={() => onNavigate('specialty_hub', { bankId })}
            className="mt-2 px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  const progressPct = Math.round((index / entries.length) * 100);

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-12">
      <div className="flex items-center justify-between">
        {header}
        <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
          <Repeat className="w-3.5 h-3.5" /> {index + 1} / {entries.length}
        </span>
      </div>
      <div className="h-1 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full bg-cyan-400 transition-all" style={{ width: `${progressPct}%` }} />
      </div>

      {current.kind === 'question' ? (
        <div className="glass-panel p-5 space-y-4">
          <p className="text-sm text-slate-100 leading-relaxed whitespace-pre-wrap">{current.question.question}</p>
          <div className="space-y-2">
            {(['A', 'B', 'C', 'D', 'E'] as OptionKey[])
              .filter((k) => Boolean(current.question.options[k]))
              .map((k) => {
                const isCorrect = k === current.question.correctAnswer;
                const isPicked = picked === k;
                let cls = 'border-white/10 text-slate-200 hover:bg-white/5';
                if (answeredThisCard && isCorrect) cls = 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100';
                else if (answeredThisCard && isPicked) cls = 'border-rose-500/60 bg-rose-500/10 text-rose-100';
                return (
                  <button
                    key={k}
                    onClick={() => answerQuestion(k)}
                    disabled={answeredThisCard}
                    className={`w-full text-left px-4 py-3 rounded-xl border text-xs flex items-start gap-3 transition-colors ${cls}`}
                  >
                    <span className="font-bold shrink-0">{k}.</span>
                    <span className="flex-1">{current.question.options[k]}</span>
                    {answeredThisCard && isCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                    {answeredThisCard && isPicked && !isCorrect && <XCircle className="w-4 h-4 text-rose-400 shrink-0" />}
                  </button>
                );
              })}
          </div>
          {answeredThisCard && (
            <>
              {current.question.explanation && (
                <div className="p-3.5 rounded-xl bg-white/5 text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                  {current.question.explanation}
                </div>
              )}
              <button onClick={advance} className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold">
                {index + 1 >= entries.length ? 'Finish' : 'Next'}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <button
            onClick={() => setFlipped((f) => !f)}
            className="w-full glass-panel p-8 min-h-[16rem] text-center flex flex-col items-center justify-center gap-3"
          >
            <span className={`text-[10px] font-bold uppercase tracking-widest ${flipped ? 'text-emerald-400' : 'text-cyan-400'}`}>
              {flipped ? 'Answer' : 'Question — tap to reveal'}
            </span>
            <p className={`text-base sm:text-lg leading-relaxed whitespace-pre-wrap ${flipped ? 'text-emerald-100 font-semibold' : 'text-slate-100 font-medium'}`}>
              {flipped ? current.card.answer : current.card.question}
            </p>
          </button>
          {flipped ? (
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => answerCard(false)} className="py-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs font-bold flex items-center justify-center gap-1.5">
                <RotateCcw className="w-4 h-4" /> Missed it
              </button>
              <button onClick={() => answerCard(true)} className="py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 text-xs font-bold flex items-center justify-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> Got it
              </button>
            </div>
          ) : (
            <p className="text-center text-[11px] text-slate-500">Think of the answer first, then tap the card.</p>
          )}
        </div>
      )}
    </div>
  );
};
