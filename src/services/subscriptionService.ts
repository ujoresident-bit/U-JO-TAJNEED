import { Subscription, SubscriptionStatus, PaymentRequest, PaymentRequestStatus, AdminConfig } from '../types';
import { getCanonicalTelegramUser, getCanonicalTelegramUserId, getCurrentUser, verifyTelegramAdminAuthorization, isTelegramEnvironment } from './authService';
import { INITIAL_ADMIN_CONFIG } from './demoData';

const BANK_ID = 'moh_bank';

// In-memory + LocalStorage cache
const STORAGE_KEYS = {
  SUBSCRIPTIONS: 'ujo_subscriptions_v1',
  PAYMENT_REQUESTS: 'ujo_payment_requests_v1',
  ADMIN_CONFIG: 'ujo_admin_config_v1'
};

// In-memory fallback for non-browser/SSR environments
const memoryStorage: Record<string, string> = {};

export const getStoredSubscriptions = (): Record<string, Subscription> => {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEYS.SUBSCRIPTIONS);
      if (raw) return JSON.parse(raw);
    } else if (memoryStorage[STORAGE_KEYS.SUBSCRIPTIONS]) {
      return JSON.parse(memoryStorage[STORAGE_KEYS.SUBSCRIPTIONS]);
    }
  } catch (e) {
    console.error('Error reading subscriptions:', e);
  }
  return {};
};

export const saveStoredSubscriptions = (subs: Record<string, Subscription>) => {
  const serialized = JSON.stringify(subs);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.SUBSCRIPTIONS, serialized);
  } else {
    memoryStorage[STORAGE_KEYS.SUBSCRIPTIONS] = serialized;
  }
};

const getStoredPaymentRequests = (): PaymentRequest[] => {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEYS.PAYMENT_REQUESTS);
      if (raw) return JSON.parse(raw);
    } else if (memoryStorage[STORAGE_KEYS.PAYMENT_REQUESTS]) {
      return JSON.parse(memoryStorage[STORAGE_KEYS.PAYMENT_REQUESTS]);
    }
  } catch (e) {
    console.error('Error reading payment requests:', e);
  }
  return [];
};

const saveStoredPaymentRequests = (requests: PaymentRequest[]) => {
  const serialized = JSON.stringify(requests);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.PAYMENT_REQUESTS, serialized);
  } else {
    memoryStorage[STORAGE_KEYS.PAYMENT_REQUESTS] = serialized;
  }
};

export const getAdminConfig = (): AdminConfig => {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ADMIN_CONFIG);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.error('Error reading admin config:', e);
    }
  }
  return INITIAL_ADMIN_CONFIG;
};

export const saveAdminConfig = (config: AdminConfig): void => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.ADMIN_CONFIG, JSON.stringify(config));
  }
};

// Returns current subscription for a given user & bank
export const getSubscriptionStatus = (userId: string, bankId: string = BANK_ID): Subscription => {
  const user = getCurrentUser(userId);
  const canonicalUserId = user.telegramId || userId;

  if (verifyTelegramAdminAuthorization(canonicalUserId) || verifyTelegramAdminAuthorization(user.username)) {
    return {
      userId: canonicalUserId,
      bankId,
      status: 'ACTIVE',
      plan: 'Admin Pass'
    };
  }

  const subs = getStoredSubscriptions();
  const userSubKey = `${canonicalUserId}_${bankId}`;

  let sub = subs[userSubKey];

  // Fallback search if not found under exact userSubKey
  if (!sub) {
    const altKeys = [
      user.telegramId ? `${user.telegramId}_${bankId}` : null,
      user.username ? `${user.username}_${bankId}` : null
    ].filter(Boolean) as string[];

    for (const altKey of altKeys) {
      if (subs[altKey]) {
        sub = subs[altKey];
        break;
      }
    }
  }

  if (sub) {
    const rawStatus = String(sub.status || '').toUpperCase();
    let isExpired = false;
    if (sub.expiryDate && new Date(sub.expiryDate).getTime() <= Date.now()) {
      isExpired = true;
    }

    if ((rawStatus === 'ACTIVE' || rawStatus === 'APPROVED') && !isExpired) {
      sub.status = 'ACTIVE';
    } else if (isExpired || rawStatus === 'EXPIRED') {
      sub.status = 'EXPIRED';
      subs[userSubKey] = sub;
      saveStoredSubscriptions(subs);
    } else if (rawStatus === 'PENDING') {
      sub.status = 'PENDING';
    } else {
      sub.status = 'INACTIVE';
    }

    return sub;
  }

  return {
    userId: canonicalUserId,
    bankId,
    status: 'INACTIVE',
    plan: 'MOH Monthly Pass'
  };
};

