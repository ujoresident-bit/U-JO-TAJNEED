import { Flashcard } from '../types';
import { getCurrentUser } from './authService';

const FLASHCARDS_STORAGE_KEY = 'ujo_flashcards_v1';
const MOST_COMMON_STORAGE_KEY = 'ujo_most_common_cards_v1';

const storageKeyFor = (cardType: 'flashcard' | 'most_common') =>
  cardType === 'most_common' ? MOST_COMMON_STORAGE_KEY : FLASHCARDS_STORAGE_KEY;

export const getFlashcards = (cardType: 'flashcard' | 'most_common' = 'flashcard'): Flashcard[] => {
  try {
    const raw = localStorage.getItem(storageKeyFor(cardType));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error('Error loading flashcards from storage:', e);
  }
  return [];
};

export const syncFlashcardsFromSupabase = async (cardType: 'flashcard' | 'most_common' = 'flashcard'): Promise<Flashcard[]> => {
  try {
    if (typeof window === 'undefined') return getFlashcards();
    const user = getCurrentUser();
    const headers: Record<string, string> = {
      'x-telegram-user-id': user.telegramId || '',
      'x-telegram-username': user.username || ''
    };

    const res = await fetch(`/api/flashcards?cardType=${encodeURIComponent(cardType)}`, { headers });
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);

    const data = await res.json();
    if (data && Array.isArray(data.flashcards)) {
      // ROOT CAUSE FIX: this previously UNION-merged local + remote cards,
      // so any stale/leftover local entry (from a failed past save, an old
      // test batch, etc.) accumulated in localStorage FOREVER and never got
      // removed even after Supabase no longer had it — causing the site to
      // show far more flashcards than actually exist in the database (e.g.
      // 589 locally vs 100 real rows in Supabase). Supabase is now treated
      // as fully authoritative: the local cache is REPLACED with exactly
      // what the server returns, never merged with old local leftovers.
      // Each cardType gets its own storage key so Flashcards and Most
      // Common never overwrite each other's local cache.
      const remoteCards: Flashcard[] = data.flashcards;
      localStorage.setItem(storageKeyFor(cardType), JSON.stringify(remoteCards));
      return remoteCards;
    }
  } catch (err) {
    console.warn("Background fetch of flashcards from Supabase failed, falling back to local storage:", err);
  }
  return getFlashcards(cardType);
};

export const syncFlashcardToSupabase = async (card: Flashcard): Promise<{ success: boolean; error?: string }> => {
  try {
    if (typeof window === 'undefined') return { success: false, error: 'No window context.' };
    const user = getCurrentUser();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-telegram-user-id': user.telegramId || '',
      'x-telegram-username': user.username || ''
    };

    const response = await fetch('/api/flashcards', {
      method: 'POST',
      headers,
      body: JSON.stringify({ flashcard: card })
    });

    if (response.ok) return { success: true };

    const data = await response.json().catch(() => ({}));
    return { success: false, error: data.error || `HTTP error ${response.status}` };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error while saving to Supabase.' };
  }
};

export const deleteFlashcardFromSupabase = async (customId: string): Promise<void> => {
  try {
    if (typeof window === 'undefined') return;
    const user = getCurrentUser();
    const headers: Record<string, string> = {
      'x-telegram-user-id': user.telegramId || '',
      'x-telegram-username': user.username || ''
    };

    await fetch(`/api/flashcards/${encodeURIComponent(customId)}`, {
      method: 'DELETE',
      headers
    });
  } catch (err) {
    console.warn("Background deletion of flashcard from Supabase failed:", err);
  }
};

export const reportFlashcardIssue = async (flashcardId: string, message?: string): Promise<boolean> => {
  const user = getCurrentUser();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-telegram-user-id': user.telegramId || '',
    'x-telegram-username': user.username || ''
  };

  const response = await fetch(`/api/flashcards/${encodeURIComponent(flashcardId)}/feedback`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: message || '' })
  });

  if (response.ok) return true;

  const data = await response.json().catch(() => ({}));
  throw new Error(data.error || 'Failed to submit flashcard feedback.');
};

