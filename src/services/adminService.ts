import { User, AdminMetrics, PaymentRequest, AdminConfig } from '../types';
import { getPaymentRequests, getSubscriptionStatus, getAdminConfig, saveAdminConfig } from './subscriptionService';
import { getUserStudyStats } from './progressService';
import { isAdminUser, verifyTelegramAdminAuthorization, syncUserToSupabase, getCurrentUser } from './authService';
import { getStoredQuestions, getAllStoredBlocks } from './questionBankService';

const USERS_STORAGE_KEY = 'ujo_users_v1';

export const getStoredUsers = (): User[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error('Error reading stored users:', e);
  }
  return [];
};

export const saveStoredUsers = (users: User[]): void => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
  }
};

export const registerOrUpdateUser = (user: User): void => {
  const users = getStoredUsers();
  const existingIdx = users.findIndex((u) => u.telegramId === user.telegramId);
  let updatedUser: User;
  if (existingIdx >= 0) {
    updatedUser = { ...users[existingIdx], ...user, lastActiveAt: new Date().toISOString() };
    users[existingIdx] = updatedUser;
  } else {
    updatedUser = { ...user, firstSeenAt: new Date().toISOString(), lastActiveAt: new Date().toISOString() };
    users.push(updatedUser);
  }
  saveStoredUsers(users);
  syncUserToSupabase(updatedUser).catch(() => {});
};

export const checkAdminPermission = (userId?: string): void => {
  if (!verifyTelegramAdminAuthorization(userId)) {
    throw new Error('UNAUTHORIZED_ADMIN_ONLY: Access denied. Server-side admin authorization required.');
  }
};

export const getUsers = (searchQuery?: string): User[] => {
  checkAdminPermission();
  const users = getStoredUsers();
  if (!searchQuery || !searchQuery.trim()) {
    return users;
  }
  const q = searchQuery.toLowerCase().trim();
  return users.filter(
    (u) =>
      u.telegramId.includes(q) ||
      (u.username && u.username.toLowerCase().includes(q)) ||
      `${u.firstName} ${u.lastName}`.toLowerCase().includes(q)
  );
};

export const getUserDetails = (userId: string) => {
  checkAdminPermission();
  const users = getStoredUsers();
  const user = users.find((u) => u.telegramId === userId) || {
    telegramId: userId,
    username: `user_${userId}`,
    firstName: 'Resident',
    lastName: 'Candidate',
    role: 'user' as const,
    firstSeenAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString()
  };

  const subscription = getSubscriptionStatus(userId);
  const studyStats = getUserStudyStats(userId);

  return {
    user,
    subscription,
    studyStats
  };
};

export const getDashboardMetrics = (): AdminMetrics => {
  checkAdminPermission();
  const pendingRequests = getPaymentRequests('PENDING');
  const storedUsers = getStoredUsers();
  const blocks = getAllStoredBlocks();

  let activeSubscribers = 0;
  let expiredSubscribers = 0;

  storedUsers.forEach((u) => {
    const sub = getSubscriptionStatus(u.telegramId);
    if (sub.status === 'ACTIVE') activeSubscribers++;
    if (sub.status === 'EXPIRED') expiredSubscribers++;
  });

  let questionsSolved = 0;
  let activeBlocks = 0;

  blocks.forEach((b) => {
    if (b.status === 'ACTIVE') activeBlocks++;
    if (b.answers) {
      questionsSolved += Object.keys(b.answers).length;
    }
  });

  return {
    totalUsers: storedUsers.length,
    activeSubscribers,
    expiredSubscribers,
    pendingPaymentRequests: pendingRequests.length,
    questionsSolved,
    activeBlocks,
    recentlyActiveUsers: storedUsers.filter((u) => {
      if (!u.lastActiveAt) return false;
      const diffMs = Date.now() - new Date(u.lastActiveAt).getTime();
      return diffMs <= 7 * 24 * 3600 * 1000; // active in last 7 days
    }).length
  };
};

// Phase 6: Supabase Live Server Integration Functions with LocalStorage Fallback

