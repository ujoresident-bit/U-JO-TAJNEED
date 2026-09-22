import {
  Question,
  QuestionBankMeta,
  Block,
  BlockFilters,
  OptionKey,
  HighlightRange,
  QuestionStats,
  ImportBatch,
  ImportPreviewResult,
  InvalidQuestionError
} from '../types';
import { DEMO_QUESTIONS, MOH_BANK_META, DEMO_QUESTION_STATS } from './demoData';
import { getSubscriptionStatus, syncSubscriptionFromSupabase } from './subscriptionService';
import { verifyTelegramAdminAuthorization, getCanonicalTelegramUser, getCurrentUser } from './authService';
import { syncQuestionProgressToSupabase } from './progressService';

const BANK_ID = 'moh_bank';
const BLOCKS_STORAGE_KEY = 'ujo_blocks_v1';
const QUESTIONS_STORAGE_KEY = 'ujo_questions_prod_v1';
const IMPORT_BATCHES_STORAGE_KEY = 'ujo_import_batches_v1';

const memoryQuestionStorage: Record<string, string> = {};

export const getStoredQuestions = (): Question[] => {
  try {
    let raw: string | null = null;
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('ujo_questions_v1');
      localStorage.removeItem('ujo_questions_v2');
      raw = localStorage.getItem(QUESTIONS_STORAGE_KEY);
    } else if (memoryQuestionStorage[QUESTIONS_STORAGE_KEY]) {
      raw = memoryQuestionStorage[QUESTIONS_STORAGE_KEY];
    } else {
      // In non-browser environment with no stored questions, default to DEMO_QUESTIONS for test execution
      return DEMO_QUESTIONS as Question[];
    }

    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Error reading stored questions:', e);
  }
  return DEMO_QUESTIONS as Question[];
};

export const saveStoredQuestions = (questions: Question[]): void => {
  const serialized = JSON.stringify(questions);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(QUESTIONS_STORAGE_KEY, serialized);
  } else {
    memoryQuestionStorage[QUESTIONS_STORAGE_KEY] = serialized;
  }
};

export const fetchQuestionsFromSupabase = async (page = 1, limit = 100, major?: string, year?: number): Promise<{ total: number; questions: Question[] }> => {
  try {
    if (typeof window === 'undefined') return { total: 0, questions: [] };
    const queryParams = new URLSearchParams({
      page: String(page),
      limit: String(limit)
    });
    if (major && major !== 'All') queryParams.append('major', major);
    if (year) queryParams.append('year', String(year));

    const res = await fetch(`/api/questions?${queryParams.toString()}`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);

    const data = await res.json();
    if (data && Array.isArray(data.questions)) {
      return { total: data.total || data.questions.length, questions: data.questions };
    }
  } catch (err) {
    console.warn("Background fetch of questions from Supabase failed, falling back to local storage:", err);
  }
  return { total: 0, questions: [] };
};

export const syncQuestionsWithSupabase = async (): Promise<Question[]> => {
  if (typeof window === 'undefined') return getStoredQuestions();

  try {
    let allRemoteQuestions: Question[] = [];
    let page = 1;
    const limit = 1000;
    let totalCount = 0;
    let fetchedSuccessfully = false;

    do {
      const res = await fetchQuestionsFromSupabase(page, limit);
      if (res && Array.isArray(res.questions)) {
        fetchedSuccessfully = true;
        totalCount = res.total;
        allRemoteQuestions.push(...res.questions);
        if (allRemoteQuestions.length >= totalCount || res.questions.length < limit || res.questions.length === 0) {
          break;
        }
        page++;
      } else {
        break;
      }
    } while (allRemoteQuestions.length < totalCount);

    if (fetchedSuccessfully) {
      // Deduplicate remote questions by ID while maintaining clean dataset
      const uniqueMap = new Map<string, Question>();
      allRemoteQuestions.forEach((q) => {
        if (q && q.id) {
          uniqueMap.set(String(q.id).trim(), q);
        }
      });
      const cleanRemoteQuestions = Array.from(uniqueMap.values());

      // CRITICAL SYNCHRONIZATION RULE FOR ISSUE 2:
      // The local cache MUST become an exact mirror of the remote question dataset.
      // Do NOT merge or preserve old questions that no longer exist remotely in Supabase.
      saveStoredQuestions(cleanRemoteQuestions);

      console.log(`[QUESTIONS DIAGNOSTIC] Exact mirror sync success: Supabase=${totalCount}, LocalCache=${cleanRemoteQuestions.length}`);

      return cleanRemoteQuestions;
    }
  } catch (err) {
    console.warn('[QUESTIONS SYNC] Supabase question sync error, falling back to cached dataset:', err);
  }

  return getStoredQuestions();
};

export const getQuestionCountsDiagnostic = async (filters?: BlockFilters) => {
  const localQuestions = getStoredQuestions();
  const localCount = localQuestions.length;

  let apiTotal = localCount;
  try {
    const remote = await fetchQuestionsFromSupabase(1, 1);
    if (typeof remote.total === 'number') {
      apiTotal = remote.total;
    }
  } catch {}

  const matching = filters ? getFilteredQuestions(filters) : localQuestions;

  const summary = {
    supabase: apiTotal,
    api: apiTotal,
    local: localCount,
    filtered: matching.length
  };

  console.log(`[QUESTIONS] supabase=${summary.supabase} api=${summary.api} local=${summary.local} filtered=${summary.filtered}`);
  return summary;
};