export const migrateLocalFlashcardsToSupabase = async (): Promise<{ success: boolean; migrated: number; failed: number; message: string }> => {
  const cards = getFlashcards();
  let migrated = 0;
  let failed = 0;
  const failureMessages: string[] = [];

  // Idempotent by design: each local flashcard already has a stable,
  // permanent `id` (generated once at creation), and the server upserts on
  // that same id (custom_id) — so re-running this any number of times with
  // an unchanged local set updates the same rows in place instead of
  // creating duplicates, exactly like the Question Bank's "Sync Local to
  // Supabase" button.
  for (const card of cards) {
    const result = await syncFlashcardToSupabase(card);
    if (result.success) {
      migrated++;
    } else {
      failed++;
      failureMessages.push(result.error || 'Unknown error');
    }
  }

  return {
    success: failed === 0,
    migrated,
    failed,
    message:
      failed === 0
        ? `SYNC COMPLETE — ${migrated} flashcard(s) synced to Supabase (no duplicates created).`
        : `Synced ${migrated} of ${cards.length}. ${failed} failed: ${failureMessages.slice(0, 3).join('; ')}`
  };
};

export const saveFlashcard = async (cardData: {
  question: string;
  answer: string;
  id?: string;
  questionId?: string;
  major?: string;
  topic?: string;
  isCustom?: boolean;
  cardType?: 'flashcard' | 'most_common';
}): Promise<Flashcard> => {
  const cardType = cardData.cardType || 'flashcard';
  const cards = getFlashcards(cardType);
  const now = new Date().toISOString();

  // Admin-created cards (this function's only caller is the Admin
  // Dashboard) must default to GLOBAL (isCustom: false), so every user
  // actually sees them — not tied to the admin's own personal account. The
  // caller can still explicitly override this if a personal card is ever
  // genuinely intended.
  const resolvedIsCustom = cardData.isCustom ?? false;

  let resultCard: Flashcard;

  if (cardData.id) {
    // Edit existing card
    const index = cards.findIndex((c) => c.id === cardData.id);
    if (index !== -1) {
      resultCard = {
        ...cards[index],
        question: cardData.question.trim(),
        answer: cardData.answer.trim(),
        front: cardData.question.trim(),
        back: cardData.answer.trim(),
        cardType,
        updatedAt: now
      };
      if (cardData.questionId !== undefined) resultCard.questionId = cardData.questionId;
      if (cardData.major !== undefined) resultCard.major = cardData.major;
      if (cardData.topic !== undefined) resultCard.topic = cardData.topic;
      if (cardData.isCustom !== undefined) resultCard.isCustom = cardData.isCustom;

      cards[index] = resultCard;
    } else {
      resultCard = {
        id: cardData.id,
        question: cardData.question.trim(),
        answer: cardData.answer.trim(),
        front: cardData.question.trim(),
        back: cardData.answer.trim(),
        questionId: cardData.questionId || null,
        major: cardData.major || null,
        topic: cardData.topic || null,
        isCustom: resolvedIsCustom,
        cardType,
        createdAt: now,
        updatedAt: now
      };
      cards.push(resultCard);
    }
  } else {
    // Create new card
    resultCard = {
      id: `fc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      question: cardData.question.trim(),
      answer: cardData.answer.trim(),
      front: cardData.question.trim(),
      back: cardData.answer.trim(),
      questionId: cardData.questionId || null,
      major: cardData.major || null,
      topic: cardData.topic || null,
      isCustom: resolvedIsCustom,
      cardType,
      createdAt: now,
      updatedAt: now
    };
    cards.push(resultCard);
  }

  // 1. Update localStorage immediately (fast local cache)
  localStorage.setItem(storageKeyFor(cardType), JSON.stringify(cards));

  // 2. Persist to Supabase and WAIT for the real result — no more silent
  // fire-and-forget. A failure here is thrown so the admin UI can show it
  // instead of a false "success" message.
  const syncResult = await syncFlashcardToSupabase(resultCard);
  if (!syncResult.success) {
    throw new Error(syncResult.error || 'Failed to save flashcard to Supabase.');
  }

  // 3. Return the confirmed-saved card
  return resultCard;
};

export const deleteFlashcard = (id: string, cardType: 'flashcard' | 'most_common' = 'flashcard'): boolean => {
  const cards = getFlashcards(cardType);
  const filtered = cards.filter((c) => c.id !== id);
  if (filtered.length !== cards.length) {
    // 1. Update localStorage immediately
    localStorage.setItem(storageKeyFor(cardType), JSON.stringify(filtered));

    // 2. Synchronize deletion with Supabase asynchronously in background (non-blocking)
    deleteFlashcardFromSupabase(id).catch(() => {});

    return true;
  }
  return false;
};
