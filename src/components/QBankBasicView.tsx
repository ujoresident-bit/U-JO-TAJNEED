import React, { useMemo, useState } from 'react';
import { ChevronLeft, GraduationCap, Play, Loader2, Pill, Bug, Shield, Bone } from 'lucide-react';
import { resolveSession } from '../services/authService';
import { getFilteredQuestions, startBlock } from '../services/questionBankService';

interface QBankBasicViewProps {
  bankId: string;
  onNavigate: (view: string, params?: any) => void;
}

// QBANK BASIC covers exactly these four subjects — shown as separate
// selectable sections rather than one combined pool, so the student picks
// which one to practice.
const SUBJECTS = [
  { major: 'Pharmacology', icon: Pill, accent: 'cyan' as const },
  { major: 'Microbiology', icon: Bug, accent: 'emerald' as const },
  { major: 'Immunology', icon: Shield, accent: 'amber' as const },
  { major: 'Anatomy', icon: Bone, accent: 'purple' as const }
];

const ACCENT_CLASSES: Record<string, { border: string; iconBg: string; iconText: string; glow: string; button: string }> = {
  cyan: { border: 'border-cyan-500', iconBg: 'bg-cyan-500/10', iconText: 'text-cyan-400', glow: 'bg-cyan-500', button: 'bg-cyan-500 hover:bg-cyan-400' },
  emerald: { border: 'border-emerald-500', iconBg: 'bg-emerald-500/10', iconText: 'text-emerald-400', glow: 'bg-emerald-500', button: 'bg-emerald-500 hover:bg-emerald-400' },
  amber: { border: 'border-amber-500', iconBg: 'bg-amber-500/10', iconText: 'text-amber-400', glow: 'bg-amber-500', button: 'bg-amber-500 hover:bg-amber-400' },
  purple: { border: 'border-purple-500', iconBg: 'bg-purple-500/10', iconText: 'text-purple-400', glow: 'bg-purple-500', button: 'bg-purple-500 hover:bg-purple-400' }
};

export const QBankBasicView: React.FC<QBankBasicViewProps> = ({ bankId, onNavigate }) => {
  const [startingSubject, setStartingSubject] = useState<string | null>(null);
  const user = resolveSession().user;

  const countsBySubject = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of SUBJECTS) {
      counts[s.major] = getFilteredQuestions({
        bankId,
        majors: [s.major],
        statusFilter: 'ALL',
        userId: user.telegramId,
        includeQBankBasic: true
      }).length;
    }
    return counts;
  }, [bankId, user.telegramId]);

  const handleStart = async (major: string) => {
    setStartingSubject(major);
    try {
      const block = await startBlock(
        user.telegramId,
        { bankId, majors: [major], statusFilter: 'UNUSED', userId: user.telegramId, includeQBankBasic: true },
        bankId
      );
      onNavigate('question_screen', { blockId: block.id });
    } catch (err) {
      setStartingSubject(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <button
        onClick={() => onNavigate('specialty_hub', { bankId })}
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        <span>Back</span>
      </button>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <GraduationCap className="w-6 h-6 text-emerald-400" />
          <span>QBANK BASIC</span>
        </h1>
        <p className="text-xs text-slate-400">Choose a subject to practice.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {SUBJECTS.map((s) => {
          const accent = ACCENT_CLASSES[s.accent];
          const Icon = s.icon;
          const count = countsBySubject[s.major] || 0;
          const isStarting = startingSubject === s.major;

          return (
            <div
              key={s.major}
              className={`relative overflow-hidden p-6 space-y-4 glass-panel border-t-4 ${accent.border}`}
            >
              <div className={`absolute top-0 right-0 w-32 h-32 ${accent.glow} opacity-10 blur-[70px] -mr-10 -mt-10 pointer-events-none`} />
              <div className={`w-12 h-12 rounded-xl ${accent.iconBg} ${accent.iconText} flex items-center justify-center`}>
                <Icon className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-100">{s.major}</h2>
                <p className="text-[11px] text-slate-500 mt-1">{count} question{count !== 1 ? 's' : ''} available</p>
              </div>
              <button
                onClick={() => handleStart(s.major)}
                disabled={isStarting || count === 0}
                className={`w-full py-2.5 rounded-xl ${accent.button} text-slate-950 font-black uppercase tracking-wider text-xs flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-40`}
              >
                {isStarting ? (
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
            </div>
          );
        })}
      </div>
    </div>
  );
};