export const getImportBatches = (): ImportBatch[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(IMPORT_BATCHES_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Error reading import batches:', e);
  }
  return [];
};

export const saveImportBatchRecord = (batch: ImportBatch): void => {
  const batches = getImportBatches();
  batches.unshift(batch);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(IMPORT_BATCHES_STORAGE_KEY, JSON.stringify(batches));
  }
};

const getStoredBlocks = (): Record<string, Block> => {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(BLOCKS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Error reading stored blocks:', e);
  }
  return {};
};

const saveStoredBlocks = (blocks: Record<string, Block>) => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(BLOCKS_STORAGE_KEY, JSON.stringify(blocks));
  }
};

export const getQuestionBankMeta = (bankId: string = BANK_ID): QuestionBankMeta => {
  const questions = getStoredQuestions().filter((q) => !bankId || q.bankId === bankId || bankId === 'moh_bank');
  
  // Calculate dynamic meta counts from stored questions
  const totalQuestions = questions.length;
  const yearsAvailable = Array.from(new Set(questions.map((q) => q.year))).sort((a, b) => a - b);
  if (yearsAvailable.length === 0) {
    yearsAvailable.push(...MOH_BANK_META.yearsAvailable);
  }

  // Calculate dynamic majors & sub-topics breakdown from actual stored questions
  const majorMap: Record<string, { count: number; topics: Record<string, number> }> = {};
  questions.forEach((q) => {
    const majorName = q.major || 'General Medicine';
    const topicName = q.topic || 'General Topics';
    if (!majorMap[majorName]) {
      majorMap[majorName] = { count: 0, topics: {} };
    }
    majorMap[majorName].count += 1;
    majorMap[majorName].topics[topicName] = (majorMap[majorName].topics[topicName] || 0) + 1;
  });

  const majors = Object.entries(majorMap).map(([mName, mData]) => ({
    name: mName,
    questionCount: mData.count,
    topics: Object.entries(mData.topics).map(([tName, tCount]) => ({
      name: tName,
      questionCount: tCount
    }))
  }));

  return {
    ...MOH_BANK_META,
    totalQuestions,
    yearsAvailable,
    majors
  };
};

export const getUserQuestionStatusSets = (userId?: string): { answeredQuestionIds: Set<string>; encounteredQuestionIds: Set<string> } => {
  let targetUserId = userId;
  if (!targetUserId) {
    try {
      targetUserId = getCurrentUser().telegramId;
    } catch {
      targetUserId = 'web_resident_01';
    }
  }

  const allBlocks = getAllStoredBlocks().filter(
    (b) => b.userId === targetUserId || b.userId === 'web_resident_01'
  );

  const answeredQuestionIds = new Set<string>();
  const encounteredQuestionIds = new Set<string>();

  allBlocks.forEach((block) => {
    (block.questionIds || []).forEach((qId) => encounteredQuestionIds.add(qId));
    if (block.answers) {
      Object.keys(block.answers).forEach((qId) => {
        if (block.answers[qId]) {
          answeredQuestionIds.add(qId);
        }
      });
    }
  });

  return { answeredQuestionIds, encounteredQuestionIds };
};

export const getFilteredQuestions = (filters: BlockFilters): Question[] => {
  const allQuestions = getStoredQuestions();

  let answeredSet: Set<string> | null = null;
  let encounteredSet: Set<string> | null = null;

  if (filters.statusFilter && filters.statusFilter !== 'ALL') {
    const { answeredQuestionIds, encounteredQuestionIds } = getUserQuestionStatusSets(filters.userId);
    answeredSet = answeredQuestionIds;
    encounteredSet = encounteredQuestionIds;
  }

  return allQuestions.filter((q) => {
    // Multi-select Majors
    if (filters.majors && filters.majors.length > 0 && !filters.majors.includes('All')) {
      const qMajor = q.major || 'General Medicine';
      if (!filters.majors.includes(qMajor)) return false;
    } else if (filters.major && filters.major !== 'All') {
      const qMajor = q.major || 'General Medicine';
      if (qMajor !== filters.major) return false;
    }

    // Multi-select Topics
    if (filters.topics && filters.topics.length > 0 && !filters.topics.includes('All')) {
      const qTopic = q.topic || 'General Topics';
      if (!filters.topics.includes(qTopic)) return false;
    } else if (filters.topic && filters.topic !== 'All') {
      const qTopic = q.topic || 'General Topics';
      if (qTopic !== filters.topic) return false;
    }

    if (filters.years && filters.years.length > 0 && !filters.years.includes(q.year)) {
      return false;
    }
    if (filters.difficulty && filters.difficulty !== 'All' && q.difficulty !== filters.difficulty) {
      return false;
    }

    // Question Status Filter
    if (filters.statusFilter && filters.statusFilter !== 'ALL' && answeredSet && encounteredSet) {
      const isAnswered = answeredSet.has(q.id);
      const isEncountered = encounteredSet.has(q.id);

      if (filters.statusFilter === 'COMPLETE' && !isAnswered) {
        return false;
      }
      if (filters.statusFilter === 'UNCOMPLETED' && (!isEncountered || isAnswered)) {
        return false;
      }
      if (filters.statusFilter === 'UNUSED' && isEncountered) {
        return false;
      }
    }

    return true;
  });
};

