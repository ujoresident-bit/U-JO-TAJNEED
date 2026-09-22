import { UserStudyStats, Block, OptionKey, Question } from '../types';
import { getCompletedBlocksForUser, getActiveBlockForUser, getAllStoredBlocks, getUserQuestionStatusSets } from './questionBankService';
import { getCurrentUser } from './authService';

export interface QuestionStatusCounts {
  allCount: number;
  completeCount: number;
  uncompletedCount: number;
  unusedCount: number;
}

export const syncQuestionProgressToSupabase = async (
  questionId: string,
  selectedAnswer: OptionKey,
  isCorrect: boolean
): Promise<void> => {
  try {
    if (typeof window === 'undefined') return;
    const user = getCurrentUser();
    await fetch('/api/question-progress', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-user-id': user.telegramId || '',
        'x-telegram-username': user.username || ''
      },
      body: JSON.stringify({
        questionId,
        selectedAnswer,
        isCorrect
      })
    });
  } catch (err) {
    console.warn("Background sync of question progress to Supabase failed, falling back to local storage:", err);
  }
};

export const fetchQuestionProgressFromSupabase = async (): Promise<Array<{
  id: string;
  questionId: string;
  selectedAnswer: OptionKey;
  isCorrect: boolean;
  updatedAt: string;
}>> => {
  try {
    if (typeof window === 'undefined') return [];
    const user = getCurrentUser();
    const headers: Record<string, string> = {
      'x-telegram-user-id': user.telegramId || '',
      'x-telegram-username': user.username || ''
    };

    const res = await fetch('/api/question-progress', { headers });
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);

    const data = await res.json();
    if (data && Array.isArray(data.progress)) {
      return data.progress;
    }
  } catch (err) {
    console.warn("Background fetch of question progress from Supabase failed, falling back to local storage:", err);
  }
  return [];
};

export const mergeSupabaseProgressWithLocal = async (userId: string): Promise<void> => {
  try {
    const remoteProgress = await fetchQuestionProgressFromSupabase();
    if (!remoteProgress || remoteProgress.length === 0) return;

    // Optional: remote progress retrieved, local state remains authority for active blocks
  } catch (err) {
    console.warn("Failed to merge Supabase progress with local storage:", err);
  }
};

export const getUserStudyStats = (userId: string): UserStudyStats => {
  const completedBlocks = getCompletedBlocksForUser(userId);
  const activeBlock = getActiveBlockForUser(userId);

  let totalQuestionsSolved = 0;
  let totalCorrect = 0;

  // Aggregate answers from all completed blocks
  completedBlocks.forEach((block) => {
    Object.values(block.answers).forEach((ans) => {
      totalQuestionsSolved += 1;
      if (ans.isCorrect) totalCorrect += 1;
    });
  });

  // Aggregate answers from current active block
  if (activeBlock) {
    Object.values(activeBlock.answers).forEach((ans) => {
      totalQuestionsSolved += 1;
      if (ans.isCorrect) totalCorrect += 1;
    });
  }

  const accuracyPercentage =
    totalQuestionsSolved > 0 ? Math.round((totalCorrect / totalQuestionsSolved) * 100) : 0;

  return {
    totalQuestionsSolved,
    totalCorrect,
    totalIncorrect: totalQuestionsSolved - totalCorrect,
    accuracyPercentage,
    blocksCompleted: completedBlocks.length,
    activeBlocksCount: activeBlock ? 1 : 0,
    lastQuestionDate: activeBlock?.updatedAt || completedBlocks[0]?.updatedAt || new Date().toISOString(),
    lastActivityDate: new Date().toISOString()
  };
};

export const getUserBlockHistory = (userId: string): Block[] => {
  return getCompletedBlocksForUser(userId);
};

export const getQuestionStatusCounts = (
  userId: string,
  matchingQuestions: Question[]
): QuestionStatusCounts => {
  const { answeredQuestionIds, encounteredQuestionIds } = getUserQuestionStatusSets(userId);

  let completeCount = 0;
  let uncompletedCount = 0;
  let unusedCount = 0;

  matchingQuestions.forEach((q) => {
    if (answeredQuestionIds.has(q.id)) {
      completeCount += 1;
    } else if (encounteredQuestionIds.has(q.id)) {
      uncompletedCount += 1;
    } else {
      unusedCount += 1;
    }
  });

  return {
    allCount: matchingQuestions.length,
    completeCount,
    uncompletedCount,
    unusedCount
  };
};

export const fetchResetCountFromSupabase = async (userId: string): Promise<number> => {
  try {
    if (typeof window === 'undefined') return 0;
    const user = getCurrentUser();
    const res = await fetch('/api/user/reset-count', {
      headers: {
        'x-telegram-user-id': user.telegramId || '',
        'x-telegram-username': user.username || ''
      }
    });
    if (res.ok) {
      const data = await res.json();
      if (typeof data.resetCount === 'number') {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(`ujo_reset_count_${userId}`, String(data.resetCount));
        }
        return data.resetCount;
      }
    }
  } catch (err) {
    console.warn("Failed to fetch reset count from Supabase:", err);
  }

  // Fallback to localStorage
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(`ujo_reset_count_${userId}`);
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed)) return parsed;
    }
  }
  return 0;
};

export const resetUserQuestionBankProgress = async (
  userId: string
): Promise<{ success: boolean; resetCount: number; error?: string }> => {
  const currentResetCount = await fetchResetCountFromSupabase(userId);
  if (currentResetCount >= 3) {
    return {
      success: false,
      resetCount: currentResetCount,
      error: "Reset limit reached. You have used all 3 available resets."
    };
  }

  // Delete local blocks belonging to user
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem('ujo_blocks_v1');
      if (raw) {
        const blocksMap: Record<string, Block> = JSON.parse(raw);
        const updatedBlocksMap: Record<string, Block> = {};
        Object.entries(blocksMap).forEach(([id, b]) => {
          if (b.userId !== userId && b.userId !== 'web_resident_01') {
            updatedBlocksMap[id] = b;
          }
        });
        localStorage.setItem('ujo_blocks_v1', JSON.stringify(updatedBlocksMap));
      }
    } catch (e) {
      console.error("Error clearing local blocks on reset:", e);
    }
  }

  let newResetCount = currentResetCount + 1;
  try {
    if (typeof window !== 'undefined') {
      const user = getCurrentUser();
      const res = await fetch('/api/user/reset-progress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-user-id': user.telegramId || '',
          'x-telegram-username': user.username || ''
        }
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          success: false,
          resetCount: typeof data.resetCount === 'number' ? data.resetCount : currentResetCount,
          error: data.error || "Failed to reset progress on server."
        };
      }

      if (typeof data.resetCount === 'number') {
        newResetCount = data.resetCount;
      }
    }
  } catch (err) {
    console.warn("Server reset-progress call failed, applying local reset:", err);
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(`ujo_reset_count_${userId}`, String(newResetCount));
  }

  return {
    success: true,
    resetCount: newResetCount
  };
};
