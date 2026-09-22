import React from 'react';
import { Layers, X, Check, CheckCircle2, XCircle } from 'lucide-react';
import { Block, Question, OptionKey } from '../types';
import { getQuestionById } from '../services/questionBankService';

interface QuestionNavigatorProps {
  block: Block;
  questions: Question[];
  currentIndex: number;
  onSelectIndex: (index: number) => void;
  onClose?: () => void;
}

export const QuestionNavigator: React.FC<QuestionNavigatorProps> = ({
  block,
  questions,
  currentIndex,
  onSelectIndex,
  onClose
}) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4 shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Question Navigator
          </h3>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Grid of questions */}
      <div className="grid grid-cols-5 sm:grid-cols-5 gap-2 max-h-72 overflow-y-auto pr-1">
        {questions.map((q, idx) => {
          const isCurrent = idx === currentIndex;
          const ans = block.answers[q.id];
          const isAnswered = Boolean(ans);
          const isCorrect = ans?.isCorrect;

          return (
            <button
              key={q.id}
              onClick={() => {
                onSelectIndex(idx);
                if (onClose) onClose();
              }}
              className={`h-11 rounded-xl text-xs font-bold flex flex-col items-center justify-center relative transition-all border ${
                isCurrent
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400 shadow-md shadow-cyan-500/20 ring-1 ring-cyan-400'
                  : isAnswered
                  ? isCorrect
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                    : 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200'
              }`}
            >
              <span>{idx + 1}</span>

              {isAnswered && (
                <span className="absolute top-1 right-1">
                  {isCorrect ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 inline-block" />
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="pt-2 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 border border-cyan-300" />
          <span>Current</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-700 border border-slate-600" />
          <span>Unanswered</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          <span>Correct</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
          <span>Incorrect</span>
        </div>
      </div>
    </div>
  );
};