export const getQuestionById = (questionId: string): Question | null => {
  const questions = getStoredQuestions();
  return questions.find((q) => q.id === questionId) || null;
};

// ==========================================
// ADMIN QUESTION BANK IMPORT & MANAGEMENT
// ==========================================

// Helper function to parse raw text format questions (Q. / A. / B. / C. / D. / Answer: / Explanation:)
export const parseTextQuestions = (content: string): any[] => {
  if (!content || typeof content !== 'string') return [];

  // Normalize line endings
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  const isQuestionStart = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    return /^(?:Q\s*[\.\:\-]|Q\s*\d+[\.\:\-]?|\d+[\.\)]\s*Q[\.\:]?|Question\s*\d*[\.\:\-]?|\[Q?\d+\]|\d+[\.\)])/i.test(trimmed);
  };

  const isOptionA = (line: string): boolean => {
    const trimmed = line.trim();
    return /^(?:A[\.\:\)\-]|\[A\]|\(A\))\s*/i.test(trimmed);
  };

  const rawBlocks: string[] = [];
  let currentBlockLines: string[] = [];
  let hasOptA = false;

  for (const line of lines) {
    if (isOptionA(line)) {
      hasOptA = true;
    }

    if (isQuestionStart(line) && hasOptA && currentBlockLines.length > 0) {
      rawBlocks.push(currentBlockLines.join('\n'));
      currentBlockLines = [line];
      hasOptA = isOptionA(line);
      continue;
    }

    currentBlockLines.push(line);
  }

  if (currentBlockLines.length > 0) {
    rawBlocks.push(currentBlockLines.join('\n'));
  }

  const parsedQuestions: any[] = [];

  for (const block of rawBlocks) {
    if (!block.trim()) continue;

    // Look for Option A, B, C, D markers
    const optAMatch = block.match(/(?:^|\n)\s*(?:A[\.\:\)\-]|\[A\]|\(A\))\s*/i);
    const optBMatch = block.match(/(?:^|\n)\s*(?:B[\.\:\)\-]|\[B\]|\(B\))\s*/i);
    const optCMatch = block.match(/(?:^|\n)\s*(?:C[\.\:\)\-]|\[C\]|\(C\))\s*/i);
    const optDMatch = block.match(/(?:^|\n)\s*(?:D[\.\:\)\-]|\[D\]|\(D\))\s*/i);

    if (!optAMatch || !optBMatch || !optCMatch || !optDMatch) {
      continue;
    }

    const posA = optAMatch.index!;
    const posB = optBMatch.index!;
    const posC = optCMatch.index!;
    const posD = optDMatch.index!;

    if (posA >= posB || posB >= posC || posC >= posD) {
      continue;
    }

    // Extract Question Stem (everything before Option A)
    let stem = block.substring(0, posA).trim();
    stem = stem.replace(/^(?:\s*Q\s*[\.\:\-]|Q\s*\d+[\.\:\-]?|\d+[\.\)]\s*Q[\.\:]?|Question\s*\d*[\.\:\-]?|\[Q?\d+\]|\d+[\.\)])\s*/i, '').trim();

    // Option A
    const textA = block.substring(posA + optAMatch[0].length, posB).trim();

    // Option B
    const textB = block.substring(posB + optBMatch[0].length, posC).trim();

    // Option C
    const textC = block.substring(posC + optCMatch[0].length, posD).trim();

    // Answer and Explanation markers after D
    const ansMatch = block.match(/(?:^|\n)\s*(?:Answer|Ans|Correct\s*Answer|Correct)\s*[\:\=\-]?\s*\[?\(?([A-Da-d])\)?\]?/i);
    const expMatch = block.match(/(?:^|\n)\s*(?:Explanation|Exp|Rationale|Discussion)\s*[\:\=\-]?\s*/i);

    const posAns = ansMatch ? ansMatch.index! : -1;
    const posExp = expMatch ? expMatch.index! : -1;

    let endDPos = block.length;
    if (posAns > posD) endDPos = Math.min(endDPos, posAns);
    if (posExp > posD) endDPos = Math.min(endDPos, posExp);

    const textD = block.substring(posD + optDMatch[0].length, endDPos).trim();

    const answerLetter = ansMatch ? ansMatch[1].toUpperCase() : '';

    let explanationText = '';
    if (expMatch && posExp > -1) {
      const expStart = posExp + expMatch[0].length;
      if (posAns > posExp) {
        explanationText = block.substring(expStart, posAns).trim();
      } else {
        explanationText = block.substring(expStart).trim();
      }
    }

    if (stem && textA && textB && textC && textD) {
      parsedQuestions.push({
        question: stem,
        options: {
          A: textA,
          B: textB,
          C: textC,
          D: textD
        },
        correctAnswer: answerLetter,
        explanation: explanationText
      });
    }
  }

  return parsedQuestions;
};