export const submitPaymentRequest = (data: {
  paymentMethod: 'Zain Cash' | 'CliQ';
  amount: number;
  referenceNumber?: string;
  telegramUsername: string;
  userId?: string;
}): PaymentRequest => {
  const user = getCurrentUser(data.userId);
  const config = getAdminConfig();
  const requests = getStoredPaymentRequests();

  const newRequest: PaymentRequest = {
    id: `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    userId: user.telegramId,
    amount: data.amount || config.subscriptionPrice,
    paymentMethod: data.paymentMethod,
    referenceNumber: data.referenceNumber,
    telegramUsername: data.telegramUsername || user.username || `tg_${user.telegramId}`,
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };

  requests.unshift(newRequest);
  saveStoredPaymentRequests(requests);

  // Update user subscription state to PENDING if not active
  const subs = getStoredSubscriptions();
  const userSubKey = `${user.telegramId}_${BANK_ID}`;
  const currentSub = subs[userSubKey] || { userId: user.telegramId, bankId: BANK_ID, plan: 'MOH Monthly Pass', status: 'INACTIVE' };

  if (currentSub.status !== 'ACTIVE') {
    currentSub.status = 'PENDING';
    subs[userSubKey] = currentSub;
    saveStoredSubscriptions(subs);
  }

  return newRequest;
};

export const approvePaymentRequest = (requestId: string, adminId: string): Subscription => {
  const requests = getStoredPaymentRequests();
  const reqIndex = requests.findIndex((r) => r.id === requestId);
  let req = reqIndex !== -1 ? requests[reqIndex] : null;

  if (req) {
    req.status = 'APPROVED';
    req.reviewedByAdminId = adminId;
    req.reviewedAt = new Date().toISOString();
    saveStoredPaymentRequests(requests);
  }

  // Activate subscription
  const config = getAdminConfig();
  const durationMs = (config.subscriptionDurationDays || 30) * 24 * 3600 * 1000;
  const startDate = new Date().toISOString();
  const expiryDate = new Date(Date.now() + durationMs).toISOString();

  const targetUserId = req ? req.userId : requestId;
  const user = getCurrentUser(targetUserId);
  const canonicalId = user.telegramId || targetUserId;

  const subs = getStoredSubscriptions();
  const userSubKey = `${canonicalId}_${BANK_ID}`;

  const activatedSub: Subscription = {
    userId: canonicalId,
    bankId: BANK_ID,
    status: 'ACTIVE',
    plan: 'MOH Monthly Pass',
    startDate,
    expiryDate,
    activatedByAdminId: adminId,
    activatedAt: startDate
  };

  subs[userSubKey] = activatedSub;
  saveStoredSubscriptions(subs);

  // Background server notification if API endpoint is available
  if (typeof fetch !== 'undefined') {
    const baseUrl = typeof window !== 'undefined' ? '' : 'http://localhost:3000';
    fetch(`${baseUrl}/api/admin/users/${encodeURIComponent(canonicalId)}/subscription/extend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-user-id': adminId
      },
      body: JSON.stringify({ days: config.subscriptionDurationDays || 30 })
    }).catch(() => {});
  }

  return activatedSub;
};

export const rejectPaymentRequest = (requestId: string, adminId: string): void => {
  const requests = getStoredPaymentRequests();
  const req = requests.find((r) => r.id === requestId);
  if (req) {
    req.status = 'REJECTED';
    req.reviewedByAdminId = adminId;
    req.reviewedAt = new Date().toISOString();
    saveStoredPaymentRequests(requests);

    const subs = getStoredSubscriptions();
    const userSubKey = `${req.userId}_${BANK_ID}`;
    if (subs[userSubKey] && subs[userSubKey].status === 'PENDING') {
      subs[userSubKey].status = 'INACTIVE';
      saveStoredSubscriptions(subs);
    }
  }
};

