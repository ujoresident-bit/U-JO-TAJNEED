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
import { ECGLevelIndicator } from './ECGLevelIndicator';

interface HomeViewProps {
  onNavigate: (view: string, params?: any) => void;
}

const BANKS = [
  { id: 'human_medicine', name: 'Human Medicine', shortName: 'Human Medicine', color: 'cyan' as const },
  { id: 'dentistry', name: 'Dentistry', shortName: 'Dentistry', color: 'amber' as const }
];

export const HomeView: React.FC<HomeViewProps> = ({ onNavigate }) => {
  const [session, setSession] = React.useState(resolveSession());
  const user = session.user;

  // Each bank has its OWN independent subscription — never one status for
  // the whole site. Re-synced from Supabase (the authoritative source) on
  // mount for both banks in parallel.
  const [subByBank, setSubByBank] = React.useState(() => ({
    human_medicine: getSubscriptionStatus(user.telegramId, 'human_medicine'),
    dentistry: getSubscriptionStatus(user.telegramId, 'dentistry')
  }));

  React.useEffect(() => {
    Promise.all([
      syncSubscriptionFromSupabase(user.telegramId, user.username, 'human_medicine'),
      syncSubscriptionFromSupabase(user.telegramId, user.username, 'dentistry')
    ]).then(() => {
      setSession(resolveSession());
      setSubByBank({
        human_medicine: getSubscriptionStatus(user.telegramId, 'human_medicine'),
        dentistry: getSubscriptionStatus(user.telegramId, 'dentistry')
      });
    });
  }, [user.telegramId, user.username]);

  const statsByBank = {
    human_medicine: getUserStudyStats(user.telegramId, 'human_medicine'),
    dentistry: getUserStudyStats(user.telegramId, 'dentistry')
  };

  const activeBlockByBank = {
    human_medicine: getActiveBlockForUser(user.telegramId, 'human_medicine'),
    dentistry: getActiveBlockForUser(user.telegramId, 'dentistry')
  };

  const getDaysRemaining = (bankId: string) => {
    const sub = subByBank[bankId as 'human_medicine' | 'dentistry'];
    if (sub.status !== 'ACTIVE' || !sub.expiryDate) return 0;
    const diffMs = new Date(sub.expiryDate).getTime() - Date.now();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="space-y-1">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-semibold uppercase tracking-wider">
          <Stethoscope className="w-3.5 h-3.5" />
          <span>U JO TAJNEED</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-light text-slate-100">
          Medical Services Exam <span className="font-bold neon-text">Prep Platform</span>
        </h1>
        <p className="text-xs text-slate-400 max-w-xl">
          Choose the bank you want to practice — each bank has a fully independent subscription.
        </p>
      </div>

      {/* Two fully independent bank cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {BANKS.map((bank) => {
          const sub = subByBank[bank.id as 'human_medicine' | 'dentistry'];
          const isActive = sub.status === 'ACTIVE';
          const activeBlock = activeBlockByBank[bank.id as 'human_medicine' | 'dentistry'];
          const stats = statsByBank[bank.id as 'human_medicine' | 'dentistry'];
          const accent = bank.color === 'amber' ? 'amber' : 'cyan';

          return (
            <div key={bank.id} className={`glass-panel p-6 space-y-4 border-t-4 ${accent === 'amber' ? 'border-amber-500' : 'border-cyan-500'} relative overflow-hidden`}>
              <div className={`absolute top-0 right-0 w-40 h-40 ${accent === 'amber' ? 'bg-amber-500' : 'bg-cyan-500'} opacity-10 blur-[80px] -mr-16 -mt-16 pointer-events-none`} />

              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-slate-100">{bank.name}</h2>
                  <p className="text-[11px] text-slate-500">{bank.shortName}</p>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase border shrink-0 ${
                  isActive
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : sub.status === 'PENDING'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                }`}>
                  {session.isAdmin ? 'ADMIN' : sub.status}
                </span>
              </div>

              {!isActive && !session.isAdmin && (
                <p className="text-xs text-slate-400">
                  {sub.status === 'PENDING'
                    ? 'Your payment request is under admin review.'
                    : sub.status === 'EXPIRED'
                    ? 'Your subscription has expired — renew to continue practicing.'
                    : 'Subscribe to this bank to access the full question bank.'}
                </p>
              )}

              {(isActive || session.isAdmin) && activeBlock && (
                <div className="p-3 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Active Session</p>
                    <p className="text-xs font-semibold text-slate-200">
                      Question {activeBlock.currentIndex + 1} of {activeBlock.questionIds.length}
                    </p>
                  </div>
                  <button
                    onClick={() => onNavigate('question_screen', { blockId: activeBlock.id })}
                    className={`px-4 py-2 rounded-lg ${accent === 'amber' ? 'bg-amber-500' : 'bg-cyan-500'} text-slate-950 text-[11px] font-black uppercase flex items-center gap-1.5`}
                  >
                    <Play className="w-3 h-3 fill-slate-950" />
                    <span>Continue</span>
                  </button>
                </div>
              )}

              {(isActive || session.isAdmin) && (
                <ECGLevelIndicator
                  label={bank.shortName}
                  accuracyPercentage={stats.accuracyPercentage}
                  questionsSolved={stats.totalQuestionsSolved}
                  colorTheme={accent}
                />
              )}

              <div className="flex gap-2">
                {isActive || session.isAdmin ? (
                  <>
                    <button
                      onClick={() => onNavigate('bank', { bankId: bank.id })}
                      className={`flex-1 py-3 rounded-xl ${accent === 'amber' ? 'bg-amber-500' : 'bg-cyan-500'} text-slate-950 font-black uppercase tracking-wider text-xs flex items-center justify-center gap-2 transition-all active:scale-95`}
                    >
                      <BookOpen className="w-4 h-4" />
                      <span>Start New Test</span>
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => onNavigate('subscription', { bankId: bank.id })}
                    className="flex-1 py-3 rounded-xl glass-panel hover:bg-white/10 border border-white/10 text-slate-200 font-black uppercase tracking-wider text-xs flex items-center justify-center gap-2 transition-all active:scale-95"
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>{sub.status === 'EXPIRED' ? 'Renew Subscription' : 'Subscribe Now'}</span>
                  </button>
                )}
              </div>

              {isActive && (
                <p className="text-[10px] text-slate-500 text-center">
                  Subscription expires in {getDaysRemaining(bank.id)} days
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Shared quick-action cards (not bank-specific) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div
          onClick={() => onNavigate('flashcards')}
          className="glass-panel p-6 border-l-4 border-cyan-400 flex flex-col items-center justify-center gap-3 text-center group cursor-pointer hover:bg-white/5 transition-all"
        >
          <div className="p-3 rounded-xl bg-cyan-500/10 text-[#00F2FF] group-hover:scale-110 transition-transform">
            <Layers className="w-7 h-7" />
          </div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-200 group-hover:text-[#00F2FF] transition-colors">
            Flashcards
          </p>
        </div>

        <div
          onClick={() => onNavigate('progress')}
          className="glass-panel p-6 border-l-4 border-purple-500 flex flex-col items-center justify-center gap-3 text-center group cursor-pointer hover:bg-white/5 transition-all"
        >
          <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400 group-hover:scale-110 transition-transform">
            <BarChart2 className="w-7 h-7" />
          </div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-200 group-hover:text-purple-300 transition-colors">
            Performance
          </p>
        </div>

        <div
          onClick={() => onNavigate('subscription')}
          className="glass-panel p-6 border-l-4 border-amber-500 flex flex-col items-center justify-center gap-3 text-center group cursor-pointer hover:bg-white/5 transition-all"
        >
          <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 group-hover:scale-110 transition-transform">
            <CreditCard className="w-7 h-7" />
          </div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-200 group-hover:text-amber-300 transition-colors">
            Subscriptions
          </p>
        </div>

        {session.isAdmin ? (
          <div
            onClick={() => onNavigate('admin')}
            className="glass-panel p-6 border-l-4 border-slate-500 flex flex-col items-center justify-center gap-3 text-center group cursor-pointer hover:bg-white/5 transition-all"
          >
            <div className="p-3 rounded-xl bg-slate-800 text-slate-300 group-hover:scale-110 transition-transform">
              <ShieldCheck className="w-7 h-7 text-[#00F2FF]" />
            </div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-200 group-hover:text-[#00F2FF] transition-colors">
              Admin Console
            </p>
          </div>
        ) : (
          <div
            onClick={() => onNavigate('progress')}
            className="glass-panel p-6 border-l-4 border-emerald-500 flex flex-col items-center justify-center gap-3 text-center group cursor-pointer hover:bg-white/5 transition-all"
          >
            <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 group-hover:scale-110 transition-transform">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-200 group-hover:text-emerald-300 transition-colors">
              Completed Blocks
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
