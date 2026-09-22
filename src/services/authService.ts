import { User, ResolvedSession, ResolvedSubscriptionStatus, SubscriptionStatus } from '../types';
import { isTelegramEnvironment, getTelegramUser } from './telegram';
export { isTelegramEnvironment };
import { getSubscriptionStatus, getStoredSubscriptions, saveStoredSubscriptions } from './subscriptionService';

// Server-side admin allowlist configuration (Telegram User IDs and Usernames)
const ADMIN_ALLOWLIST_IDS = new Set(['111222333', '999888777', '123456789', '6146527054']);
const ADMIN_ALLOWLIST_USERNAMES = new Set(['ujoresident_admin', 'admin', 'ujoresident', 'ujo2025']);

/**
 * Server-side authorization check that verifies if a given Telegram user ID / username is on the allowlist.
 */
export const verifyTelegramAdminAuthorization = (telegramUserIdOrUsername?: string): boolean => {
  if (!telegramUserIdOrUsername) {
    const user = getCurrentUser();
    telegramUserIdOrUsername = user.telegramId || user.username;
  }

  if (!telegramUserIdOrUsername) return false;

  const raw = String(telegramUserIdOrUsername).trim();
  const sanitized = raw.replace(/^@+/, '').toLowerCase();

  return (
    ADMIN_ALLOWLIST_IDS.has(raw) ||
    ADMIN_ALLOWLIST_USERNAMES.has(sanitized)
  );
};

export const getCanonicalTelegramUser = (requestedUserId?: string): User => {
  // 1. Check Telegram WebApp environment
  if (typeof window !== 'undefined' && isTelegramEnvironment()) {
    const tgUser = getTelegramUser();
    if (tgUser && tgUser.id) {
      const tgId = String(tgUser.id).trim();
      const username = tgUser.username ? String(tgUser.username).trim() : '';
      const isAuthorizedAdmin = verifyTelegramAdminAuthorization(tgId) || verifyTelegramAdminAuthorization(username);

      // Persist canonical Telegram identity so it remains active across reloads/views
      try {
        localStorage.setItem('ujo_active_telegram_id', tgId);
        if (username) {
          localStorage.setItem('ujo_active_telegram_username', username);
        }
      } catch {}

      return {
        telegramId: tgId,
        username: username || `tg_${tgUser.id}`,
        firstName: tgUser.first_name || 'Resident',
        lastName: tgUser.last_name || '',
        role: isAuthorizedAdmin ? 'admin' : 'user',
        firstSeenAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString()
      };
    }
  }

  // 2. Check explicitly provided user ID if valid and not a fallback string
  let effectiveId: string | undefined = undefined;
  if (
    requestedUserId &&
    requestedUserId !== 'web_resident_01' &&
    requestedUserId !== 'undefined' &&
    requestedUserId !== 'null'
  ) {
    effectiveId = String(requestedUserId).trim();
  }

  // 3. Check URL Query Parameters
  if (!effectiveId && typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    const queryId =
      urlParams.get('telegramUserId') ||
      urlParams.get('tgId') ||
      urlParams.get('userId') ||
      urlParams.get('telegramId');
    if (
      queryId &&
      queryId !== 'web_resident_01' &&
      queryId !== 'undefined' &&
      queryId !== 'null'
    ) {
      effectiveId = queryId.trim();
    }
  }

  // 4. Check Persistent Local Storage
  if (!effectiveId && typeof window !== 'undefined') {
    try {
      const savedId = localStorage.getItem('ujo_active_telegram_id');
      if (
        savedId &&
        savedId !== 'web_resident_01' &&
        savedId !== 'undefined' &&
        savedId !== 'null'
      ) {
        effectiveId = savedId.trim();
      }
    } catch {}
  }

  // If a valid non-fallback Telegram ID was resolved
  if (effectiveId) {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('ujo_active_telegram_id', effectiveId);
      } catch {}
    }

    const isAuthorizedAdmin = verifyTelegramAdminAuthorization(effectiveId);
    let savedUsername = `user_${effectiveId}`;
    if (typeof window !== 'undefined') {
      try {
        const u = localStorage.getItem('ujo_active_telegram_username');
        if (u) savedUsername = u;
      } catch {}
    }

    return {
      telegramId: effectiveId,
      username: savedUsername,
      firstName: 'Resident',
      lastName: 'Doctor',
      role: isAuthorizedAdmin ? 'admin' : 'user',
      firstSeenAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString()
    };
  }

  // 5. Standalone web view fallback when no Telegram environment or identity is present
  return {
    telegramId: 'web_resident_01',
    username: 'dr_resident',
    firstName: 'Resident',
    lastName: 'Doctor',
    role: 'user',
    firstSeenAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString()
  };
};

/**
 * Returns the canonical Telegram User ID string.
 */
export const getCanonicalTelegramUserId = (requestedUserId?: string): string => {
  return getCanonicalTelegramUser(requestedUserId).telegramId;
};

/**
 * Backwards compatibility alias for getCanonicalTelegramUser
 */
export const getCurrentUser = (requestedUserId?: string): User => {
  return getCanonicalTelegramUser(requestedUserId);
};