export const previewImportBatch = (
  selectedBankId: string,
  selectedYear: number,
  jsonContent: string,
  fileName: string
): ImportPreviewResult => {
  if (!verifyTelegramAdminAuthorization()) {
    throw new Error('UNAUTHORIZED_ADMIN_ONLY: Only authorized admins can preview or import questions.');
  }

  let rawQuestions: any[] = [];
  let isJsonParsed = false;

  try {
    const parsed = JSON.parse(jsonContent);
    isJsonParsed = true;
    if (Array.isArray(parsed)) {
      rawQuestions = parsed;
    } else if (parsed && Array.isArray(parsed.questions)) {
      rawQuestions = parsed.questions;
    } else if (parsed && Array.isArray(parsed.items)) {
      rawQuestions = parsed.items;
    } else if (parsed && Array.isArray(parsed.data)) {
      rawQuestions = parsed.data;
    } else if (parsed && typeof parsed === 'object') {
      rawQuestions = [parsed];
    }
  } catch {
    // If JSON parsing fails, treat content as raw text
    rawQuestions = parseTextQuestions(jsonContent);
  }

  // Fallback if JSON parsed but yielded no array items, or if raw text was passed
  if (rawQuestions.length === 0) {
    rawQuestions = parseTextQuestions(jsonContent);
  }

  // Check year mismatch warning in file name
  let yearMismatchWarning: string | undefined;
  const filenameYearMatch = fileName.match(/\b(20\d\d)\b/);
  if (filenameYearMatch) {
    const fileYear = parseInt(filenameYearMatch[1], 10);
    if (fileYear >= 2010 && fileYear <= 2030 && fileYear !== selectedYear) {
      yearMismatchWarning = `Filename "${fileName}" suggests year ${fileYear}, but Admin selected ${selectedYear}. The Admin selected year (${selectedYear}) will be applied.`;
    }
  }

  const existingQuestions = getStoredQuestions();
  const existingIdsSet = new Set(existingQuestions.map((q) => q.id));

  const validQuestions: Question[] = [];
  const invalidQuestions: InvalidQuestionError[] = [];
  const duplicateQuestions: Question[] = [];
  let needsReviewCount = 0;

  // Flatten rawQuestions in case individual elements are text blocks or arrays
  const normalizedRawList: any[] = [];
  rawQuestions.forEach((item) => {
    if (typeof item === 'string') {
      const parsedBlock = parseTextQuestions(item);
      if (parsedBlock.length > 0) {
        normalizedRawList.push(...parsedBlock);
      } else {
        normalizedRawList.push(item);
      }
    } else {
      normalizedRawList.push(item);
    }
  });

  normalizedRawList.forEach((qObj, idx) => {
    const reasons: string[] = [];

    if (!qObj || typeof qObj !== 'object') {
      invalidQuestions.push({
        index: idx + 1,
        questionTextSample: typeof qObj === 'string' ? qObj.substring(0, 60) : 'Invalid object structure',
        reasons: ['Question entry is not a valid question object']
      });
      return;
    }

    const rawQuestionText =
      qObj.question ||
      qObj.questionText ||
      qObj.question_text ||
      qObj.q ||
      qObj.Q ||
      qObj.text ||
      qObj.stem ||
      qObj.stem_text ||
      qObj.question_stem ||
      qObj.Question ||
      qObj.QuestionText ||
      qObj.prompt ||
      qObj.body ||
      qObj.content ||
      qObj.title ||
      qObj.item ||
      qObj.description;

    const questionText = typeof rawQuestionText === 'string' ? rawQuestionText.trim() : (rawQuestionText ? String(rawQuestionText).trim() : '');
    if (!questionText) {
      reasons.push('Missing question stem text');
    }

    // Check options from either qObj.options object or flat keys A, B, C, D
    let opts: { A?: string; B?: string; C?: string; D?: string } | null = null;
    if (qObj.options && typeof qObj.options === 'object' && !Array.isArray(qObj.options)) {
      opts = {
        A: String(qObj.options.A || qObj.options.a || '').trim(),
        B: String(qObj.options.B || qObj.options.b || '').trim(),
        C: String(qObj.options.C || qObj.options.c || '').trim(),
        D: String(qObj.options.D || qObj.options.d || '').trim(),
      };
    } else if (qObj.A !== undefined || qObj.a !== undefined) {
      opts = {
        A: String(qObj.A || qObj.a || '').trim(),
        B: String(qObj.B || qObj.b || '').trim(),
        C: String(qObj.C || qObj.c || '').trim(),
        D: String(qObj.D || qObj.d || '').trim(),
      };
    } else if (Array.isArray(qObj.options) && qObj.options.length >= 4) {
      opts = {
        A: String(qObj.options[0] || '').trim(),
        B: String(qObj.options[1] || '').trim(),
        C: String(qObj.options[2] || '').trim(),
        D: String(qObj.options[3] || '').trim(),
      };
    } else if (Array.isArray(qObj.choices) && qObj.choices.length >= 4) {
      opts = {
        A: String(qObj.choices[0] || '').trim(),
        B: String(qObj.choices[1] || '').trim(),
        C: String(qObj.choices[2] || '').trim(),
        D: String(qObj.choices[3] || '').trim(),
      };
    }

    if (!opts) {
      reasons.push('Missing or invalid options (A, B, C, D required)');
    } else {
      if (!opts.A) reasons.push('Missing option A');
      if (!opts.B) reasons.push('Missing option B');
      if (!opts.C) reasons.push('Missing option C');
      if (!opts.D) reasons.push('Missing option D');
    }

    // Check correctAnswer from correctAnswer, correct_answer, answer, Answer, ans, etc.
    const ans = String(
      qObj.correctAnswer || qObj.correct_answer || qObj.answer || qObj.Answer || qObj.ans || qObj.correct || ''
    ).toUpperCase().trim();

    if (!['A', 'B', 'C', 'D'].includes(ans)) {
      reasons.push(`Invalid correctAnswer "${ans}" (must be A, B, C, or D)`);
    }

    if (reasons.length > 0) {
      invalidQuestions.push({
        id: qObj.id,
        index: idx + 1,
        questionTextSample: (questionText || 'No text').substring(0, 60) + '...',
        reasons
      });
      return;
    }

    // Question is valid! Process metadata
    const majorStr = qObj.major && String(qObj.major).trim() ? String(qObj.major).trim() : null;
    const topicStr = qObj.topic && String(qObj.topic).trim() ? String(qObj.topic).trim() : null;

    const needsReview = !majorStr || !topicStr;
    if (needsReview) {
      needsReviewCount++;
    }

    const qId = qObj.id && String(qObj.id).trim()
      ? String(qObj.id).trim()
      : `${selectedBankId.toUpperCase()}-${selectedYear}-${String(idx + 1).padStart(3, '0')}`;

    const rawExplanation = qObj.explanation || qObj.Explanation || qObj.exp || qObj.rationale;

    const formattedQ: Question = {
      id: qId,
      bankId: selectedBankId,
      year: selectedYear, // Admin selected year is authoritative
      question: String(questionText).trim(),
      options: {
        A: opts!.A!,
        B: opts!.B!,
        C: opts!.C!,
        D: opts!.D!
      },
      correctAnswer: ans as OptionKey,
      explanation: rawExplanation ? String(rawExplanation).trim() : 'No explanation provided.',
      optionExplanations: qObj.optionExplanations || undefined,
      needsReview: typeof qObj.needsReview === 'boolean' ? qObj.needsReview : needsReview,
      reviewNote: qObj.reviewNote ? String(qObj.reviewNote).trim() : (needsReview ? 'Missing major or topic category' : undefined),
      major: majorStr || 'General Medical Sciences',
      topic: topicStr || 'Unassigned Topic',
      difficulty: qObj.difficulty && ['Easy', 'Medium', 'Hard'].includes(qObj.difficulty) ? qObj.difficulty : 'Medium',
      classificationStatus: (qObj.needsReview || needsReview) ? 'NEEDS_REVIEW' : 'CLASSIFIED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (existingIdsSet.has(qId)) {
      duplicateQuestions.push(formattedQ);
    }

    validQuestions.push(formattedQ);
  });

  return {
    bankId: selectedBankId,
    year: selectedYear,
    fileName,
    totalInFile: normalizedRawList.length,
    validQuestions,
    invalidQuestions,
    duplicateQuestions,
    needsReviewCount,
    yearMismatchWarning
  };
};

