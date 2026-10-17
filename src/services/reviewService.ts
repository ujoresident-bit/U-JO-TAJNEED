import { resolveSession } from './authService';

export interface DueReviewItem {
  itemType: 'question' | 'flashcard';
  itemId: string;
  stage: number;
}

const authHeaders = (): Record<string, string> => {
  const user = resolveSession().user;
  return { 'x-telegram-user-id': user.telegramId || '', 'x-telegram-username': user.username || '' };
};

// Fire-and-forget: a failed network call must never interrupt studying.
// A wrong answer schedules the item (1 day → 3 days → 7 days); a correct
// answer on an already-queued item advances it.
export const recordReview = (
  itemType: 'question' | 'flashcard',
  itemId: string,
  correct: boolean,
  bankId: string = 'human_medicine'
): void => {
  try {
    fetch('/api/review/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ itemType, itemId, correct, bankId })
    }).catch(() => {});
  } catch {}
};

export const fetchDueReviews = async (
  bankId: string = 'human_medicine'
): Promise<{ due: DueReviewItem[]; totalQueued: number }> => {
  try {
    const res = await fetch(`/api/review/due?bankId=${encodeURIComponent(bankId)}`, { headers: authHeaders() });
    const data = await res.json();
    if (data?.success) return { due: data.due || [], totalQueued: data.totalQueued || 0 };
  } catch {}
  return { due: [], totalQueued: 0 };
};
