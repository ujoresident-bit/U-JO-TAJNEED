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
}

export const SubscriptionView: React.FC<SubscriptionViewProps> = ({ onNavigate, onRefreshData }) => {
  const [session, setSession] = useState(resolveSession());
  const [syncing, setSyncing] = useState(false);
  const user = session.user;
  const [subscription, setSubscription] = useState(getSubscriptionStatus(user.telegramId));
  const config = getAdminConfig();

  const handleSyncStatus = async () => {
    setSyncing(true);
    await syncSubscriptionFromSupabase(user.telegramId, user.username);
    setSession(resolveSession());
    setSubscription(getSubscriptionStatus(user.telegramId));
    if (onRefreshData) onRefreshData();
    setSyncing(false);
  };

  useEffect(() => {
    handleSyncStatus();
  }, []);

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      {/* Header Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/40 border border-slate-800 p-6 md:p-8 shadow-xl">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-semibold">
            <CreditCard className="w-3.5 h-3.5" />
            <span>MOH Residency Pass</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-100">
            Account Subscription Status
          </h1>
          <p className="text-xs text-slate-400 max-w-xl">
            Full access to the Jordanian Ministry of Health (MOH) Residency Question Bank, AI explanations, and analytics.
          </p>
        </div>
      </div>

      {/* Current Subscription Status Card */}
      <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-6 shadow-lg space-y-4">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Current Active Pass Status
          </span>
          <span
            className={`px-3 py-1 rounded text-xs font-extrabold uppercase border ${
              session.subscriptionStatus === 'ACTIVE'
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                : session.subscriptionStatus === 'PENDING'
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                : 'bg-rose-500/20 text-rose-400 border-rose-500/40'
            }`}
          >
            {session.subscriptionStatus}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <span className="text-slate-400">Target Bank:</span>{' '}
            <strong className="text-slate-200">MOH Residency Question Bank</strong>
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

        {session.subscriptionStatus === 'ACTIVE' ? (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center gap-3 text-xs">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <p className="font-bold">Full Access Unlocked</p>
              <p className="text-emerald-400/80">You have unlimited access to all MOH question blocks and AI explanation tools.</p>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-3 text-xs">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <p className="font-bold">Subscription Required</p>
              <p className="text-rose-400/80">
                Your subscription is currently inactive. Please contact the administrator on Telegram to manage or renew your access.
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
          <span>تحديث حالة الاشتراك</span>
        </button>

        <button
          onClick={() => onNavigate('home')}
          className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-all flex items-center gap-1.5 border border-slate-700"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Return to Home</span>
        </button>
      </div>
    </div>
  );
};