export const executeImportBatch = async (
  previewResult: ImportPreviewResult,
  duplicateAction: 'skip' | 'update' | 'cancel',
  adminId: string
): Promise<{ importedCount: number; batchId: string }> => {
  if (!verifyTelegramAdminAuthorization(adminId)) {
    throw new Error('UNAUTHORIZED_ADMIN_ONLY: Authorization required.');
  }

  if (duplicateAction === 'cancel') {
    throw new Error('Import cancelled by Admin.');
  }

  let existing = getStoredQuestions();
  const existingIdsSet = new Set(existing.map((q) => q.id));

  let questionsToAddOrUpdate = [...previewResult.validQuestions];

  if (duplicateAction === 'skip') {
    questionsToAddOrUpdate = questionsToAddOrUpdate.filter((q) => !existingIdsSet.has(q.id));
  }

  // Persist batch to Supabase via backend API
  const res = await fetch('/api/questions/import?dryRun=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-user-id': adminId
    },
    body: JSON.stringify({
      questions: questionsToAddOrUpdate,
      dryRun: false
    })
  });

  const responseData = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(responseData.error || `HTTP error ${res.status}: Failed to import questions to Supabase database.`);
  }

  // Update local storage cache
  if (duplicateAction === 'update') {
    const updateMap = new Map<string, Question>();
    existing.forEach((q) => updateMap.set(q.id, q));
    questionsToAddOrUpdate.forEach((q) => updateMap.set(q.id, q));
    existing = Array.from(updateMap.values());
  } else {
    const existingIds = new Set(existing.map((q) => q.id));
    questionsToAddOrUpdate.forEach((q) => {
      if (!existingIds.has(q.id)) {
        existing.push(q);
      }
    });
  }

  saveStoredQuestions(existing);

  const batchId = `import_${Date.now()}`;
  const batchRecord: ImportBatch = {
    id: batchId,
    bankId: previewResult.bankId,
    year: previewResult.year,
    adminId,
    status: 'COMPLETED',
    totalQuestions: previewResult.totalInFile,
    validCount: previewResult.validQuestions.length,
    invalidCount: previewResult.invalidQuestions.length,
    duplicateCount: previewResult.duplicateQuestions.length,
    needsReviewCount: previewResult.needsReviewCount,
    createdAt: new Date().toISOString(),
    fileName: previewResult.fileName
  };

  saveImportBatchRecord(batchRecord);

  // Sync back full remote set from Supabase
  await syncQuestionsWithSupabase().catch(() => {});

  return {
    importedCount: responseData.importedCount || questionsToAddOrUpdate.length,
    batchId
  };
};

