import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Info,
  ShieldCheck,
  User,
  ArrowLeft,
  Send,
  RotateCcw
} from 'lucide-react';
import { resolveSession } from '../services/authService';
import {
  getSubscriptionStatus,
  getAdminConfig,
  syncSubscriptionFromSupabase
} from '../services/subscriptionService';

interface SubscriptionViewProps {
  onNavigate: (view: string) => void;
  onRefreshData?: () => void;
  bankId?: string;
}

const BANK_NAMES: Record<string, string> = {
  human_medicine: 'Human Medicine',
  dentistry: 'Dentistry'
};

export const SubscriptionView: React.FC<SubscriptionViewProps> = ({ onNavigate, onRefreshData, bankId = 'human_medicine' }) => {
  const [session, setSession] = useState(resolveSession());
  const [syncing, setSyncing] = useState(false);
  const user = session.user;
  const [subscription, setSubscription] = useState(getSubscriptionStatus(user.telegramId, bankId));
  const config = getAdminConfig();
  const bankLabel = BANK_NAMES[bankId] || bankId;

  const handleSyncStatus = async () => {
    setSyncing(true);
    await syncSubscriptionFromSupabase(user.telegramId, user.username, bankId);
    setSession(resolveSession());
    setSubscription(getSubscriptionStatus(user.telegramId, bankId));
    if (onRefreshData) onRefreshData();
    setSyncing(false);
  };

  useEffect(() => {
    handleSyncStatus();
  }, [bankId]);

  const isActive = subscription.status === 'ACTIVE';

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      {/* Header Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/40 border border-slate-800 p-6 md:p-8 shadow-xl">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-semibold">
            <CreditCard className="w-3.5 h-3.5" />
            <span>{bankLabel} — U JO TAJNEED Pass</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-100">
            Subscription Status: {bankLabel}
          </h1>
          <p className="text-xs text-slate-400 max-w-xl">
            This subscription is fully independent from other banks — it only unlocks access to {bankLabel}.
          </p>
        </div>
      </div>

      {/* Current Subscription Status Card */}
      <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-6 shadow-lg space-y-4">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Current Subscription Status
          </span>
          <span
            className={`px-3 py-1 rounded text-xs font-extrabold uppercase border ${
              isActive
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                : subscription.status === 'PENDING'
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                : 'bg-rose-500/20 text-rose-400 border-rose-500/40'
            }`}
          >
            {session.isAdmin ? 'ADMIN' : subscription.status}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <span className="text-slate-400">Bank:</span>{' '}
            <strong className="text-slate-200">{bankLabel}</strong>
          </div>
          <div>
            <span className="text-slate-400">Telegram Identity:</span>{' '}
            <strong className="text-cyan-400">@{user.username || user.telegramId}</strong>
          </div>
          {subscription.startDate && (
            <div>
              <span className="text-slate-400">Start Date:</span>{' '}
              <span className="text-slate-300">
                {new Date(subscription.startDate).toLocaleDateString()}
              </span>
            </div>
          )}
          {subscription.expiryDate && (
            <div>
              <span className="text-slate-400">Expiry Date:</span>{' '}
              <span className="text-slate-300">
                {new Date(subscription.expiryDate).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>

        {isActive || session.isAdmin ? (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center gap-3 text-xs">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <p className="font-bold">Full Access Unlocked</p>
              <p className="text-emerald-400/80">You have full access to all {bankLabel} questions and AI explanation tools.</p>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-3 text-xs">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <p className="font-bold">Subscription Required</p>
              <p className="text-rose-400/80">
                Your {bankLabel} subscription is not active. To subscribe, open the Telegram bot and send /start, then choose "{bankLabel}".
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={handleSyncStatus}
          disabled={syncing}
          className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all flex items-center gap-1.5 shadow-md shadow-cyan-500/20 disabled:opacity-50"
        >
          <RotateCcw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          <span>Refresh Subscription Status</span>
        </button>

        <button
          onClick={() => onNavigate('home')}
          className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-all flex items-center gap-1.5 border border-slate-700"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Home</span>
        </button>
      </div>
    </div>
  );
};
