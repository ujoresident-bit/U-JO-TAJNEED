import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BarChart2,
  CreditCard,
  ShieldCheck,
  Play,
  CheckCircle2,
  Stethoscope,
  Smile,
  ChevronRight
} from 'lucide-react';
import { resolveSession } from '../services/authService';
import { getSubscriptionStatus, syncSubscriptionFromSupabase } from '../services/subscriptionService';
import { getUserStudyStats } from '../services/progressService';
import { getActiveBlockForUser } from '../services/questionBankService';

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

  const firstName = user.firstName && user.firstName !== 'Resident' ? user.firstName : '';

  const quickLinks = [
    { key: 'progress', label: 'Performance', hint: 'Accuracy and progress by subject', icon: BarChart2, onClick: () => onNavigate('progress') },
    { key: 'subscription', label: 'Subscriptions', hint: 'Plans, renewals and payment status', icon: CreditCard, onClick: () => onNavigate('subscription') },
    session.isAdmin
      ? { key: 'admin', label: 'Admin console', hint: 'Users, payments and content', icon: ShieldCheck, onClick: () => onNavigate('admin') }
      : { key: 'done', label: 'Completed blocks', hint: 'Review finished question sets', icon: CheckCircle2, onClick: () => onNavigate('progress') }
  ];

  return (
    <div className="relative space-y-10 pb-16">
      <style>{`
        @keyframes ujo-fade-up {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .ujo-anim-item { opacity: 0; animation: ujo-fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>

      {/* Intro */}
      <div className="space-y-2 ujo-anim-item pt-2">
        <p className="text-xs font-medium text-cyan-300/90">{firstName ? `Welcome back, ${firstName}` : 'Welcome back'}</p>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">Choose your exam bank</h1>
        <p className="text-sm text-slate-400 max-w-xl leading-relaxed">
          Each bank has its own questions, progress and subscription.
        </p>
      </div>

      {/* Bank cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {BANKS.map((bank, bankIdx) => {
          const key = bank.id as 'human_medicine' | 'dentistry';
          const sub = subByBank[key];
          const isActive = sub.status === 'ACTIVE';
          const canEnter = isActive || session.isAdmin;
          const activeBlock = activeBlockByBank[key];
          const stats = statsByBank[key];
          const isAmber = bank.color === 'amber';
          const tint = isAmber
            ? { icon: 'bg-amber-400/10 text-amber-300 border-amber-400/25', btn: 'bg-amber-400 hover:bg-amber-300 text-[#2a1d02]', bar: 'bg-amber-400' }
            : { icon: 'bg-cyan-400/10 text-cyan-300 border-cyan-400/25', btn: 'bg-cyan-400 hover:bg-cyan-300 text-[#04202a]', bar: 'bg-cyan-400' };
          const Icon = isAmber ? Smile : Stethoscope;
          const statusLabel = session.isAdmin ? 'Admin' : isActive ? 'Active' : sub.status === 'PENDING' ? 'Pending' : sub.status === 'EXPIRED' ? 'Expired' : 'Not subscribed';
          const statusStyle = session.isAdmin || isActive
            ? 'text-emerald-300 bg-emerald-400/10 border-emerald-400/25'
            : sub.status === 'PENDING'
            ? 'text-amber-300 bg-amber-400/10 border-amber-400/25'
            : 'text-slate-400 bg-white/[0.04] border-white/10';

          return (
            <div
              key={bank.id}
              className="ujo-anim-item glass-panel p-6 flex flex-col gap-5"
              style={{ animationDelay: `${80 + bankIdx * 90}ms` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3.5">
                  <div className={`w-11 h-11 rounded-xl border flex items-center justify-center ${tint.icon}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-white tracking-tight">{bank.name}</h2>
                    <p className="text-xs text-slate-500">{isAmber ? '20 JOD · 3 months' : '15 JOD · 3 months'}</p>
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded-md text-[11px] font-medium border shrink-0 ${statusStyle}`}>{statusLabel}</span>
              </div>

              {canEnter ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-4 py-3">
                    <p className="text-[11px] text-slate-500">Accuracy</p>
                    <p className="text-xl font-semibold text-white tabular-nums mt-0.5">{Math.round(stats.accuracyPercentage || 0)}%</p>
                    <div className="h-1 rounded-full bg-white/[0.06] mt-2 overflow-hidden">
                      <div className={`h-full ${tint.bar}`} style={{ width: `${Math.min(100, Math.round(stats.accuracyPercentage || 0))}%` }} />
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-4 py-3">
                    <p className="text-[11px] text-slate-500">Questions solved</p>
                    <p className="text-xl font-semibold text-white tabular-nums mt-0.5">{stats.totalQuestionsSolved || 0}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400 leading-relaxed">
                  {sub.status === 'PENDING'
                    ? 'Your payment is being reviewed. You will get a Telegram message as soon as it is approved.'
                    : sub.status === 'EXPIRED'
                    ? 'Your subscription has expired. Renew to keep practicing.'
                    : 'Subscribe to unlock the full question bank, flashcards and study tools.'}
                </p>
              )}

              {canEnter && activeBlock && (
                <button
                  onClick={() => onNavigate('question_screen', { blockId: activeBlock.id })}
                  className="w-full flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] px-4 py-3 text-left transition-colors"
                >
                  <div>
                    <p className="text-[11px] text-slate-500">Continue where you left off</p>
                    <p className="text-sm font-medium text-slate-200">
                      Question {activeBlock.currentIndex + 1} of {activeBlock.questionIds.length}
                    </p>
                  </div>
                  <Play className="w-4 h-4 text-slate-300 shrink-0" />
                </button>
              )}

              <div className="mt-auto space-y-2">
                {canEnter ? (
                  <button
                    onClick={() => onNavigate(bank.id === 'human_medicine' ? 'specialty_hub' : 'bank', { bankId: bank.id })}
                    className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors ${tint.btn}`}
                  >
                    <span>Open {bank.name}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => onNavigate('subscription', { bankId: bank.id })}
                    className="w-full py-3 rounded-xl border border-white/[0.12] hover:bg-white/[0.05] text-slate-100 font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>{sub.status === 'EXPIRED' ? 'Renew subscription' : 'Subscribe'}</span>
                  </button>
                )}
                {isActive && (
                  <p className="text-[11px] text-slate-500 text-center">Expires in {getDaysRemaining(bank.id)} days</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Shortcuts */}
      <div className="ujo-anim-item glass-panel divide-y divide-white/[0.06] overflow-hidden" style={{ animationDelay: '260ms' }}>
        {quickLinks.map((l) => {
          const LIcon = l.icon;
          return (
            <button
              key={l.key}
              onClick={l.onClick}
              className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-white/[0.03] transition-colors"
            >
              <div className="w-9 h-9 rounded-lg bg-white/[0.05] flex items-center justify-center text-slate-300 shrink-0">
                <LIcon className="w-[18px] h-[18px]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-100">{l.label}</p>
                <p className="text-xs text-slate-500 truncate">{l.hint}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
};
