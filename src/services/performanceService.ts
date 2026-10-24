import { Block, Question } from '../types';
import { getStoredBlocks, getStoredQuestions, parseExamYear } from './questionBankService';

export interface TopicStat {
  major: string;
  topic: string;
  total: number;
  correct: number;
  pct: number;
}

export interface SubjectStat {
  major: string;
  total: number; // answers (repeats included)
  correct: number;
  pct: number;
  seen?: number; // distinct questions answered
  bankTotal?: number; // questions in the bank for this subject
  firstTryPct?: number | null; // accuracy of the first attempt on each distinct question
  topics?: TopicStat[];
}

export interface SplitStat { label: string; total: number; correct: number; pct: number }
export interface WeekStat { label: string; total: number; correct: number; pct: number | null }
export interface HeatDay { key: string; total: number; correct: number; future: boolean }

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

  // ---- deeper readings, all computed from the same synced blocks ----
  subjects: SubjectStat[]; // every subject in the bank (answered or not), A to Z
  coverage: { seen: number; total: number; pct: number };
  firstAttempt: { total: number; correct: number; pct: number } | null;
  byDifficulty: SplitStat[]; // Easy, Medium, Hard
  byExam: SplitStat[]; // TAJNEED, MADANI (only types that have answers)
  recovered: { recovered: number; missed: number };
  hours: number[]; // answers per local hour (24)
  hoursCorrect: number[];
  peak: { hour: number; pct: number; total: number } | null; // busiest hour, accuracy within hour-1..hour+1
  longestStreak: number;
  weeks: WeekStat[]; // last 8 weeks, oldest first
  weekGain: number; // best week-over-week gain in points (0 if none)
  heat: HeatDay[][]; // 12 weeks x 7 days (Mon first), oldest week first
  weakTopics: TopicStat[]; // lowest accuracy, at least 3 answers
  perfectBlocks: number; // completed blocks of 10+ questions scored 100
  masteredSubjects: number; // 80%+ over at least 30 answers
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


  // ---------- deeper readings ----------
  const bankQuestions = getStoredQuestions().filter((q) => q.bankId === bankId);
  const bankTotals = new Map<string, number>();
  bankQuestions.forEach((q) => { const m = q.major || 'Other'; bankTotals.set(m, (bankTotals.get(m) || 0) + 1); });

  type Ev = { qid: string; t: number; ok: boolean };
  const events: Ev[] = [];
  blocks.forEach((block) => {
    Object.values(block.answers || {}).forEach((ans) => {
      const t = new Date(ans.answeredAt || block.updatedAt).getTime();
      events.push({ qid: ans.questionId, t: isNaN(t) ? 0 : t, ok: Boolean(ans.isCorrect) });
    });
  });
  events.sort((a, b) => a.t - b.t);

  const byQ = new Map<string, Ev[]>();
  events.forEach((e) => { const l = byQ.get(e.qid); if (l) l.push(e); else byQ.set(e.qid, [e]); });

  let seen = 0, firstTotal = 0, firstCorrect = 0, missed = 0, recoveredN = 0;
  const seenBySubject = new Map<string, number>();
  const firstBySubject = new Map<string, { t: number; c: number }>();
  byQ.forEach((list, qid) => {
    seen += 1;
    const q = questionsById.get(qid);
    const major = q?.major || 'Other';
    seenBySubject.set(major, (seenBySubject.get(major) || 0) + 1);
    firstTotal += 1;
    if (list[0].ok) firstCorrect += 1;
    const fb = firstBySubject.get(major) || { t: 0, c: 0 };
    fb.t += 1; if (list[0].ok) fb.c += 1;
    firstBySubject.set(major, fb);
    const lastWrong = (() => { for (let i = list.length - 1; i >= 0; i--) if (!list[i].ok) return i; return -1; })();
    if (lastWrong >= 0) {
      missed += 1;
      if (list.slice(lastWrong + 1).some((e) => e.ok)) recoveredN += 1;
    }
  });

  // difficulty / exam type / topic splits
  const diffMap = new Map<string, { total: number; correct: number }>();
  const examMap = new Map<string, { total: number; correct: number }>();
  const topicMap = new Map<string, TopicStat>();
  const hours = new Array(24).fill(0) as number[];
  const hoursCorrect = new Array(24).fill(0) as number[];
  events.forEach((e) => {
    const q = questionsById.get(e.qid);
    if (q) {
      const dm = diffMap.get(q.difficulty) || { total: 0, correct: 0 };
      dm.total += 1; if (e.ok) dm.correct += 1; diffMap.set(q.difficulty, dm);
      const ty = parseExamYear(q.year).type;
      if (ty) { const em = examMap.get(ty) || { total: 0, correct: 0 }; em.total += 1; if (e.ok) em.correct += 1; examMap.set(ty, em); }
      const major = q.major || 'Other';
      const key = major + '||' + (q.topic || 'General');
      const tp = topicMap.get(key) || { major, topic: q.topic || 'General', total: 0, correct: 0, pct: 0 };
      tp.total += 1; if (e.ok) tp.correct += 1; topicMap.set(key, tp);
    }
    if (e.t > 0) {
      const h = new Date(e.t).getHours();
      hours[h] += 1; if (e.ok) hoursCorrect[h] += 1;
    }
  });
  const split = (label: string, v?: { total: number; correct: number }): SplitStat => ({
    label, total: v?.total || 0, correct: v?.correct || 0, pct: v && v.total ? Math.round((v.correct / v.total) * 100) : 0
  });
  const byDifficulty = ['Easy', 'Medium', 'Hard'].map((d) => split(d, diffMap.get(d)));
  const byExam = Array.from(examMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => split(k, v));
  topicMap.forEach((t) => { t.pct = Math.round((t.correct / t.total) * 100); });
  const topicsBySubject = new Map<string, TopicStat[]>();
  topicMap.forEach((t) => { const l = topicsBySubject.get(t.major) || []; l.push(t); topicsBySubject.set(t.major, l); });
  const weakTopics = Array.from(topicMap.values()).filter((t) => t.total >= 3).sort((a, b) => a.pct - b.pct || b.total - a.total).slice(0, 5);

  // all subjects of the bank, answered or not
  const names = new Set<string>([...bankTotals.keys(), ...subjectMap.keys()]);
  const subjects: SubjectStat[] = Array.from(names).sort((a, b) => a.localeCompare(b)).map((major) => {
    const v = subjectMap.get(major);
    const fb = firstBySubject.get(major);
    return {
      major,
      total: v?.total || 0,
      correct: v?.correct || 0,
      pct: v && v.total ? Math.round((v.correct / v.total) * 100) : 0,
      seen: seenBySubject.get(major) || 0,
      bankTotal: bankTotals.get(major) || 0,
      firstTryPct: fb && fb.t ? Math.round((fb.c / fb.t) * 100) : null,
      topics: topicsBySubject.get(major) || []
    };
  });
  bySubject.forEach((b) => { const f = subjects.find((x) => x.major === b.major); if (f) { b.seen = f.seen; b.bankTotal = f.bankTotal; b.firstTryPct = f.firstTryPct; b.topics = f.topics; } });

  // peak hour
  let peak: BankPerformance['peak'] = null;
  if (total >= 20) {
    let bh = 0;
    for (let h = 1; h < 24; h++) if (hours[h] > hours[bh]) bh = h;
    const hs = [(bh + 23) % 24, bh, (bh + 1) % 24];
    const wt = hs.reduce((n, h) => n + hours[h], 0), wc = hs.reduce((n, h) => n + hoursCorrect[h], 0);
    if (hours[bh] > 0 && wt > 0) peak = { hour: bh, pct: Math.round((wc / wt) * 100), total: wt };
  }

  // longest streak ever
  const allKeys = Array.from(dayMap.keys()).sort();
  let longest = 0, run = 0, prevD: Date | null = null;
  allKeys.forEach((k) => {
    const d = new Date(k + 'T00:00:00');
    if (prevD && Math.round((d.getTime() - prevD.getTime()) / 86400000) === 1) run += 1; else run = 1;
    if (run > longest) longest = run;
    prevD = d;
  });

  // last 8 weeks
  const weeks: WeekStat[] = [];
  for (let w = 7; w >= 0; w--) {
    let t = 0, c = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (w * 7 + i));
      const v = dayMap.get(dayKey(d));
      if (v) { t += v.total; c += v.correct; }
    }
    weeks.push({ label: 'W' + (8 - w), total: t, correct: c, pct: t > 0 ? Math.round((c / t) * 100) : null });
  }
  let weekGain = 0;
  for (let i = 1; i < weeks.length; i++) {
    const a = weeks[i - 1], b = weeks[i];
    if (a.pct !== null && b.pct !== null && a.total >= 5 && b.total >= 5) weekGain = Math.max(weekGain, b.pct - a.pct);
  }

  // 12-week heat map, weeks start on Monday
  const heat: HeatDay[][] = [];
  const dow = (today.getDay() + 6) % 7; // Mon=0
  const startMonday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow - 11 * 7);
  for (let w = 0; w < 12; w++) {
    const col: HeatDay[] = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(startMonday.getFullYear(), startMonday.getMonth(), startMonday.getDate() + w * 7 + d);
      const k = dayKey(dt), v = dayMap.get(k);
      col.push({ key: k, total: v?.total || 0, correct: v?.correct || 0, future: dt.getTime() > today.getTime() });
    }
    heat.push(col);
  }

  const perfectBlocks = sessions.filter((b) => b.questionIds.length >= 10 && b.score === 100).length;
  const masteredSubjects = bySubject.filter((s) => s.total >= 30 && s.pct >= 80).length;
  const bankSeenTotal = bankQuestions.length;

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
    sessions,
    subjects,
    coverage: { seen, total: bankSeenTotal, pct: bankSeenTotal > 0 ? Math.min(100, Math.round((seen / bankSeenTotal) * 100)) : 0 },
    firstAttempt: firstTotal > 0 ? { total: firstTotal, correct: firstCorrect, pct: Math.round((firstCorrect / firstTotal) * 100) } : null,
    byDifficulty,
    byExam,
    recovered: { recovered: recoveredN, missed },
    hours,
    hoursCorrect,
    peak,
    longestStreak: longest,
    weeks,
    weekGain,
    heat,
    weakTopics,
    perfectBlocks,
    masteredSubjects
  };
};
