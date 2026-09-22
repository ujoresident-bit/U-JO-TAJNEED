import React from 'react';
import {
  BookOpen,
  BarChart2,
  CreditCard,
  ShieldCheck,
  Play,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Layers,
  Stethoscope,
  Award
} from 'lucide-react';
import { resolveSession } from '../services/authService';
import { getSubscriptionStatus, syncSubscriptionFromSupabase } from '../services/subscriptionService';
import { getUserStudyStats } from '../services/progressService';
import { getActiveBlockForUser } from '../services/questionBankService';

interface HomeViewProps {
  onNavigate: (view: string, params?: any) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ onNavigate }) => {
  const [session, setSession] = React.useState(resolveSession());
  const user = session.user;
  const [subscription, setSubscription] = React.useState(getSubscriptionStatus(user.telegramId));

  React.useEffect(() => {
    syncSubscriptionFromSupabase(user.telegramId, user.username).then(() => {
      setSession(resolveSession());
      setSubscription(getSubscriptionStatus(user.telegramId));
    });
  }, [user.telegramId, user.username]);
  const stats = getUserStudyStats(user.telegramId);
  const activeBlock = getActiveBlockForUser(user.telegramId);

  // Calculate days remaining on subscription
  const getDaysRemaining = () => {
    if (session.subscriptionStatus !== 'ACTIVE' || !subscription.expiryDate) return 0;
    const diffMs = new Date(subscription.expiryDate).getTime() - Date.now();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  };

  const daysRemaining = getDaysRemaining();

  return (
    <div className="space-y-6 pb-12">
      {/* Bento Main Grid Container */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        
        {/* Main Bento Hero: Continue Block / Start Practice */}
        <div className="col-span-1 md:col-span-8 glass-panel p-6 md:p-8 flex flex-col justify-between relative overflow-hidden min-h-[300px]">
          <div className="absolute top-0 right-0 w-64 h-64 bg-[#7000FF] opacity-10 blur-[100px] -mr-32 -mt-32 pointer-events-none" />

          {activeBlock ? (
            <>
              <div className="flex justify-between items-start gap-4 mb-6">
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-semibold uppercase tracking-wider mb-3">
                    <Stethoscope className="w-3.5 h-3.5" />
                    <span>Active Practice Session</span>
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-light text-slate-100">
                    Continue Your <span className="font-bold neon-text">MOH Block</span>
                  </h2>
                  <p className="text-xs text-slate-400 max-w-md mt-1 leading-relaxed">
                    You have an active test block in progress. Resume from Question {activeBlock.currentIndex + 1} of {activeBlock.questionIds.length}.
                  </p>
                </div>

                <div className="flex flex-col items-end shrink-0">
                  <div className="text-3xl sm:text-4xl font-black italic text-slate-700 tracking-tighter">
                    {activeBlock.currentIndex + 1}/{activeBlock.questionIds.length}
                  </div>
                  <div className="h-1.5 w-28 bg-slate-800 rounded-full mt-2 overflow-hidden border border-white/5">
                    <div
                      className="h-full neon-bg transition-all duration-300"
                      style={{
                        width: `${Math.round(
                          ((activeBlock.currentIndex + 1) / activeBlock.questionIds.length) * 100
                        )}%`
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                <div className="space-y-3">
                  <div className="flex items-center gap-3.5 p-3.5 rounded-xl bg-white/5 border border-white/5">
                    <div className="p-2.5 rounded-lg bg-cyan-500/10 text-[#00F2FF]">
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Major Category</p>
                      <p className="font-semibold text-xs text-slate-200">{activeBlock.filters.major || 'All Major Subjects'}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3.5 p-3.5 rounded-xl bg-white/5 border border-white/5">
                    <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-400">
                      <Layers className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Selected Topic</p>
                      <p className="font-semibold text-xs text-slate-200">{activeBlock.filters.topic || 'High-Yield Mixed'}</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col justify-end pt-2 sm:pt-0">
                  <button
                    onClick={() => onNavigate('question_screen', { blockId: activeBlock.id })}
                    className="w-full py-4 neon-bg rounded-xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 transform transition-all active:scale-95 cursor-pointer hover:opacity-90 shadow-lg shadow-cyan-500/20"
                  >
                    <Play className="w-4 h-4 fill-slate-950" />
                    <span>Resume Block</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-3 mb-6">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-semibold uppercase tracking-wider">
                  <Stethoscope className="w-3.5 h-3.5 text-[#00F2FF]" />
                  <span>Jordanian Ministry of Health (MOH)</span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-light text-slate-100">
                  Prepare for <span className="font-bold neon-text">MOH Residency</span>
                </h2>
                <p className="text-xs text-slate-400 max-w-lg leading-relaxed">
                  Start a customized test block with board-style questions from 2015 to 2025. Select topics, majors, and difficulty levels.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => onNavigate('bank')}
                  className="w-full sm:w-auto px-6 py-3.5 neon-bg rounded-xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95 shadow-lg shadow-cyan-500/25"
                >
                  <BookOpen className="w-4 h-4" />
                  <span>Start Question Block</span>
                </button>

                <button
                  onClick={() => onNavigate('flashcards')}
                  className="w-full sm:w-auto px-5 py-3.5 glass-panel hover:bg-white/5 rounded-xl text-slate-200 font-bold uppercase tracking-wider text-xs flex items-center justify-center gap-2 transition-all border border-cyan-500/30 cursor-pointer"
                >
                  <Layers className="w-4 h-4 text-[#00F2FF]" />
                  <span>Flashcards</span>
                </button>

                <button
                  onClick={() => onNavigate('progress')}
                  className="w-full sm:w-auto px-5 py-3.5 glass-panel hover:bg-white/5 rounded-xl text-slate-300 font-bold uppercase tracking-wider text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <BarChart2 className="w-4 h-4 text-purple-400" />
                  <span>View Metrics</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Bento Stats Card 1: Overall Accuracy */}
        <div className="col-span-1 md:col-span-4 glass-panel p-6 flex flex-col justify-between stats-gradient min-h-[160px]">
          <div className="flex justify-between items-start">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Overall Accuracy</p>
            <Award className="w-5 h-5 text-[#00F2FF]" />
          </div>
          <div>
            <div className="text-4xl sm:text-5xl font-black text-slate-100 mb-1">{stats.accuracyPercentage}%</div>
            <p className="text-xs text-slate-400">
              {stats.totalCorrect} correct of {stats.totalQuestionsSolved} solved
            </p>
          </div>
        </div>

        {/* Bento Stats Card 2: Solved Questions */}
        <div className="col-span-1 md:col-span-4 glass-panel p-6 flex flex-col justify-between min-h-[160px]">
          <div className="flex justify-between items-start">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Solved Questions</p>
            <BookOpen className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <div className="text-4xl sm:text-5xl font-black text-slate-100 mb-1">{stats.totalQuestionsSolved.toLocaleString()}</div>
            <p className="text-xs text-slate-500">high-yield questions in MOH bank</p>
          </div>
        </div>

        {/* Subscription Bento Card */}
        <div className="col-span-1 md:col-span-8 glass-panel p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-xl border ${
              session.subscriptionStatus === 'ACTIVE'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : session.subscriptionStatus === 'PENDING'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
            }`}>
              {session.subscriptionStatus === 'ACTIVE' ? (
                <CheckCircle2 className="w-6 h-6" />
              ) : session.subscriptionStatus === 'PENDING' ? (
                <Clock className="w-6 h-6" />
              ) : (
                <AlertTriangle className="w-6 h-6" />
              )}
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  MOH Pass Status
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border ${
                  session.subscriptionStatus === 'ACTIVE'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : session.subscriptionStatus === 'PENDING'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                }`}>
                  {session.subscriptionStatus}
                </span>
              </div>
              <p className="text-sm font-bold text-slate-200">
                {session.isAdmin
                  ? 'Admin Full Access Unlocked'
                  : session.subscriptionStatus === 'ACTIVE'
                  ? `Access Granted — ${daysRemaining} Days Remaining`
                  : session.subscriptionStatus === 'PENDING'
                  ? 'Payment Under Administrative Review'
                  : session.subscriptionStatus === 'EXPIRED'
                  ? 'Pass Expired — Renewal Required for Block Access'
                  : 'Subscription Required for Full Access'}
              </p>
            </div>
          </div>

          <button
            onClick={() => onNavigate('subscription')}
            className="px-5 py-2.5 rounded-xl glass-panel hover:bg-white/10 text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center justify-center gap-2 transition-all shrink-0 border border-white/10"
          >
            <CreditCard className="w-4 h-4 text-[#00F2FF]" />
            <span>{session.subscriptionStatus === 'ACTIVE' ? 'Manage Pass' : 'Activate Pass'}</span>
          </button>
        </div>

        {/* Action Bento Cards */}
        <div
          onClick={() => onNavigate('flashcards')}
          className="col-span-1 sm:col-span-6 md:col-span-3 glass-panel p-6 border-l-4 border-cyan-400 flex flex-col items-center justify-center gap-3 text-center group cursor-pointer hover:bg-white/5 transition-all"
        >
          <div className="p-3 rounded-xl bg-cyan-500/10 text-[#00F2FF] group-hover:scale-110 transition-transform">
            <Layers className="w-7 h-7" />
          </div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-200 group-hover:text-[#00F2FF] transition-colors">
            Flashcards
          </p>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Interactive medical<br />revision cards
          </p>
        </div>

        <div
          onClick={() => onNavigate('bank')}
          className="col-span-1 sm:col-span-6 md:col-span-3 glass-panel p-6 border-l-4 border-cyan-500 flex flex-col items-center justify-center gap-3 text-center group cursor-pointer hover:bg-white/5 transition-all"
        >
          <div className="p-3 rounded-xl bg-cyan-500/10 text-[#00F2FF] group-hover:scale-110 transition-transform">
            <BookOpen className="w-7 h-7" />
          </div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-200 group-hover:text-[#00F2FF] transition-colors">
            Start New Block
          </p>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Filter by Topic, Major,<br />or Exam Year
          </p>
        </div>

        <div
          onClick={() => onNavigate('progress')}
          className="col-span-1 sm:col-span-6 md:col-span-3 glass-panel p-6 border-l-4 border-purple-500 flex flex-col items-center justify-center gap-3 text-center group cursor-pointer hover:bg-white/5 transition-all"
        >
          <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400 group-hover:scale-110 transition-transform">
            <BarChart2 className="w-7 h-7" />
          </div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-200 group-hover:text-purple-300 transition-colors">
            Performance
          </p>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Deep-dive into your<br />subject mastery
          </p>
        </div>

        <div
          onClick={() => onNavigate('subscription')}
          className="col-span-1 sm:col-span-6 md:col-span-3 glass-panel p-6 border-l-4 border-amber-500 flex flex-col items-center justify-center gap-3 text-center group cursor-pointer hover:bg-white/5 transition-all"
        >
          <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 group-hover:scale-110 transition-transform">
            <CreditCard className="w-7 h-7" />
          </div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-200 group-hover:text-amber-300 transition-colors">
            MOH Residency Pass
          </p>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            View subscription status<br />and pass validity
          </p>
        </div>

        {session.isAdmin ? (
          <div
            onClick={() => onNavigate('admin')}
            className="col-span-1 sm:col-span-6 md:col-span-3 glass-panel p-6 border-l-4 border-slate-500 flex flex-col items-center justify-center gap-3 text-center group cursor-pointer hover:bg-white/5 transition-all"
          >
            <div className="p-3 rounded-xl bg-slate-800 text-slate-300 group-hover:scale-110 transition-transform">
              <ShieldCheck className="w-7 h-7 text-[#00F2FF]" />
            </div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-200 group-hover:text-[#00F2FF] transition-colors">
              Admin Console
            </p>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Management for<br />system administrators
            </p>
          </div>
        ) : (
          <div
            onClick={() => onNavigate('progress')}
            className="col-span-1 sm:col-span-6 md:col-span-3 glass-panel p-6 border-l-4 border-emerald-500 flex flex-col items-center justify-center gap-3 text-center group cursor-pointer hover:bg-white/5 transition-all"
          >
            <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 group-hover:scale-110 transition-transform">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-200 group-hover:text-emerald-300 transition-colors">
              Completed Blocks
            </p>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Review history and<br />re-test incorrect answers
            </p>
          </div>
        )}

      </div>
    </div>
  );
};
