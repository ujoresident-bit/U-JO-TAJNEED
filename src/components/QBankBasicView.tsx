import React, { useMemo, useState } from 'react';
import { ChevronLeft, GraduationCap, Play, Loader2 } from 'lucide-react';
import { resolveSession } from '../services/authService';
import { getFilteredQuestions, startBlock } from '../services/questionBankService';

interface QBankBasicViewProps {
  bankId: string;
  onNavigate: (view: string, params?: any) => void;
}

// Fixed subject set — Pharmacology, Microbiology, Immunology, and Anatomy
// only. No student-facing filtering: the majors are locked, matching the
// "QBANK BASIC" concept as a focused, no-configuration practice set.
const BASIC_MAJORS = ['Pharmacology', 'Microbiology', 'Immunology', 'Anatomy'];

export const QBankBasicView: React.FC<QBankBasicViewProps> = ({ bankId, onNavigate }) => {
  const [starting, setStarting] = useState(false);
  const user = resolveSession().user;

  const availableCount = useMemo(
    () =>
      getFilteredQuestions({
        bankId,
        majors: BASIC_MAJORS,
        statusFilter: 'ALL',
        userId: user.telegramId,
        includeQBankBasic: true
      }).length,
    [bankId, user.telegramId]
  );

  const handleStart = async () => {
    setStarting(true);
    try {
      const block = await startBlock(
        user.telegramId,
        { bankId, majors: BASIC_MAJORS, statusFilter: 'UNUSED', userId: user.telegramId, includeQBankBasic: true },
        bankId
      );
      onNavigate('question_screen', { blockId: block.id });
    } catch (err) {
      setStarting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-12">
      <button
        onClick={() => onNavigate('specialty_hub', { bankId })}
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        <span>Back</span>
      </button>

      <div className="glass-panel p-8 space-y-5 text-center border-t-4 border-emerald-500">
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto">
          <GraduationCap className="w-7 h-7" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-100">QBANK BASIC</h1>
          <p className="text-xs text-slate-400 mt-1">
            A focused set covering Pharmacology, Microbiology, Immunology, and Anatomy only — no filters needed.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {BASIC_MAJORS.map((m) => (
            <span key={m} className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] text-slate-300">
              {m}
            </span>
          ))}
        </div>

        <p className="text-[11px] text-slate-500">{availableCount} question{availableCount !== 1 ? 's' : ''} available</p>

        <button
          onClick={handleStart}
          disabled={starting || availableCount === 0}
          className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black uppercase tracking-wider text-xs flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-40"
        >
          {starting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Starting...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-slate-950" />
              <span>Start Practice</span>
            </>
          )}
        </button>

        {availableCount === 0 && (
          <p className="text-[11px] text-rose-400">No questions available yet for these subjects.</p>
        )}
      </div>
    </div>
  );
};