export const addSingleQuestion = async (
  questionData: Omit<Question, 'createdAt' | 'updatedAt'>,
  adminId?: string
): Promise<Question> => {
  if (!verifyTelegramAdminAuthorization(adminId)) {
    throw new Error('UNAUTHORIZED_ADMIN_ONLY: Authorization required.');
  }

  const isNeedsReview = !questionData.major || questionData.major === 'Unassigned Topic' || !questionData.topic;

  const newQ: Question = {
    ...questionData,
    classificationStatus: isNeedsReview ? 'NEEDS_REVIEW' : 'CLASSIFIED',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const res = await fetch('/api/questions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-user-id': adminId || ''
    },
    body: JSON.stringify(newQ)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP error ${res.status}: Failed to create question in Supabase.`);
  }

  const existing = getStoredQuestions();
  existing.unshift(newQ);
  saveStoredQuestions(existing);
  return newQ;
};

export const updateSingleQuestion = async (
  updatedQ: Question,
  adminId?: string
): Promise<Question> => {
  if (!verifyTelegramAdminAuthorization(adminId)) {
    throw new Error('UNAUTHORIZED_ADMIN_ONLY: Authorization required.');
  }

  const isNeedsReview = !updatedQ.major || updatedQ.major === 'Unassigned Topic' || !updatedQ.topic;

  const savedQ: Question = {
    ...updatedQ,
    classificationStatus: isNeedsReview ? 'NEEDS_REVIEW' : 'CLASSIFIED',
    updatedAt: new Date().toISOString()
  };

  const res = await fetch(`/api/questions/${encodeURIComponent(updatedQ.id)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-user-id': adminId || ''
    },
    body: JSON.stringify(savedQ)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP error ${res.status}: Failed to update question in Supabase.`);
  }

  const existing = getStoredQuestions();
  const idx = existing.findIndex((q) => q.id === updatedQ.id);
  if (idx !== -1) {
    existing[idx] = savedQ;
    saveStoredQuestions(existing);
  }
  return savedQ;
};

export const deleteSingleQuestion = async (
  questionId: string,
  adminId?: string
): Promise<void> => {
  if (!verifyTelegramAdminAuthorization(adminId)) {
    throw new Error('UNAUTHORIZED_ADMIN_ONLY: Authorization required.');
  }

  const res = await fetch(`/api/questions/${encodeURIComponent(questionId)}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-user-id': adminId || ''
    }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP error ${res.status}: Failed to delete question from Supabase.`);
  }

  const existing = getStoredQuestions();
  const filtered = existing.filter((q) => q.id !== questionId);
  saveStoredQuestions(filtered);
};

export const migrateLocalQuestionsToSupabase = async (
  adminId: string
): Promise<{ success: boolean; count: number; message: string }> => {
  if (!verifyTelegramAdminAuthorization(adminId)) {
    throw new Error('UNAUTHORIZED_ADMIN_ONLY: Authorization required.');
  }

  const localQuestions = getStoredQuestions();
  if (localQuestions.length === 0) {
    return {
      success: true,
      count: 0,
      message: 'No local questions found in browser storage to migrate.'
    };
  }

  const res = await fetch('/api/questions/import?dryRun=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-user-id': adminId
    },
    body: JSON.stringify({
      questions: localQuestions,
      dryRun: false
    })
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `HTTP error ${res.status}: Failed to migrate local questions to Supabase.`);
  }

  await syncQuestionsWithSupabase().catch(() => {});

  return {
    success: true,
    count: data.importedCount || localQuestions.length,
    message: `Successfully migrated ${data.importedCount || localQuestions.length} questions to Supabase database.`
  };
};

export const deleteAllQuestions = async (
  telegramUserId?: string,
  telegramUsername?: string
): Promise<{ success: boolean; message: string; deletedCount: number }> => {
  const currentUser = getCurrentUser();
  const userId = telegramUserId || currentUser?.telegramId || '';
  const username = telegramUsername || currentUser?.username || '';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-telegram-user-id': userId,
    'x-telegram-username': username
  };

  const res = await fetch('/api/questions', {
    method: 'DELETE',
    headers
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `HTTP error ${res.status}: Failed to delete all questions.`);
  }

  // Clear local storage cache and import batches
  saveStoredQuestions([]);
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(IMPORT_BATCHES_STORAGE_KEY);
  }

  return {
    success: true,
    message: data.message || 'تم حذف جميع الأسئلة بنجاح.',
    deletedCount: data.deletedCount ?? 0
  };
};

export const exportQuestionsJSON = (filters?: {
  bankId?: string;
  year?: number;
  major?: string;
  topic?: string;
  classificationStatus?: string;
}): string => {
  if (!verifyTelegramAdminAuthorization()) {
    throw new Error('UNAUTHORIZED_ADMIN_ONLY: Authorization required.');
  }

  let questions = getStoredQuestions();

  if (filters) {
    if (filters.bankId && filters.bankId !== 'All') {
      questions = questions.filter((q) => q.bankId === filters.bankId);
    }
    if (filters.year) {
      questions = questions.filter((q) => q.year === filters.year);
    }
    if (filters.major && filters.major !== 'All') {
      questions = questions.filter((q) => q.major === filters.major);
    }
    if (filters.topic && filters.topic !== 'All') {
      questions = questions.filter((q) => q.topic === filters.topic);
    }
    if (filters.classificationStatus && filters.classificationStatus !== 'All') {
      questions = questions.filter((q) => (q.classificationStatus || 'CLASSIFIED') === filters.classificationStatus);
    }
  }

  const exportObject = {
    bank: filters?.bankId || 'MOH',
    exportedAt: new Date().toISOString(),
    totalQuestions: questions.length,
    questions
  };

  return JSON.stringify(exportObject, null, 2);
};

export const getQuestionBankStatsOverview = () => {
  const questions = getStoredQuestions();
  const total = questions.length;

  // Year breakdown
  const yearCounts: Record<number, number> = {};
  for (let y = 2015; y <= 2025; y++) {
    yearCounts[y] = 0;
  }
  questions.forEach((q) => {
    if (q.year >= 2015 && q.year <= 2025) {
      yearCounts[q.year] = (yearCounts[q.year] || 0) + 1;
    }
  });

  // Major breakdown
  const majorCounts: Record<string, number> = {};
  questions.forEach((q) => {
    const m = q.major || 'Unassigned';
    majorCounts[m] = (majorCounts[m] || 0) + 1;
  });

  // Classification status breakdown
  let classifiedCount = 0;
  let needsReviewCount = 0;
  questions.forEach((q) => {
    if (q.classificationStatus === 'NEEDS_REVIEW' || !q.major || !q.topic) {
      needsReviewCount++;
    } else {
      classifiedCount++;
    }
  });

  return {
    total,
    yearCounts,
    majorCounts,
    classifiedCount,
    needsReviewCount
  };
};

export const getQuestionStats = (questionId: string): QuestionStats => {
  return (
    DEMO_QUESTION_STATS[questionId] || {
      questionId,
      distribution: { A: 25, B: 25, C: 25, D: 25 },
      totalAttempts: 0
    }
  );
};

export const syncBlockToSupabase = async (block: Block): Promise<void> => {
  try {
    if (typeof window === 'undefined') return;
    const user = getCurrentUser();
    await fetch('/api/blocks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-user-id': user.telegramId || '',
        'x-telegram-username': user.username || ''
      },
      body: JSON.stringify({ block })
    });
  } catch (err) {
    console.warn("Background sync of block to Supabase failed, falling back to local storage:", err);
  }
};

export const syncBlocksFromSupabase = async (status?: string, bankId?: string): Promise<Block[]> => {
  try {
    if (typeof window === 'undefined') return getAllStoredBlocks();
    const user = getCurrentUser();
    const queryParams = new URLSearchParams();
    if (status) queryParams.append('status', status);
    if (bankId) queryParams.append('bankId', bankId);

    const res = await fetch(`/api/blocks?${queryParams.toString()}`, {
      headers: {
        'x-telegram-user-id': user.telegramId || '',
        'x-telegram-username': user.username || ''
      }
    });

    if (!res.ok) throw new Error(`HTTP error ${res.status}`);

    const data = await res.json();
    if (data && Array.isArray(data.blocks)) {
      const localBlocksMap = getStoredBlocks();
      data.blocks.forEach((remoteBlock: Block) => {
        const local = localBlocksMap[remoteBlock.id];
        if (!local || new Date(remoteBlock.updatedAt) >= new Date(local.updatedAt)) {
          localBlocksMap[remoteBlock.id] = remoteBlock;
        }
      });
      saveStoredBlocks(localBlocksMap);
      return Object.values(localBlocksMap);
    }
  } catch (err) {
    console.warn("Background sync of blocks from Supabase failed, falling back to local storage:", err);
  }
  return getAllStoredBlocks();
};

export const startBlock = async (userId: string, filters: BlockFilters, bankId: string = BANK_ID): Promise<Block> => {
  // 1. Resolve canonical Telegram ID
  const user = getCanonicalTelegramUser(userId);
  const canonicalId = user.telegramId || userId;
  const canonicalUsername = user.username;

  if (!canonicalId) {
    console.error('[AUTH DIAGNOSTIC] Failure: IDENTITY_NOT_RESOLVED');
    throw new Error('IDENTITY_NOT_RESOLVED: Unable to resolve canonical Telegram user identity.');
  }

  console.log(`[AUTH] canonicalTelegramId=${canonicalId}`);

  // 2. Check Admin Privileges
  const isAdmin = verifyTelegramAdminAuthorization(canonicalId) || verifyTelegramAdminAuthorization(canonicalUsername);

  // 3. Query authoritative subscription status from backend/Supabase if not admin
  if (!isAdmin) {
    const sub = await syncSubscriptionFromSupabase(canonicalId, canonicalUsername);

    if (!sub) {
      console.error(`[SUBSCRIPTION] userId=${canonicalId} status=NOT_FOUND`);
      throw new Error('SUBSCRIPTION_NOT_FOUND: No subscription record found for this Telegram account.');
    }

    const rawSubStatus = String(sub.status || '').toUpperCase();
    const isStatusActive = rawSubStatus === 'ACTIVE' || rawSubStatus === 'APPROVED';
    const expiresAtTime = sub.expiryDate ? new Date(sub.expiryDate).getTime() : 0;
    const isExpired = expiresAtTime > 0 && expiresAtTime <= Date.now();

    console.log(`[SUBSCRIPTION] userId=${canonicalId} status=${isStatusActive ? 'active' : rawSubStatus.toLowerCase()} expiresAt=${sub.expiryDate || 'N/A'}`);

    if (!isStatusActive) {
      console.error(`[SUBSCRIPTION] userId=${canonicalId} status=${rawSubStatus} (INACTIVE)`);
      throw new Error('SUBSCRIPTION_INACTIVE: Your subscription is not active. Please subscribe to start practice blocks.');
    }

    if (isExpired) {
      console.error(`[SUBSCRIPTION] userId=${canonicalId} status=EXPIRED expiresAt=${sub.expiryDate}`);
      throw new Error('SUBSCRIPTION_EXPIRED: Your subscription has expired. Please renew your subscription to access question blocks.');
    }
  }

  const filterWithUser = { ...filters, userId: filters.userId || canonicalId };
  const matchingQuestions = getFilteredQuestions(filterWithUser);
  if (matchingQuestions.length === 0) {
    throw new Error('No questions match the selected filter criteria.');
  }

  const targetCount = filters.questionCount && filters.questionCount > 0 ? filters.questionCount : 10;
  // Fisher-Yates shuffle algorithm to generate an independently randomized question sequence per session/user
  const shuffledQuestions = [...matchingQuestions];
  for (let i = shuffledQuestions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledQuestions[i], shuffledQuestions[j]] = [shuffledQuestions[j], shuffledQuestions[i]];
  }

  const selectedQuestionIds = shuffledQuestions.slice(0, targetCount).map((q) => q.id);

  const blockId = `block_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const now = new Date().toISOString();

  const newBlock: Block = {
    id: blockId,
    userId: canonicalId,
    bankId,
    bankName: MOH_BANK_META.name,
    questionIds: selectedQuestionIds,
    status: 'ACTIVE',
    currentIndex: 0,
    filters,
    answers: {},
    annotations: {},
    createdAt: now,
    updatedAt: now
  };

  const blocks = getStoredBlocks();
  blocks[blockId] = newBlock;
  saveStoredBlocks(blocks);

  // Background non-blocking sync to Supabase
  syncBlockToSupabase(newBlock).catch(() => {});

  return newBlock;
};