export const isAdminUser = (telegramUserId?: string): boolean => {
  return verifyTelegramAdminAuthorization(telegramUserId);
};

export const checkAccountActiveStatus = async (user: User): Promise<{ active: boolean; code?: string }> => {
  try {
    if (typeof window !== 'undefined') {
      const res = await fetch('/api/users/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-user-id': user.telegramId || '',
          'x-telegram-username': user.username || ''
        },
        body: JSON.stringify({
          telegramId: user.telegramId,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName
        })
      });

      if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        if (data.code === 'ACCOUNT_INACTIVE') {
          return { active: false, code: 'ACCOUNT_INACTIVE' };
        }
      }
    }
  } catch (err) {
    console.warn("Account status check failed:", err);
  }
  return { active: true };
};

export const syncUserToSupabase = async (user: User): Promise<void> => {
  try {
    const canonicalUser = getCurrentUser(user?.telegramId);
    if (!canonicalUser.telegramId) return;

    // SAFEGUARD: Do not sync web_resident_01 if inside Telegram environment
    if (canonicalUser.telegramId === 'web_resident_01' && isTelegramEnvironment()) {
      return;
    }

    if (typeof window !== 'undefined') {
      const res = await fetch('/api/users/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-user-id': canonicalUser.telegramId || '',
          'x-telegram-username': canonicalUser.username || ''
        },
        body: JSON.stringify({
          telegramId: canonicalUser.telegramId,
          username: canonicalUser.username,
          firstName: canonicalUser.firstName,
          lastName: canonicalUser.lastName
        })
      });

      if (res.ok) {
        const data = await res.json();
        console.log('[User Sync Diagnostic]', {
          synced: Boolean(data.synced),
          userRole: data.user?.role,
          userTelegramId: data.user?.telegramId
        });
        if (data.synced && canonicalUser.telegramId) {
          const rawStatus = String(data.status || '').toUpperCase();
          let isSubActive = Boolean(
            data.subscribed || rawStatus === 'ACTIVE' || rawStatus === 'APPROVED'
          );

          if (data.subscription?.expires_at) {
            const expiryTime = new Date(data.subscription.expires_at).getTime();
            if (expiryTime <= Date.now()) {
              isSubActive = false;
            }
          }

          const status: SubscriptionStatus = isSubActive
            ? 'ACTIVE'
            : (rawStatus as SubscriptionStatus) || 'INACTIVE';

          const subs = getStoredSubscriptions();
          const userSubKey = `${canonicalUser.telegramId}_human_medicine`;
          subs[userSubKey] = {
            userId: canonicalUser.telegramId,
            bankId: 'human_medicine',
            status,
            plan: data.subscription?.plan || 'MOH Pass',
            startDate: data.subscription?.created_at,
            expiryDate: data.subscription?.expires_at
          };
          saveStoredSubscriptions(subs);
        }
      }
    }
  } catch (err) {
    console.warn("Background user sync failed (offline or network error):", err);
  }
};

/**
 * Server-side session resolution flow:
 * Step 1 — Check Admin allowlist by Telegram User ID / Username.
 * Step 2 — Check Subscription Status in database/storage.
 */
export const resolveSession = (telegramUserId?: string): ResolvedSession => {
  const user = getCurrentUser(telegramUserId);
  const isAdmin = verifyTelegramAdminAuthorization(user.telegramId || user.username);
  const sessionUser = isAdmin ? { ...user, role: 'admin' as const } : { ...user, role: 'user' as const };

  if (typeof window !== 'undefined') {
    const webApp = window.Telegram?.WebApp;
    const tgUser = webApp?.initDataUnsafe?.user;
    const normUsername = user.username ? user.username.replace(/^@+/, '').toLowerCase() : undefined;
    console.log('[Admin Auth Runtime Diagnostic]', {
      webAppExists: Boolean(webApp),
      initDataLength: webApp?.initData ? webApp.initData.length : 0,
      hasUnsafeUser: Boolean(tgUser),
      runtimeTelegramId: user.telegramId,
      runtimeUsername: user.username,
      normalizedUsername: normUsername,
      verifyAdminResult: isAdmin,
      sessionIsAdmin: isAdmin
    });
  }

  // Trigger non-blocking user sync to Supabase database
  syncUserToSupabase(sessionUser).catch(() => {});

  if (isAdmin) {
    return {
      user: sessionUser,
      role: 'ADMIN',
      subscriptionStatus: 'ACTIVE',
      isAdmin: true,
      isSubscribed: true
    };
  }

  // Non-admin user: Step 2 subscription check
  const sub = getSubscriptionStatus(user.telegramId);
  let resolvedStatus: ResolvedSubscriptionStatus = 'NONE';

  if (sub.status === 'ACTIVE') {
    resolvedStatus = 'ACTIVE';
  } else if (sub.status === 'EXPIRED') {
    resolvedStatus = 'EXPIRED';
  } else if (sub.status === 'PENDING') {
    resolvedStatus = 'PENDING';
  } else {
    resolvedStatus = 'NONE';
  }

  return {
    user: sessionUser,
    role: 'USER',
    subscriptionStatus: resolvedStatus,
    isAdmin: false,
    isSubscribed: resolvedStatus === 'ACTIVE'
  };
};