export const fetchAdminMetricsFromSupabase = async (): Promise<AdminMetrics> => {
  try {
    const user = getCurrentUser();
    const headers: Record<string, string> = {
      'x-telegram-user-id': user.telegramId || '',
      'x-telegram-username': user.username || ''
    };

    const response = await fetch('/api/admin/metrics', { headers });
    if (response.ok) {
      const data = await response.json();
      if (data.metrics) {
        return data.metrics;
      }
    }
  } catch (err) {
    console.warn("fetchAdminMetricsFromSupabase failed, using local storage metrics fallback:", err);
  }
  return getDashboardMetrics();
};

export const fetchAdminUsersFromSupabase = async (searchQuery?: string): Promise<User[]> => {
  try {
    const user = getCurrentUser();
    const headers: Record<string, string> = {
      'x-telegram-user-id': user.telegramId || '',
      'x-telegram-username': user.username || ''
    };

    const url = searchQuery && searchQuery.trim()
      ? `/api/admin/users?q=${encodeURIComponent(searchQuery.trim())}`
      : '/api/admin/users';

    const response = await fetch(url, { headers });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data.users)) {
        saveStoredUsers(data.users);
        return data.users;
      }
    }
  } catch (err) {
    console.warn("fetchAdminUsersFromSupabase failed, using local storage users fallback:", err);
  }
  return getUsers(searchQuery);
};

export const fetchUserDetailsFromSupabase = async (userId: string) => {
  try {
    const user = getCurrentUser();
    const headers: Record<string, string> = {
      'x-telegram-user-id': user.telegramId || '',
      'x-telegram-username': user.username || ''
    };

    const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { headers });
    if (response.ok) {
      const data = await response.json();
      if (data.user) {
        return {
          user: data.user,
          subscription: data.subscription,
          studyStats: data.studyStats
        };
      }
    }
  } catch (err) {
    console.warn("fetchUserDetailsFromSupabase failed, using local details fallback:", err);
  }
  return getUserDetails(userId);
};

export const fetchAdminConfigFromSupabase = async (): Promise<AdminConfig> => {
  try {
    const user = getCurrentUser();
    const headers: Record<string, string> = {
      'x-telegram-user-id': user.telegramId || '',
      'x-telegram-username': user.username || ''
    };

    const response = await fetch('/api/admin/config', { headers });
    if (response.ok) {
      const data = await response.json();
      if (data.config) {
        saveAdminConfig(data.config);
        return data.config;
      }
    }
  } catch (err) {
    console.warn("fetchAdminConfigFromSupabase failed, using local config fallback:", err);
  }
  return getAdminConfig();
};

export const updateAdminConfigInSupabase = async (config: AdminConfig): Promise<AdminConfig> => {
  try {
    saveAdminConfig(config);
    const user = getCurrentUser();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-telegram-user-id': user.telegramId || '',
      'x-telegram-username': user.username || ''
    };

    const response = await fetch('/api/admin/config', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ config })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.config) {
        saveAdminConfig(data.config);
        return data.config;
      }
    }
  } catch (err) {
    console.warn("updateAdminConfigInSupabase failed, saved in local storage:", err);
  }
  return config;
};

export const fetchAdminPaymentsFromSupabase = async (statusFilter?: string): Promise<PaymentRequest[]> => {
  try {
    const user = getCurrentUser();
    const headers: Record<string, string> = {
      'x-telegram-user-id': user.telegramId || '',
      'x-telegram-username': user.username || ''
    };

    const url = statusFilter && statusFilter !== 'ALL'
      ? `/api/admin/payments?status=${encodeURIComponent(statusFilter)}`
      : '/api/admin/payments';

    const response = await fetch(url, { headers });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data.payments)) {
        return data.payments.map((p: any) => ({
          id: p.id || p.customId || p.custom_id,
          userId: String(p.telegramUserId || p.telegram_user_id || p.userId || p.user_id),
          amount: p.amountSyp || p.amount_syp || p.amount || 25,
          paymentMethod: p.paymentMethod || p.payment_method || 'Zain Cash',
          referenceNumber: p.transactionRef || p.transaction_ref || undefined,
          proofFileId: p.proofFileId || p.proof_file_id || undefined,
          proofFileUrl: p.proofFileUrl || p.proof_file_url || undefined,
          telegramUsername: p.telegramUsername || p.telegram_username || `user_${p.telegramUserId || p.telegram_user_id || p.userId}`,
          status: p.status || 'PENDING',
          createdAt: p.createdAt || p.created_at || new Date().toISOString()
        }));
      }
    }
  } catch (err) {
    console.warn("fetchAdminPaymentsFromSupabase failed, using local storage payment requests fallback:", err);
  }
  return getPaymentRequests(statusFilter as any);
};

