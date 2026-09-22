import React from 'react';
import { BarChart2, BookOpen, Award, CheckCircle2, XCircle, RotateCcw, ArrowLeft, Play } from 'lucide-react';
import { resolveSession } from '../services/authService';
import { getUserStudyStats, getUserBlockHistory } from '../services/progressService';

interface ProgressViewProps {
  onNavigate: (view: string, params?: any) => void;
}

export const ProgressView: React.FC<ProgressViewProps> = ({ onNavigate }) => {
  const session = resolveSession();
  const user = session.user;
  const stats = getUserStudyStats(user.telegramId);
  const blockHistory = getUserBlockHistory(user.telegramId);

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Header Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-purple-950/40 border border-slate-800 p-6 md:p-8 shadow-xl">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-semibold">
            <BarChart2 className="w-3.5 h-3.5" />
            <span>Performance Dashboard</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-100">
            My Study Progress & History
          </h1>
          <p className="text-xs text-slate-400 max-w-xl">
            Detailed tracking of solved questions, accuracy breakdown, completed blocks, and review access.
          </p>
        </div>
      </div>

      {/* High-Level Overview Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-1">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Total Solved
          </div>
          <div className="text-2xl font-black text-slate-100">{stats.totalQuestionsSolved}</div>
        </div>

        <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-1">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Accuracy
          </div>
          <div className="text-2xl font-black text-emerald-400">{stats.accuracyPercentage}%</div>
        </div>

        <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-1">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Correct Answers
          </div>
          <div className="text-2xl font-black text-cyan-400">{stats.totalCorrect}</div>
        </div>

        <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-1">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Completed Blocks
          </div>
          <div className="text-2xl font-black text-purple-400">{stats.blocksCompleted}</div>
        </div>
      </div>

      {/* Completed Blocks History List */}
      <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-6 space-y-4 shadow-xl">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 border-b border-slate-800 pb-2 flex items-center justify-between">
          <span>Completed Practice Blocks</span>
          <span className="text-xs font-normal text-slate-400">{blockHistory.length} Blocks</span>
        </h3>

        {blockHistory.length === 0 ? (
          <div className="text-center py-12 space-y-3">
            <BookOpen className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="text-xs text-slate-400">No completed blocks yet.</p>
            <button
              onClick={() => onNavigate('bank')}
              className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all shadow-md shadow-cyan-500/20"
            >
              Start First Block
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {blockHistory.map((b) => (
              <div
                key={b.id}
                className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors hover:border-slate-700"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-100">{b.bankName}</span>
                    <span className="px-2 py-0.5 bg-slate-800 text-slate-300 text-[10px] font-semibold rounded">
                      {b.filters.major || 'All Majors'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">
                    {b.questionIds.length} Questions • {new Date(b.updatedAt).toLocaleDateString()}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-lg font-black text-emerald-400">{b.score}%</div>
                    <div className="text-[10px] text-slate-400 uppercase">Score</div>
                  </div>

                  <button
                    onClick={() => onNavigate('question_screen', { blockId: b.id, reviewMode: 'all' })}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-all flex items-center gap-1"
                  >
                    <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Review</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pt-2 flex justify-center">
        <button
          onClick={() => onNavigate('home')}
          className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-all flex items-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Return to Home</span>
        </button>
      </div>
    </div>
  );
};
