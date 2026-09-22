import { Flashcard } from '../types';
import { getCurrentUser } from './authService';

const FLASHCARDS_STORAGE_KEY = 'ujo_flashcards_v1';

export const getFlashcards = (): Flashcard[] => {
  try {
    const raw = localStorage.getItem(FLASHCARDS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error('Error loading flashcards from storage:', e);
  }
  return [];
};

export const syncFlashcardsFromSupabase = async (): Promise<Flashcard[]> => {
  try {
    if (typeof window === 'undefined') return getFlashcards();
    const user = getCurrentUser();
    const headers: Record<string, string> = {
      'x-telegram-user-id': user.telegramId || '',
      'x-telegram-username': user.username || ''
    };

    const res = await fetch('/api/flashcards', { headers });
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);

    const data = await res.json();
    if (data && Array.isArray(data.flashcards)) {
      const remoteCards: Flashcard[] = data.flashcards;
      const localCards = getFlashcards();
      const cardMap = new Map<string, Flashcard>();

      localCards.forEach((c) => cardMap.set(c.id, c));
      remoteCards.forEach((c) => cardMap.set(c.id, c));

      const merged = Array.from(cardMap.values());
      localStorage.setItem(FLASHCARDS_STORAGE_KEY, JSON.stringify(merged));
      return merged;
    }
  } catch (err) {
    console.warn("Background fetch of flashcards from Supabase failed, falling back to local storage:", err);
  }
  return getFlashcards();
};

export const syncFlashcardToSupabase = async (card: Flashcard): Promise<void> => {
  try {
    if (typeof window === 'undefined') return;
    const user = getCurrentUser();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-telegram-user-id': user.telegramId || '',
      'x-telegram-username': user.username || ''
    };

    await fetch('/api/flashcards', {
      method: 'POST',
      headers,
      body: JSON.stringify({ flashcard: card })
    });
  } catch (err) {
    console.warn("Background sync of flashcard to Supabase failed:", err);
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

export const saveFlashcard = (cardData: {
  question: string;
  answer: string;
  id?: string;
  questionId?: string;
  major?: string;
  topic?: string;
  isCustom?: boolean;
}): Flashcard => {
  const cards = getFlashcards();
  const now = new Date().toISOString();

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
        isCustom: cardData.isCustom ?? true,
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
      isCustom: cardData.isCustom ?? true,
      createdAt: now,
      updatedAt: now
    };
    cards.push(resultCard);
  }

  // 1. Update localStorage immediately
  localStorage.setItem(FLASHCARDS_STORAGE_KEY, JSON.stringify(cards));

  // 2. Synchronize with Supabase asynchronously in background (non-blocking)
  syncFlashcardToSupabase(resultCard).catch(() => {});

  // 3. Return updated card immediately
  return resultCard;
};

export const deleteFlashcard = (id: string): boolean => {
  const cards = getFlashcards();
  const filtered = cards.filter((c) => c.id !== id);
  if (filtered.length !== cards.length) {
    // 1. Update localStorage immediately
    localStorage.setItem(FLASHCARDS_STORAGE_KEY, JSON.stringify(filtered));

    // 2. Synchronize deletion with Supabase asynchronously in background (non-blocking)
    deleteFlashcardFromSupabase(id).catch(() => {});

    return true;
  }
  return false;
};