export const approvePaymentInSupabase = async (paymentId: string): Promise<boolean> => {
  try {
    const user = getCurrentUser();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-telegram-user-id': user.telegramId || '',
      'x-telegram-username': user.username || ''
    };

    const response = await fetch(`/api/admin/payments/${encodeURIComponent(paymentId)}/approve`, {
      method: 'POST',
      headers
    });

    if (response.ok) {
      const data = await response.json();
      return Boolean(data.approved || data.success);
    }
  } catch (err) {
    console.error("Error approving payment in Supabase:", err);
  }
  return false;
};

export const rejectPaymentInSupabase = async (paymentId: string): Promise<boolean> => {
  try {
    const user = getCurrentUser();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-telegram-user-id': user.telegramId || '',
      'x-telegram-username': user.username || ''
    };

    const response = await fetch(`/api/admin/payments/${encodeURIComponent(paymentId)}/reject`, {
      method: 'POST',
      headers
    });

    if (response.ok) {
      const data = await response.json();
      return Boolean(data.rejected || data.success);
    }
  } catch (err) {
    console.error("Error rejecting payment in Supabase:", err);
  }
  return false;
};

export const updateUserStatusInSupabase = async (userId: string, isActive: boolean): Promise<boolean> => {
  try {
    const user = getCurrentUser();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-telegram-user-id': user.telegramId || '',
      'x-telegram-username': user.username || ''
    };

    const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ is_active: isActive })
    });

    if (response.ok) {
      const users = getStoredUsers().map((u) => {
        if (u.telegramId === userId || (u as any).id === userId) {
          return { ...u, isActive };
        }
        return u;
      });
      saveStoredUsers(users);
      return true;
    } else {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to update user status.');
    }
  } catch (err: any) {
    console.error("Error updating user status in Supabase:", err);
    throw err;
  }
};

export const deleteUserInSupabase = async (userId: string): Promise<boolean> => {
  try {
    const user = getCurrentUser();
    const headers: Record<string, string> = {
      'x-telegram-user-id': user.telegramId || '',
      'x-telegram-username': user.username || ''
    };

    const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers
    });

    if (response.ok) {
      const users = getStoredUsers().filter((u) => u.telegramId !== userId && (u as any).id !== userId);
      saveStoredUsers(users);
      return true;
    } else {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to delete user.');
    }
  } catch (err: any) {
    console.error("Error deleting user in Supabase:", err);
    throw err;
  }
};

export const extendSubscriptionInSupabase = async (userId: string, days: number = 30): Promise<boolean> => {
  try {
    const user = getCurrentUser();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-telegram-user-id': user.telegramId || '',
      'x-telegram-username': user.username || ''
    };

    const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/subscription/extend`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ days })
    });

    if (response.ok) {
      return true;
    }
  } catch (err) {
    console.error("Error extending subscription in Supabase:", err);
  }
  return false;
};

export const cancelSubscriptionInSupabase = async (userId: string): Promise<boolean> => {
  try {
    const user = getCurrentUser();
    const headers: Record<string, string> = {
      'x-telegram-user-id': user.telegramId || '',
      'x-telegram-username': user.username || ''
    };

    const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/subscription/cancel`, {
      method: 'POST',
      headers
    });

    if (response.ok) {
      return true;
    }
  } catch (err) {
    console.error("Error canceling subscription in Supabase:", err);
  }
  return false;
};

export const disableAllSubscriptionsInSupabase = async (): Promise<{ success: boolean; affected: number }> => {
  try {
    const user = getCurrentUser();
    const headers: Record<string, string> = {
      'x-telegram-user-id': user.telegramId || '',
      'x-telegram-username': user.username || ''
    };

    const response = await fetch('/api/admin/subscriptions/cancel-all', {
      method: 'POST',
      headers
    });

    if (response.ok) {
      const data = await response.json();
      return { success: true, affected: data.affected || 0 };
    }
  } catch (err) {
    console.error("Error canceling all subscriptions in Supabase:", err);
  }
  return { success: false, affected: 0 };
};

export { getAdminConfig, saveAdminConfig };