export const extendSubscription = (userId: string, days: number = 30, adminId: string): Subscription => {
  const subs = getStoredSubscriptions();
  const userSubKey = `${userId}_${BANK_ID}`;
  let current = subs[userSubKey] || getSubscriptionStatus(userId, BANK_ID);

  const baseTime = (current.status === 'ACTIVE' && current.expiryDate) ? new Date(current.expiryDate).getTime() : Date.now();
  const newExpiry = new Date(baseTime + days * 24 * 3600 * 1000).toISOString();

  const updatedSub: Subscription = {
    ...current,
    userId,
    bankId: BANK_ID,
    status: 'ACTIVE',
    expiryDate: newExpiry,
    startDate: current.startDate || new Date().toISOString(),
    activatedByAdminId: adminId,
    activatedAt: current.activatedAt || new Date().toISOString()
  };

  subs[userSubKey] = updatedSub;
  saveStoredSubscriptions(subs);
  return updatedSub;
};

export const deactivateSubscription = (userId: string): Subscription => {
  const subs = getStoredSubscriptions();
  const userSubKey = `${userId}_${BANK_ID}`;
  const updatedSub: Subscription = {
    userId,
    bankId: BANK_ID,
    status: 'INACTIVE',
    plan: 'MOH Monthly Pass'
  };

  subs[userSubKey] = updatedSub;
  saveStoredSubscriptions(subs);
  return updatedSub;
};

export const getPaymentRequests = (statusFilter?: PaymentRequestStatus): PaymentRequest[] => {
  const requests = getStoredPaymentRequests();

  if (statusFilter) {
    return requests.filter((r) => r.status === statusFilter);
  }
  return requests;
};

export const syncSubscriptionFromSupabase = async (
  telegramUserId?: string,
  username?: string
): Promise<Subscription | null> => {
  try {
    const user = getCurrentUser(telegramUserId);
    const tgId = user.telegramId;
    const tgUser = username || user.username;

    // SAFEGUARD: Do not sync web_resident_01 if inside Telegram environment
    if (tgId === 'web_resident_01' && isTelegramEnvironment()) {
      console.warn('[syncSubscriptionFromSupabase] Skipped sync because web_resident_01 fallback was detected inside Telegram environment.');
      return null;
    }

    const baseUrl = typeof window !== 'undefined' ? '' : 'http://localhost:3000';
    const res = await fetch(
      `${baseUrl}/api/subscriptions/status?telegramUserId=${encodeURIComponent(tgId)}&username=${encodeURIComponent(tgUser)}`,
      {
        headers: {
          'x-telegram-user-id': tgId,
          'x-telegram-username': tgUser
        }
      }
    );

    if (!res.ok) return getSubscriptionStatus(tgId, BANK_ID);
    const data = await res.json();
    if (data.success) {
      const subs = getStoredSubscriptions();
      const userSubKey = `${tgId}_${BANK_ID}`;
      const rawStatus = String(data.status || '').toUpperCase();
      
      let isSubActive = Boolean(data.subscribed);

      // Strict expiration validation against server response
      if (data.subscription?.expires_at) {
        const expiryTime = new Date(data.subscription.expires_at).getTime();
        if (expiryTime <= Date.now()) {
          isSubActive = false;
        }
      }

      const status: SubscriptionStatus = isSubActive
        ? 'ACTIVE'
        : (rawStatus as SubscriptionStatus) || 'INACTIVE';

      const subObj: Subscription = {
        userId: tgId,
        bankId: BANK_ID,
        status,
        plan: data.subscription?.plan || subs[userSubKey]?.plan || 'MOH Pass',
        startDate: data.subscription?.created_at || subs[userSubKey]?.startDate,
        expiryDate: data.subscription?.expires_at || subs[userSubKey]?.expiryDate
      };

      // SAFEGUARD: Only update local cache for the canonical tgId, NEVER write to web_resident_01 if tgId is real
      subs[userSubKey] = subObj;
      saveStoredSubscriptions(subs);

      console.log('[Subscription Sync Diagnostic]', {
        tgId,
        tgUser,
        apiSubscribed: data.subscribed,
        normalizedStatus: status,
        isSubActive,
        expiresAt: data.subscription?.expires_at
      });

      return subObj;
    }
  } catch (err) {
    console.warn('Failed to sync subscription from Supabase, reading local status:', err);
  }

  const user = getCurrentUser(telegramUserId);
  return getSubscriptionStatus(user.telegramId, BANK_ID);
};
