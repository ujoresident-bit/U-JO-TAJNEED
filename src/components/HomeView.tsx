import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  BarChart2,
  CreditCard,
  ShieldCheck,
  Play,
  CheckCircle2,
  Stethoscope
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

// Two depth layers — the far layer drifts slower and looks dimmer/smaller,
// the near layer is brighter and reacts a touch more to mouse parallax —
// giving a real sense of depth rather than a flat field of dots.
export const HomeView: React.FC<HomeViewProps> = ({ onNavigate }) => {
  const [session, setSession] = useState(resolveSession());
  const user = session.user;

  const [subByBank, setSubByBank] = useState(() => ({
    human_medicine: getSubscriptionStatus(user.telegramId, 'human_medicine'),
    dentistry: getSubscriptionStatus(user.telegramId, 'dentistry')
  }));

  useEffect(() => {
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
    <div className="relative space-y-8 pb-12">
      <style>{`
        @keyframes ujo-fade-up {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes ujo-shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes ujo-breathe {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 0.9; transform: scale(1.06); }
        }
        .ujo-anim-item {
          opacity: 0;
          animation: ujo-fade-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .ujo-shimmer-text {
          background: linear-gradient(90deg, #67e8f9 0%, #f0f9ff 25%, #67e8f9 50%, #fcd34d 75%, #67e8f9 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: ujo-shimmer 6s linear infinite;
        }
      `}</style>

      {/* Header */}
      <div className="relative space-y-2 ujo-anim-item" style={{ animationDelay: '0ms' }}>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-slate-400 text-[10px] font-light uppercase tracking-[0.3em] pl-[calc(0.75rem+0.3em)]">
          <Stethoscope className="w-3.5 h-3.5" style={{ animation: 'ujo-breathe 3s ease-in-out infinite' }} />
          <span>U JO TAJNEED</span>
        </div>
        <h1 className="text-2xl sm:text-4xl font-thin text-slate-100 tracking-wide">
          Medical Services Exam <span className="font-semibold ujo-shimmer-text">Prep Platform</span>
        </h1>
        <p className="text-xs text-slate-500 max-w-xl font-light tracking-wide">
          Choose the bank you want to practice — each bank has a fully independent subscription.
        </p>
      </div>

      {/* Two fully independent bank cards */}
      <div className="relative grid grid-cols-1 md:grid-cols-2 gap-5">
        {BANKS.map((bank, bankIdx) => {
          const sub = subByBank[bank.id as 'human_medicine' | 'dentistry'];
          const isActive = sub.status === 'ACTIVE';
          const activeBlock = activeBlockByBank[bank.id as 'human_medicine' | 'dentistry'];
          const stats = statsByBank[bank.id as 'human_medicine' | 'dentistry'];
          const accent = bank.color === 'amber' ? 'amber' : 'cyan';

          return (
            <div
              key={bank.id}
              className="ujo-anim-item relative overflow-hidden p-6 space-y-4 rounded-2xl bg-white/[0.02] backdrop-blur-xl border border-white/10 hover:border-white/25 hover:-translate-y-1 transition-all duration-300 group"
              style={{ animationDelay: `${120 + bankIdx * 110}ms` }}
            >
              <div className={`absolute top-0 right-0 w-40 h-40 ${accent === 'amber' ? 'bg-amber-500' : 'bg-cyan-500'} opacity-[0.07] group-hover:opacity-[0.12] blur-[80px] -mr-16 -mt-16 pointer-events-none transition-opacity duration-300`} />
              <div className={`absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent ${accent === 'amber' ? 'via-amber-500/50' : 'via-cyan-500/50'} to-transparent`} />

              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-light text-slate-100 tracking-wide">{bank.name}</h2>
                  <p className="text-[10px] text-slate-500 uppercase tracking-[0.2em] mt-0.5">{bank.shortName}</p>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase border shrink-0 tracking-wider ${
                  isActive
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                    : sub.status === 'PENDING'
                    ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                    : 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                }`}>
                  {session.isAdmin ? 'ADMIN' : sub.status}
                </span>
              </div>

              {!isActive && !session.isAdmin && (
                <p className="text-xs text-slate-500 font-light">
                  {sub.status === 'PENDING'
                    ? 'Your payment request is under admin review.'
                    : sub.status === 'EXPIRED'
                    ? 'Your subscription has expired — renew to continue practicing.'
                    : 'Subscribe to this bank to access the full question bank.'}
                </p>
              )}

              {(isActive || session.isAdmin) && activeBlock && (
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] uppercase text-slate-500 font-semibold tracking-wider">Active Session</p>
                    <p className="text-xs font-medium text-slate-300">
                      Question {activeBlock.currentIndex + 1} of {activeBlock.questionIds.length}
                    </p>
                  </div>
                  <button
                    onClick={() => onNavigate('question_screen', { blockId: activeBlock.id })}
                    className={`px-4 py-2 rounded-lg ${accent === 'amber' ? 'bg-amber-500' : 'bg-cyan-500'} text-slate-950 text-[11px] font-bold uppercase flex items-center gap-1.5 hover:scale-105 transition-transform`}
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
                  <button
                    onClick={() => onNavigate(bank.id === 'human_medicine' ? 'specialty_hub' : 'bank', { bankId: bank.id })}
                    className={`flex-1 py-3 rounded-xl ${accent === 'amber' ? 'bg-amber-500' : 'bg-cyan-500'} text-slate-950 font-semibold uppercase tracking-wider text-xs flex items-center justify-center gap-2 transition-all active:scale-95 hover:brightness-110`}
                  >
                    <BookOpen className="w-4 h-4" />
                    <span>Start New Test</span>
                  </button>
                ) : (
                  <button
                    onClick={() => onNavigate('subscription', { bankId: bank.id })}
                    className="flex-1 py-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 text-slate-200 font-semibold uppercase tracking-wider text-xs flex items-center justify-center gap-2 transition-all active:scale-95"
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>{sub.status === 'EXPIRED' ? 'Renew Subscription' : 'Subscribe Now'}</span>
                  </button>
                )}
              </div>

              {isActive && (
                <p className="text-[10px] text-slate-600 text-center font-light tracking-wide">
                  Subscription expires in {getDaysRemaining(bank.id)} days
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Shared quick-action cards */}
      <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div
          onClick={() => onNavigate('progress')}
          className="ujo-anim-item relative overflow-hidden p-6 rounded-2xl bg-white/[0.02] backdrop-blur-xl border border-white/10 hover:border-purple-500/30 hover:-translate-y-1 flex flex-col items-center justify-center gap-3 text-center group cursor-pointer transition-all duration-300"
          style={{ animationDelay: '340ms' }}
        >
          <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400 group-hover:scale-110 transition-transform">
            <BarChart2 className="w-6 h-6" />
          </div>
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-slate-300 group-hover:text-purple-300 transition-colors">
            Performance
          </p>
        </div>

        <div
          onClick={() => onNavigate('subscription')}
          className="ujo-anim-item relative overflow-hidden p-6 rounded-2xl bg-white/[0.02] backdrop-blur-xl border border-white/10 hover:border-amber-500/30 hover:-translate-y-1 flex flex-col items-center justify-center gap-3 text-center group cursor-pointer transition-all duration-300"
          style={{ animationDelay: '420ms' }}
        >
          <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 group-hover:scale-110 transition-transform">
            <CreditCard className="w-6 h-6" />
          </div>
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-slate-300 group-hover:text-amber-300 transition-colors">
            Subscriptions
          </p>
        </div>

        {session.isAdmin ? (
          <div
            onClick={() => onNavigate('admin')}
            className="ujo-anim-item relative overflow-hidden p-6 rounded-2xl bg-white/[0.02] backdrop-blur-xl border border-white/10 hover:border-cyan-500/30 hover:-translate-y-1 flex flex-col items-center justify-center gap-3 text-center group cursor-pointer transition-all duration-300"
            style={{ animationDelay: '500ms' }}
          >
            <div className="p-3 rounded-xl bg-white/5 text-slate-300 group-hover:scale-110 transition-transform">
              <ShieldCheck className="w-6 h-6 text-cyan-400" />
            </div>
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-slate-300 group-hover:text-cyan-300 transition-colors">
              Admin Console
            </p>
          </div>
        ) : (
          <div
            onClick={() => onNavigate('progress')}
            className="ujo-anim-item relative overflow-hidden p-6 rounded-2xl bg-white/[0.02] backdrop-blur-xl border border-white/10 hover:border-emerald-500/30 hover:-translate-y-1 flex flex-col items-center justify-center gap-3 text-center group cursor-pointer transition-all duration-300"
            style={{ animationDelay: '500ms' }}
          >
            <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 group-hover:scale-110 transition-transform">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-slate-300 group-hover:text-emerald-300 transition-colors">
              Completed Blocks
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
