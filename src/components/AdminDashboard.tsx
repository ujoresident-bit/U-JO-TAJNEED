import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  CreditCard,
  Users,
  BookOpen,
  Settings,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Plus,
  BarChart2,
  Phone,
  User as UserIcon,
  Save,
  Check,
  AlertTriangle,
  Layers,
  Eye,
  Trash2
} from 'lucide-react';
import {
  getDashboardMetrics,
  getUsers,
  getUserDetails,
  getAdminConfig,
  saveAdminConfig,
  fetchAdminMetricsFromSupabase,
  fetchAdminUsersFromSupabase,
  fetchUserDetailsFromSupabase,
  fetchAdminConfigFromSupabase,
  updateAdminConfigInSupabase,
  fetchAdminPaymentsFromSupabase,
  approvePaymentInSupabase,
  rejectPaymentInSupabase,
  deleteUserInSupabase,
  updateUserStatusInSupabase,
  extendSubscriptionInSupabase,
  cancelSubscriptionInSupabase,
  disableAllSubscriptionsInSupabase
} from '../services/adminService';
import {
  getPaymentRequests,
  approvePaymentRequest,
  rejectPaymentRequest,
  extendSubscription,
  deactivateSubscription,
  syncSubscriptionFromSupabase
} from '../services/subscriptionService';
import { getCurrentUser, resolveSession } from '../services/authService';
import { User, PaymentRequest, AdminMetrics, AdminConfig } from '../types';
import { AdminImportWizard } from './AdminImportWizard';
import { AdminQuestionTable } from './AdminQuestionTable';
import { AdminQuestionStats } from './AdminQuestionStats';
import { AdminFlashcardsManager } from './AdminFlashcardsManager';