export const getBlock = (blockId: string): Block | null => {
  const blocks = getStoredBlocks();
  return blocks[blockId] || null;
};

export const getAllStoredBlocks = (): Block[] => {
  return Object.values(getStoredBlocks());
};

export const getActiveBlockForUser = (userId: string, bankId: string = BANK_ID): Block | null => {
  const blocks = getStoredBlocks();
  const activeBlock = Object.values(blocks).find(
    (b) => b.userId === userId && b.bankId === bankId && (b.status === 'ACTIVE' || b.status === 'SAVED')
  );
  
  return activeBlock || null;
};

export const saveAnswer = (blockId: string, questionId: string, selectedAnswer: OptionKey): Block => {
  const blocks = getStoredBlocks();
  const block = blocks[blockId];
  if (!block) throw new Error('Block not found');

  const question = getQuestionById(questionId);
  if (!question) throw new Error('Question not found');

  const isCorrect = question.correctAnswer === selectedAnswer;

  block.answers[questionId] = {
    questionId,
    selectedAnswer,
    isCorrect,
    answeredAt: new Date().toISOString()
  };
  block.updatedAt = new Date().toISOString();

  blocks[blockId] = block;
  saveStoredBlocks(blocks);

  // Trigger background sync to Supabase question_progress table and blocks table
  syncQuestionProgressToSupabase(questionId, selectedAnswer, isCorrect).catch(() => {});
  syncBlockToSupabase(block).catch(() => {});

  return block;
};

