import { resolveSession } from './authService';
import { getStoredQuestions } from './questionBankService';
import { Question } from '../types';

export interface LinkablePart {
  id: string;
  title: string;
  page_count?: number;
  keywords?: string | null;
}

const STOP = new Set(['and', 'the', 'of', 'for', 'system', 'systems', 'disease', 'diseases', 'disorders', 'disorder', 'part', 'chapter', 'general', 'principles', 'basic', 'basics', 'with', 'in']);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9؀-ۿ\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Words that identify what a part is about: the admin's own keywords when
// provided (comma separated), otherwise the meaningful words of its title.
const partTerms = (part: LinkablePart): string[] => {
  const fromKeywords = (part.keywords || '').split(/[,،;\n]/).map(norm).filter(Boolean);
  if (fromKeywords.length > 0) return fromKeywords;
  return norm(part.title).split(' ').filter((w) => w.length >= 3 && !STOP.has(w));
};

const questionFields = (q: Question): string[] =>
  [q.major, q.topic, q.subtopic].filter(Boolean).map((v) => norm(String(v)));

const termMatches = (term: string, field: string): boolean => {
  if (!term || !field) return false;
  if (field === term || field.includes(term)) return true;
  // allow "cardio" ~ "cardiovascular", "cardiology" (shared stem of 5+ letters)
  if (term.length >= 5 && field.split(' ').some((w) => w.length >= 5 && (w.startsWith(term.slice(0, 5)) && term.startsWith(w.slice(0, 5))))) return true;
  return false;
};

export const questionMatchesPart = (q: Question, part: LinkablePart): boolean => {
  const terms = partTerms(part);
  if (terms.length === 0) return false;
  const fields = questionFields(q);
  return terms.some((t) => fields.some((f) => termMatches(t, f)));
};

const humanMedicineQuestions = (): Question[] =>
  getStoredQuestions().filter((q) => q.bankId === 'human_medicine');

export const questionsForPart = (part: LinkablePart): Question[] =>
  humanMedicineQuestions().filter((q) => questionMatchesPart(q, part));

// Majors/topics to use as a block filter that reproduces questionsForPart.
export const filtersForPart = (part: LinkablePart): { majors?: string[]; topics?: string[] } | null => {
  const matched = questionsForPart(part);
  if (matched.length === 0) return null;
  const terms = partTerms(part);
  const majors = Array.from(new Set<string>(matched.filter((q) => questionFields({ ...q, topic: '', subtopic: '' } as Question).some((f) => terms.some((t) => termMatches(t, f)))).map((q) => q.major)));
  if (majors.length > 0) return { majors };
  const topics = Array.from(new Set<string>(matched.map((q) => q.topic).filter(Boolean)));
  return topics.length > 0 ? { topics } : null;
};

export const bestPartForQuestion = (q: Question, parts: LinkablePart[]): LinkablePart | null => {
  let best: LinkablePart | null = null;
  let bestScore = 0;
  for (const p of parts) {
    const terms = partTerms(p);
    const fields = questionFields(q);
    let score = 0;
    for (const t of terms) {
      fields.forEach((f, i) => { if (termMatches(t, f)) score += i === 0 ? 1 : 2; }); // topic matches count more than major
    }
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
};

// Parts list is cached for the session (students without a Human Medicine
// subscription simply get an empty list and no link is shown).
let partsCache: LinkablePart[] | null = null;
let partsPromise: Promise<LinkablePart[]> | null = null;

export const loadFirstAidParts = (): Promise<LinkablePart[]> => {
  if (partsCache) return Promise.resolve(partsCache);
  if (partsPromise) return partsPromise;
  const user = resolveSession().user;
  partsPromise = fetch('/api/study-book', {
    headers: { 'x-telegram-user-id': user.telegramId || '', 'x-telegram-username': user.username || '' }
  })
    .then((r) => r.json())
    .then((d) => {
      partsCache = d?.success ? (d.parts || []) : [];
      return partsCache as LinkablePart[];
    })
    .catch(() => [] as LinkablePart[])
    .finally(() => { partsPromise = null; });
  return partsPromise;
};
