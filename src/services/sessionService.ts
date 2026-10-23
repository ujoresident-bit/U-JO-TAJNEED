import { getCurrentUser } from './authService';

// One random id per page load (a fresh app open is a new session). Students can
// use one device at a time: the newest device wins and the older one is told to
// stop. The admin is never limited (the server decides).
export const CLIENT_SESSION_ID: string =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export const SESSION_REPLACED_EVENT = 'ujo:session-replaced';

const headers = (): Record<string, string> => {
  const u = getCurrentUser();
  return {
    'x-telegram-user-id': u.telegramId || '',
    'x-telegram-username': u.username || '',
    'x-session-id': CLIENT_SESSION_ID
  };
};

// Makes this device the active one. Never throws; on any error we stay usable.
export const claimSession = async (): Promise<boolean> => {
  try {
    const res = await fetch('/api/session/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers() }, body: '{}' });
    const data = await res.json().catch(() => null);
    return data?.active !== false;
  } catch { return true; }
};

// true = still the active device (or unknown), false = another device took over.
export const checkSession = async (): Promise<boolean> => {
  try {
    const res = await fetch('/api/session/check', { headers: headers() });
    const data = await res.json().catch(() => null);
    return data?.active !== false;
  } catch { return true; }
};