interface AdminDashboardProps {
  onNavigate: (view: string) => void;
  onRefreshData?: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onNavigate, onRefreshData }) => {
  const session = resolveSession();
  const adminUser = session.user;

  if (!session.isAdmin) {
    return (
      <div className="max-w-2xl mx-auto py-16 px-4 text-center space-y-4">
        <div className="p-4 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 w-16 h-16 mx-auto flex items-center justify-center">
          <ShieldCheck className="w-8 h-8 text-rose-400" />
        </div>
        <h2 className="text-xl font-bold text-slate-100">Access Restricted</h2>
        <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
          Your Telegram user identity (@{session.user.username || session.user.telegramId}) is not registered on the server-side Admin allowlist.
        </p>
        <button
          onClick={() => onNavigate('home')}
          className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all"
        >
          Return to Home
        </button>
      </div>
    );
  }
  const [activeTab, setActiveTab] = useState<'overview' | 'payments' | 'users' | 'bank' | 'flashcards' | 'config'>('overview');
  const [bankSubTab, setBankSubTab] = useState<'directory' | 'import' | 'stats'>('directory');

  // Metrics state (integrated with live Supabase telemetry)
  const [metrics, setMetrics] = useState<AdminMetrics>(getDashboardMetrics());

  // Payment Requests State
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>(getPaymentRequests());
  const [requestFilter, setRequestFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');

  // User Management State (integrated with live Supabase user directory)
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [userList, setUserList] = useState<User[]>(getUsers(''));
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserDetails, setSelectedUserDetails] = useState<any>(null);

  // Config State (integrated with server AdminConfig endpoint)
  const [config, setConfig] = useState<AdminConfig>(getAdminConfig());
  const [configSaved, setConfigSaved] = useState(false);

  // Load metrics when tab changes or on mount
  useEffect(() => {
    let isMounted = true;
    fetchAdminMetricsFromSupabase().then((m) => {
      if (isMounted) setMetrics(m);
    });
    return () => { isMounted = false; };
  }, [activeTab]);

  // Load payment requests when activeTab is 'payments' or filter changes or on mount
  useEffect(() => {
    let isMounted = true;
    fetchAdminPaymentsFromSupabase(requestFilter).then((reqs) => {
      if (isMounted) setPaymentRequests(reqs);
    });
    return () => { isMounted = false; };
  }, [activeTab, requestFilter]);

  // Load user directory when active tab is 'users' or search query changes
  useEffect(() => {
    let isMounted = true;
    fetchAdminUsersFromSupabase(searchQuery).then((users) => {
      if (isMounted) setUserList(users);
    });
    return () => { isMounted = false; };
  }, [activeTab, searchQuery]);

  // Load user details when selected user changes
  useEffect(() => {
    if (!selectedUserId) {
      setSelectedUserDetails(null);
      return;
    }
    let isMounted = true;
    fetchUserDetailsFromSupabase(selectedUserId).then((details) => {
      if (isMounted) setSelectedUserDetails(details);
    });
    return () => { isMounted = false; };
  }, [selectedUserId]);

  // Load admin config on mount or tab change
  useEffect(() => {
    let isMounted = true;
    fetchAdminConfigFromSupabase().then((cfg) => {
      if (isMounted) setConfig(cfg);
    });
    return () => { isMounted = false; };
  }, [activeTab]);

  const refreshPaymentsAndMetrics = () => {
    fetchAdminPaymentsFromSupabase(requestFilter).then(setPaymentRequests);
    fetchAdminMetricsFromSupabase().then(setMetrics);
    if (onRefreshData) onRefreshData();
  };

  const handleApprove = async (reqId: string) => {
    const confirmed = window.confirm(
      "هل أنت متأكد من الموافقة على طلب الدفع؟\n\nسيتم تفعيل اشتراك المستخدم بعد الموافقة."
    );
    if (!confirmed) return;

    try {
      approvePaymentRequest(reqId, adminUser.telegramId);
    } catch (e) {
      console.warn("Local storage approve fallback warning:", e);
    }
    const ok = await approvePaymentInSupabase(reqId);
    if (ok) {
      await syncSubscriptionFromSupabase().catch(() => {});
      refreshPaymentsAndMetrics();
      const updatedUsers = await fetchAdminUsersFromSupabase(searchQuery);
      setUserList(updatedUsers);
      if (onRefreshData) onRefreshData();
    } else {
      alert("فشل الموافقة على طلب الدفع.");
    }
  };

  const handleReject = async (reqId: string) => {
    const confirmed = window.confirm("هل أنت متأكد من رفض طلب الدفع؟");
    if (!confirmed) return;

    try {
      rejectPaymentRequest(reqId, adminUser.telegramId);
    } catch (e) {
      console.warn("Local storage reject fallback warning:", e);
    }
    const ok = await rejectPaymentInSupabase(reqId);
    if (ok) {
      refreshPaymentsAndMetrics();
      const updatedUsers = await fetchAdminUsersFromSupabase(searchQuery);
      setUserList(updatedUsers);
      if (onRefreshData) onRefreshData();
    } else {
      alert("فشل رفض طلب الدفع.");
    }
  };

  const handleExtendUser = async (userId: string, days: number) => {
    try {
      extendSubscription(userId, days, adminUser.telegramId);
    } catch (e) {}
    await extendSubscriptionInSupabase(userId, days);
    const updatedUsers = await fetchAdminUsersFromSupabase(searchQuery);
    setUserList(updatedUsers);
    refreshPaymentsAndMetrics();
    if (selectedUserId === userId) {
      const details = await fetchUserDetailsFromSupabase(userId);
      setSelectedUserDetails(details);
    }
    if (onRefreshData) onRefreshData();
  };

  const handleDeactivateUser = async (userId: string) => {
    try {
      deactivateSubscription(userId);
    } catch (e) {}
    await cancelSubscriptionInSupabase(userId);
    const updatedUsers = await fetchAdminUsersFromSupabase(searchQuery);
    setUserList(updatedUsers);
    refreshPaymentsAndMetrics();
    if (selectedUserId === userId) {
      const details = await fetchUserDetailsFromSupabase(userId);
      setSelectedUserDetails(details);
    }
    if (onRefreshData) onRefreshData();
  };

  const handleToggleAccountActive = async (targetId: string, currentIsActive: boolean) => {
    try {
      const newStatus = !currentIsActive;
      await updateUserStatusInSupabase(targetId, newStatus);
      const updatedUsers = await fetchAdminUsersFromSupabase(searchQuery);
      setUserList(updatedUsers);
      if (selectedUserId === targetId) {
        const details = await fetchUserDetailsFromSupabase(targetId);
        setSelectedUserDetails(details);
      }
      if (onRefreshData) onRefreshData();
    } catch (err: any) {
      alert("فشل تغيير حالة الحساب: " + (err.message || "حدث خطأ أثناء التحديث"));
    }
  };

  const handleDeleteUser = async (targetId: string, userName: string) => {
    if (window.confirm(`هل أنت متأكد من حذف هذا المستخدم (${userName})؟\n\nهذا الإجراء لا يمكن التراجع عنه.`)) {
      try {
        await deleteUserInSupabase(targetId);
        const updatedUsers = await fetchAdminUsersFromSupabase(searchQuery);
        setUserList(updatedUsers);
        refreshPaymentsAndMetrics();
        if (onRefreshData) onRefreshData();
      } catch (err: any) {
        alert("فشل حذف المستخدم: " + (err.message || "حدث خطأ أثناء الحذف"));
      }
    }
  };

  const handleDisableAllSubscriptions = async () => {
    const confirmed = window.confirm(
      "هل أنت متأكد؟\n\nسيتم إلغاء جميع الاشتراكات النشطة لجميع المستخدمين."
    );
    if (!confirmed) return;

    try {
      const result = await disableAllSubscriptionsInSupabase();
      if (result.success) {
        alert(`تم إلغاء جميع الاشتراكات بنجاح. عدد الاشتراكات الملغاة: ${result.affected}`);
        const updatedUsers = await fetchAdminUsersFromSupabase(searchQuery);
        setUserList(updatedUsers);
        refreshPaymentsAndMetrics();
        if (onRefreshData) onRefreshData();
      } else {
        alert("فشل إلغاء الاشتراكات.");
      }
    } catch (err: any) {
      alert("حدث خطأ أثناء إلغاء جميع الاشتراكات: " + (err.message || "خطأ غير معروف"));
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated = await updateAdminConfigInSupabase(config);
    setConfig(updated);
    setConfigSaved(true);
    setTimeout(() => setConfigSaved(false), 2500);
  };

  const filteredRequests = paymentRequests.filter((r) => {
    if (requestFilter === 'ALL') return true;
    return r.status === requestFilter;
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* Header Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/50 border border-slate-800 p-6 md:p-8 shadow-xl">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Admin Control Center</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-100">
            U JO Resident Administration
          </h1>
          <p className="text-xs text-slate-400 max-w-xl">
            Review manual payment activations, manage user subscriptions, inspect usage stats, and update system parameters.
          </p>
        </div>
      </div>

      {/* Navigation Tabs Bar */}
      <div className="flex border-b border-slate-800 overflow-x-auto gap-2 pb-1 scrollbar-none">
        {[
          { id: 'overview', label: 'Overview Metrics', icon: BarChart2 },
          {
            id: 'payments',
            label: 'Payment Requests',
            icon: CreditCard,
            badge: metrics.pendingPaymentRequests
          },
          { id: 'users', label: 'User Directory', icon: Users },
          { id: 'bank', label: 'Bank Inventory', icon: BookOpen },
          { id: 'flashcards', label: 'Flashcards', icon: Layers },
          { id: 'config', label: 'System Config', icon: Settings }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 border ${
                isActive
                  ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md shadow-cyan-500/20'
                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              {Boolean(tab.badge && tab.badge > 0) && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-extrabold">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab 1: Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-1">
              <div className="text-[11px] font-semibold text-slate-400 uppercase">Total Users</div>
              <div className="text-2xl font-black text-slate-100">{metrics.totalUsers}</div>
            </div>

            <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-1">
              <div className="text-[11px] font-semibold text-slate-400 uppercase">Active Subs</div>
              <div className="text-2xl font-black text-emerald-400">{metrics.activeSubscribers}</div>
            </div>

            <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-1">
              <div className="text-[11px] font-semibold text-slate-400 uppercase">Expired Subs</div>
              <div className="text-2xl font-black text-rose-400">{metrics.expiredSubscribers}</div>
            </div>

            <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-1">
              <div className="text-[11px] font-semibold text-slate-400 uppercase">Pending Payments</div>
              <div className="text-2xl font-black text-amber-400">{metrics.pendingPaymentRequests}</div>
            </div>

            <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-1">
              <div className="text-[11px] font-semibold text-slate-400 uppercase">Questions Solved</div>
              <div className="text-2xl font-black text-cyan-400">{metrics.questionsSolved.toLocaleString()}</div>
            </div>

            <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-1">
              <div className="text-[11px] font-semibold text-slate-400 uppercase">Active Blocks</div>
              <div className="text-2xl font-black text-purple-400">{metrics.activeBlocks}</div>
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Administrative Quick Actions
            </h3>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setActiveTab('payments')}
                className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center gap-2 transition-all shadow-md shadow-amber-500/20"
              >
                <CreditCard className="w-4 h-4" />
                <span>Review Pending Payments ({metrics.pendingPaymentRequests})</span>
              </button>

              <button
                onClick={() => setActiveTab('users')}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center gap-2 transition-all"
              >
                <Users className="w-4 h-4 text-cyan-400" />
                <span>Manage Users & Subscriptions</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Payment Requests Queue */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {(['PENDING', 'ALL', 'APPROVED', 'REJECTED'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setRequestFilter(filter)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                    requestFilter === filter
                      ? 'bg-cyan-500 text-slate-950 border-cyan-400'
                      : 'bg-slate-900 text-slate-300 border-slate-800'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          {filteredRequests.length === 0 ? (
            <div className="p-12 text-center bg-slate-900/90 border border-slate-800 rounded-2xl space-y-2">
              <CreditCard className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-xs text-slate-400">No payment requests matching filter.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg"
                >
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-sm text-slate-100">
                        @{req.telegramUsername}
                      </span>
                      <span className="text-slate-400">(User ID: {req.userId})</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                          req.status === 'APPROVED'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : req.status === 'PENDING'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        }`}
                      >
                        {req.status}
                      </span>
                    </div>

                    <div className="text-slate-300 font-medium">
                      Amount: <strong className="text-cyan-400">{req.amount} JOD</strong> via{' '}
                      <strong>{req.paymentMethod}</strong>
                      {req.referenceNumber && (
                        <span>
                          {' '}
                          (Ref: <code className="text-amber-300">{req.referenceNumber}</code>)
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-500">
                      Submitted: {new Date(req.createdAt).toLocaleString()}
                    </div>

                    {/* Proof image display */}
                    {(req.id || req.proofFileUrl || (req.proofFileId && req.proofFileId !== 'telegram_photo_receipt')) && (
                      <div className="mt-2 pt-2 border-t border-slate-800/80">
                        <div className="text-[11px] font-bold text-slate-400 mb-1.5 flex items-center gap-1.5">
                          <Eye className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Proof of Payment / receipt:</span>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <img
                            src={`/api/admin/payments/${encodeURIComponent(req.id)}/proof`}
                            alt="Receipt proof"
                            className="max-h-52 max-w-sm rounded-xl border border-slate-700/80 object-contain bg-slate-950 p-1 shadow-md"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                          <a
                            href={`/api/admin/payments/${encodeURIComponent(req.id)}/proof`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 underline inline-flex items-center gap-1"
                          >
                            <span>Open image in new tab ↗</span>
                          </a>
                        </div>
                      </div>
                    )}
                  </div>

                  {req.status === 'PENDING' && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleApprove(req.id)}
                        className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-emerald-500/20"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Approve & Activate</span>
                      </button>

                      <button
                        onClick={() => handleReject(req.id)}
                        className="px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold text-xs flex items-center gap-1 transition-all"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>Reject</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: User Directory */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search users by name, username, or Telegram ID..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>
            <button
              onClick={handleDisableAllSubscriptions}
              className="px-4 py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold text-xs flex items-center justify-center gap-2 transition-all shrink-0"
              title="إلغاء جميع الاشتراكات النشطة لجميع المستخدمين عند انتهاء فترة الفحص/الامتحانات"
            >
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              <span>إلغاء جميع الاشتراكات</span>
            </button>
          </div>

          <div className="space-y-3">
            {userList.map((u) => {
              const uDetails = getUserDetails(u.telegramId);
              const sub = uDetails.subscription;
              const isSubActive = (u as any).subscriptionStatus === 'ACTIVE' || sub.status === 'ACTIVE';

              return (
                <div
                  key={u.telegramId || u.id}
                  className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg"
                >
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <strong className="text-slate-100 text-sm font-bold">
                        {u.firstName} {u.lastName}
                      </strong>
                      <span className="text-slate-400">@{u.username}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                          isSubActive
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                        title="حالة الاشتراك"
                      >
                        {isSubActive ? '🟢 اشتراك نشط' : '⚪ لا يوجد اشتراك نشط'}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                          u.isActive !== false
                            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                            : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        }`}
                        title="حالة الحساب"
                      >
                        {u.isActive !== false ? '🟢 الحساب نشط' : '🔴 الحساب معطل'}
                      </span>
                    </div>

                    <div className="text-slate-400">
                      Telegram ID: {u.telegramId} • Solved:{' '}
                      <strong className="text-cyan-400">{uDetails.studyStats.totalQuestionsSolved} Qs</strong>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      onClick={() => setSelectedUserId(u.telegramId || u.id)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition-all flex items-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5 text-cyan-400" />
                      <span>فحص</span>
                    </button>

                    {/* Account Status Control */}
                    {u.isActive !== false ? (
                      <button
                        onClick={() => handleToggleAccountActive(u.telegramId || u.id, true)}
                        className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold transition-all"
                        title="تعطيل الحساب بالكامل"
                      >
                        تعطيل الحساب
                      </button>
                    ) : (
                      <button
                        onClick={() => handleToggleAccountActive(u.telegramId || u.id, false)}
                        className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-extrabold transition-all"
                        title="إعادة تفعيل الحساب"
                      >
                        تفعيل الحساب
                      </button>
                    )}

                    {/* Subscription Status Control */}
                    <button
                      onClick={() => handleExtendUser(u.telegramId, 30)}
                      className="px-2.5 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-bold transition-all flex items-center gap-1"
                      title="تمديد الاشتراك 30 يومًا"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+30D</span>
                    </button>

                    {isSubActive ? (
                      <button
                        onClick={() => handleDeactivateUser(u.telegramId)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-bold transition-all"
                        title="إلغاء تفعيل الاشتراك فقط"
                      >
                        إلغاء الاشتراك
                      </button>
                    ) : (
                      <button
                        onClick={() => handleExtendUser(u.telegramId, 30)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold transition-all"
                        title="تفعيل اشتراك المستخدم"
                      >
                        تفعيل الاشتراك
                      </button>
                    )}

                    {/* Delete User */}
                    <button
                      onClick={() => handleDeleteUser(u.telegramId || u.id, `${u.firstName} ${u.lastName}`)}
                      className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-bold transition-all flex items-center gap-1"
                      title="حذف المستخدم نهائيًا من قاعدة البيانات"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                      <span>حذف</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 4: Question Bank Management */}
      {activeTab === 'bank' && (
        <div className="space-y-4">
          {/* Sub Navigation Bar for Bank Section */}
          <div className="flex items-center gap-2 p-1 rounded-2xl bg-slate-900 border border-slate-800 text-xs font-bold">
            <button
              onClick={() => setBankSubTab('directory')}
              className={`flex-1 py-2 rounded-xl transition-all ${
                bankSubTab === 'directory'
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Question Directory
            </button>
            <button
              onClick={() => setBankSubTab('import')}
              className={`flex-1 py-2 rounded-xl transition-all ${
                bankSubTab === 'import'
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Import Questions as Text
            </button>
            <button
              onClick={() => setBankSubTab('stats')}
              className={`flex-1 py-2 rounded-xl transition-all ${
                bankSubTab === 'stats'
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Bank Statistics
            </button>
          </div>

          {/* Sub Tab Views */}
          {bankSubTab === 'directory' && (
            <AdminQuestionTable
              adminUserId={adminUser.telegramId || adminUser.username}
            />
          )}

          {bankSubTab === 'import' && (
            <AdminImportWizard
              adminUserId={adminUser.telegramId || adminUser.username}
              onImportCompleted={() => {
                // Return to directory after import completes
              }}
              onCancel={() => setBankSubTab('directory')}
            />
          )}

          {bankSubTab === 'stats' && <AdminQuestionStats />}
        </div>
      )}

      {/* Tab 5: Flashcards */}
      {activeTab === 'flashcards' && <AdminFlashcardsManager />}

      {/* Tab 6: System Configuration */}
      {activeTab === 'config' && (
        <form
          onSubmit={handleSaveConfig}
          className="rounded-2xl bg-slate-900/90 border border-slate-800 p-6 space-y-5 shadow-xl"
        >
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 pb-2 border-b border-slate-800 flex items-center gap-2">
            <Settings className="w-4 h-4 text-cyan-400" />
            <span>Editable System Parameters</span>
          </h3>

          {configSaved && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center gap-2">
              <Check className="w-4 h-4" />
              <span>Configuration parameters saved successfully!</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-300">Zain Cash / CliQ Phone Number</label>
              <input
                type="text"
                value={config.paymentPhoneNumber}
                onChange={(e) => setConfig({ ...config, paymentPhoneNumber: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-300">Account Name</label>
              <input
                type="text"
                value={config.paymentAccountName}
                onChange={(e) => setConfig({ ...config, paymentAccountName: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-300">Subscription Price (JOD)</label>
              <input
                type="number"
                value={config.subscriptionPrice}
                onChange={(e) => setConfig({ ...config, subscriptionPrice: Number(e.target.value) })}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-300">Pass Duration (Days)</label>
              <input
                type="number"
                value={config.subscriptionDurationDays}
                onChange={(e) => setConfig({ ...config, subscriptionDurationDays: Number(e.target.value) })}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5 text-xs">
            <label className="font-semibold text-slate-300">Payment Instructions Text</label>
            <textarea
              rows={3}
              value={config.paymentInstructions}
              onChange={(e) => setConfig({ ...config, paymentInstructions: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-cyan-500 transition-colors"
            />
          </div>

          <button
            type="submit"
            className="py-3 px-6 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-cyan-500/20"
          >
            <Save className="w-4 h-4" />
            <span>Save Admin Configuration</span>
          </button>
        </form>
      )}

      {/* User Inspection Modal */}
      {selectedUserId && selectedUserDetails && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-lg font-bold text-slate-100">
                  {selectedUserDetails.user.firstName} {selectedUserDetails.user.lastName}
                </h3>
                <p className="text-xs text-slate-400">
                  @{selectedUserDetails.user.username || 'no_username'} • Telegram ID: {selectedUserDetails.user.telegramId}
                </p>
              </div>
              <button
                onClick={() => setSelectedUserId(null)}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-all"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-950 rounded-xl space-y-1 border border-slate-800">
                <div className="text-slate-400 font-semibold">Active Subscription</div>
                <div className="text-emerald-400 font-bold uppercase">{selectedUserDetails.subscription?.status || 'INACTIVE'}</div>
                <div className="text-[11px] text-slate-400">Plan: {selectedUserDetails.subscription?.plan}</div>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl space-y-1 border border-slate-800">
                <div className="text-slate-400 font-semibold">Questions Solved</div>
                <div className="text-cyan-400 font-bold text-base">{selectedUserDetails.studyStats?.totalQuestionsSolved || 0}</div>
                <div className="text-[11px] text-slate-400">Accuracy: {selectedUserDetails.studyStats?.accuracyPercentage || 0}%</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs text-center">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <div className="text-slate-400">Correct Answers</div>
                <div className="text-emerald-400 font-bold text-sm mt-0.5">{selectedUserDetails.studyStats?.totalCorrect || 0}</div>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <div className="text-slate-400">Completed Blocks</div>
                <div className="text-purple-400 font-bold text-sm mt-0.5">{selectedUserDetails.studyStats?.blocksCompleted || 0}</div>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <div className="text-slate-400">Active Blocks</div>
                <div className="text-amber-400 font-bold text-sm mt-0.5">{selectedUserDetails.studyStats?.activeBlocksCount || 0}</div>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-slate-800">
              <button
                onClick={() => setSelectedUserId(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all"
              >
                Close Profile
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