export const updateBlockIndex = (blockId: string, index: number): Block => {
  const blocks = getStoredBlocks();
  const block = blocks[blockId];
  if (!block) throw new Error('Block not found');

  block.currentIndex = Math.max(0, Math.min(index, block.questionIds.length - 1));
  block.updatedAt = new Date().toISOString();

  blocks[blockId] = block;
  saveStoredBlocks(blocks);

  // Trigger background sync to Supabase
  syncBlockToSupabase(block).catch(() => {});

  return block;
};

export const saveAnnotation = (
  blockId: string,
  questionId: string,
  highlightData: HighlightRange[],
  struckOptions: OptionKey[]
): Block => {
  const blocks = getStoredBlocks();
  const block = blocks[blockId];
  if (!block) throw new Error('Block not found');

  block.annotations[questionId] = {
    highlightData,
    struckOptions
  };
  block.updatedAt = new Date().toISOString();

  blocks[blockId] = block;
  saveStoredBlocks(blocks);

  // Trigger background sync to Supabase
  syncBlockToSupabase(block).catch(() => {});

  return block;
};

export const endBlock = (blockId: string, action: 'save' | 'finish'): Block => {
  const blocks = getStoredBlocks();
  const block = blocks[blockId];
  if (!block) throw new Error('Block not found');

  const now = new Date().toISOString();
  if (action === 'save') {
    block.status = 'SAVED';
    block.updatedAt = now;
  } else if (action === 'finish') {
    block.status = 'COMPLETED';
    block.updatedAt = now;

    // Calculate score
    const totalCount = block.questionIds.length;
    const correctCount = Object.values(block.answers).filter((a) => a.isCorrect).length;
    block.score = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
  }

  blocks[blockId] = block;
  saveStoredBlocks(blocks);

  // Trigger background sync to Supabase
  syncBlockToSupabase(block).catch(() => {});

  return block;
};

export const getCompletedBlocksForUser = (userId: string, bankId: string = BANK_ID): Block[] => {
  const blocks = getStoredBlocks();
  return Object.values(blocks).filter(
    (b) => b.userId === userId && b.bankId === bankId && b.status === 'COMPLETED'
  );
};
