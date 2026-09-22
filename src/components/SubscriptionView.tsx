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
  human_medicine: 'الطب البشري',
  dentistry: 'طب الأسنان'
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
            حالة اشتراك: {bankLabel}
          </h1>
          <p className="text-xs text-slate-400 max-w-xl">
            هذا الاشتراك مستقل تماماً عن اشتراكات البنوك الأخرى — يفتح الوصول لبنك {bankLabel} فقط.
          </p>
        </div>
      </div>

      {/* Current Subscription Status Card */}
      <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-6 shadow-lg space-y-4">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            حالة الاشتراك الحالية
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
            <span className="text-slate-400">البنك:</span>{' '}
            <strong className="text-slate-200">{bankLabel}</strong>
          </div>
          <div>
            <span className="text-slate-400">Telegram Identity:</span>{' '}
            <strong className="text-cyan-400">@{user.username || user.telegramId}</strong>
          </div>
          {subscription.startDate && (
            <div>
              <span className="text-slate-400">تاريخ البدء:</span>{' '}
              <span className="text-slate-300">
                {new Date(subscription.startDate).toLocaleDateString()}
              </span>
            </div>
          )}
          {subscription.expiryDate && (
            <div>
              <span className="text-slate-400">تاريخ الانتهاء:</span>{' '}
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
              <p className="font-bold">الوصول مفتوح بالكامل</p>
              <p className="text-emerald-400/80">لديك وصول كامل لكل أسئلة {bankLabel} وأدوات الشرح بالذكاء الاصطناعي.</p>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-3 text-xs">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <p className="font-bold">الاشتراك مطلوب</p>
              <p className="text-rose-400/80">
                اشتراكك بـ{bankLabel} غير مفعّل حالياً. للاشتراك، افتح البوت على تلغرام واكتب /start، ثم اختر "{bankLabel}".
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
          <span>العودة للرئيسية</span>
        </button>
      </div>
    </div>
  );
};
