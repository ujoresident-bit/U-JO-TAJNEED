import { Block, Question } from '../types';
import { getStoredBlocks, getStoredQuestions } from './questionBankService';

export interface SubjectStat {
  major: string;
  total: number;
  correct: number;
  pct: number;
}

export interface DayStat {
  key: string; // YYYY-MM-DD (local)
  label: string; // e.g. "Oct 16"
  total: number;
  correct: number;
}

export interface BankPerformance {
  total: number;
  correct: number;
  accuracy: number;
  blocksCompleted: number;
  bySubject: SubjectStat[]; // weakest first
  weakest: SubjectStat | null; // lowest accuracy with enough answers to be meaningful
  days: DayStat[]; // last 30 days, oldest first
  streak: number; // consecutive days with activity, ending today or yesterday
  activeDays: number; // active days in the last 30
  sessions: Block[]; // completed blocks, newest first
}

const MIN_ANSWERS_FOR_WEAKEST = 5;

const dayKey = (d: Date): string => d.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

// Everything here is computed locally from the student's own blocks, so it
// works instantly and never mixes banks.
export const getBankPerformance = (userId: string, bankId: string): BankPerformance => {
  const blocks = Object.values(getStoredBlocks()).filter((b) => b.userId === userId && b.bankId === bankId);
  const questionsById = new Map<string, Question>(getStoredQuestions().map((q) => [q.id, q]));

  let total = 0;
  let correct = 0;
  const subjectMap = new Map<string, { total: number; correct: number }>();
  const dayMap = new Map<string, { total: number; correct: number }>();

  blocks.forEach((block) => {
    Object.values(block.answers || {}).forEach((ans) => {
      total += 1;
      if (ans.isCorrect) correct += 1;

      const major = questionsById.get(ans.questionId)?.major || 'Other';
      const s = subjectMap.get(major) || { total: 0, correct: 0 };
      s.total += 1;
      if (ans.isCorrect) s.correct += 1;
      subjectMap.set(major, s);

      const when = new Date(ans.answeredAt || block.updatedAt);
      if (!isNaN(when.getTime())) {
        const k = dayKey(when);
        const d = dayMap.get(k) || { total: 0, correct: 0 };
        d.total += 1;
        if (ans.isCorrect) d.correct += 1;
        dayMap.set(k, d);
      }
    });
  });

  const bySubject: SubjectStat[] = Array.from(subjectMap.entries())
    .map(([major, v]) => ({ major, total: v.total, correct: v.correct, pct: Math.round((v.correct / v.total) * 100) }))
    .sort((a, b) => a.pct - b.pct || b.total - a.total);

  const weakest = bySubject.find((s) => s.total >= MIN_ANSWERS_FOR_WEAKEST) || null;

  const days: DayStat[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const k = dayKey(d);
    const v = dayMap.get(k);
    days.push({
      key: k,
      label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      total: v?.total || 0,
      correct: v?.correct || 0
    });
  }

  // Streak: count back from today; if today has no activity yet, start from
  // yesterday so a student does not lose the streak before they study.
  let streak = 0;
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!dayMap.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (dayMap.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const sessions = blocks
    .filter((b) => b.status === 'COMPLETED')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return {
    total,
    correct,
    accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
    blocksCompleted: sessions.length,
    bySubject,
    weakest,
    days,
    streak,
    activeDays: days.filter((d) => d.total > 0).length,
    sessions
  };
};
