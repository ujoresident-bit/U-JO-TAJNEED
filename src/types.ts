export type OptionKey = 'A' | 'B' | 'C' | 'D' | 'E';

export interface QuestionOptions {
  A: string;
  B: string;
  // C, D, and E are now optional — some valid exam questions (True/False,
  // 3-option questions) legitimately have fewer than 4 choices. Every
  // screen (exam, explanation, admin edit) already renders only the
  // options actually present on a given question via `.filter(Boolean(...))`,
  // never a hardcoded expectation of exactly 4.
  C?: string;
  D?: string;
  E?: string;
}

export interface OptionExplanations {
  A?: string;
  B?: string;
  C?: string;
  D?: string;
  E?: string;
}

export interface EvidenceSource {
  title: string;
  url: string;
  snippet?: string;
  retrievedAt?: string;
}

export interface Question {
  id: string;
  bankId: string;
  question: string; // stem
  options: QuestionOptions;
  correctAnswer: OptionKey;
  explanation: string;
  optionExplanations?: OptionExplanations;
  evidenceSources?: EvidenceSource[];
  groundingQueries?: string[];
  needsReview?: boolean;
  reviewNote?: string;
  isMostCommon?: boolean;
  major: string;
  topic: string;
  subtopic?: string;
  year: number | string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  classificationStatus?: 'CLASSIFIED' | 'NEEDS_REVIEW';
  createdAt?: string;
  updatedAt?: string;
}

export interface ImportBatch {
  id: string;
  bankId: string;
  year: number | string;
  adminId: string;
  status: 'COMPLETED' | 'CANCELLED';
  totalQuestions: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  needsReviewCount: number;
  createdAt: string;
  fileName?: string;
}

export interface InvalidQuestionError {
  id?: string;
  index: number;
  questionTextSample: string;
  reasons: string[];
}

export interface ImportPreviewResult {
  bankId: string;
  year: number | string;
  fileName: string;
  totalInFile: number;
  validQuestions: Question[];
  invalidQuestions: InvalidQuestionError[];
  duplicateQuestions: Question[];
  needsReviewCount: number;
  explanationsCompletedCount?: number;
  yearMismatchWarning?: string;
}

export interface QuestionStats {
  questionId: string;
  distribution: Record<OptionKey, number>; // e.g. { A: 12, B: 74, C: 9, D: 5 }
  totalAttempts: number;
}

export type BlockStatus = 'ACTIVE' | 'SAVED' | 'COMPLETED';

export type QuestionStatusFilter = 'ALL' | 'COMPLETE' | 'UNCOMPLETED' | 'UNUSED';

export interface BlockFilters {
  major?: string;
  topic?: string;
  majors?: string[];
  topics?: string[];
  years?: (number | string)[];
  difficulty?: string;
  questionCount?: number;
  statusFilter?: QuestionStatusFilter;
  userId?: string;
  bankId?: string;
  includeQBankBasic?: boolean;
}

export interface BlockAnswer {
  questionId: string;
  selectedAnswer: OptionKey;
  isCorrect: boolean;
  answeredAt: string;
}

export interface HighlightRange {
  id: string;
  text: string;
}

export interface BlockAnnotation {
  highlightData: HighlightRange[];
  struckOptions: OptionKey[];
}

export interface Block {
  id: string;
  userId: string;
  bankId: string;
  bankName: string;
  questionIds: string[];
  status: BlockStatus;
  currentIndex: number;
  filters: BlockFilters;
  answers: Record<string, BlockAnswer>; // questionId -> answer
  annotations: Record<string, BlockAnnotation>; // questionId -> annotation
  createdAt: string;
  updatedAt: string;
  score?: number; // 0-100
  timeSpentSeconds?: number;
}

export type Role = 'user' | 'admin';

export type ResolvedRole = 'ADMIN' | 'USER';
export type ResolvedSubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'NONE' | 'PENDING';

export interface ResolvedSession {
  user: User;
  role: ResolvedRole;
  subscriptionStatus: ResolvedSubscriptionStatus;
  isAdmin: boolean;
  isSubscribed: boolean;
}

export interface User {
  telegramId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  role: Role;
  isActive?: boolean;
  firstSeenAt: string;
  lastActiveAt: string;
}

export type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'PENDING' | 'INACTIVE' | 'APPROVED';

export interface Subscription {
  userId: string;
  bankId: string;
  status: SubscriptionStatus;
  plan: string; // e.g., "MOH Monthly Pass"
  startDate?: string;
  expiryDate?: string;
  activatedByAdminId?: string;
  activatedAt?: string;
}

export type PaymentRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface PaymentRequest {
  id: string;
  userId: string;
  amount: number;
  paymentMethod: 'Zain Cash' | 'CliQ';
  referenceNumber?: string;
  proofFileId?: string;
  proofFileUrl?: string;
  telegramUsername: string;
  status: PaymentRequestStatus;
  createdAt: string;
  reviewedByAdminId?: string;
  reviewedAt?: string;
}

export interface AdminConfig {
  paymentPhoneNumber: string;
  paymentAccountName: string;
  subscriptionPrice: number;
  subscriptionDurationDays: number;
  paymentInstructions: string;
}

export interface AdminMetrics {
  totalUsers: number;
  activeSubscribers: number;
  expiredSubscribers: number;
  pendingPaymentRequests: number;
  questionsSolved: number;
  activeBlocks: number;
  recentlyActiveUsers: number;
}

export interface UserStudyStats {
  totalQuestionsSolved: number;
  totalCorrect: number;
  totalIncorrect: number;
  accuracyPercentage: number;
  blocksCompleted: number;
  activeBlocksCount: number;
  lastQuestionDate?: string;
  lastActivityDate?: string;
}

export interface Flashcard {
  id: string;
  question: string;
  answer: string;
  front?: string;
  back?: string;
  questionId?: string | null;
  major?: string | null;
  topic?: string | null;
  isCustom?: boolean;
  // Distinguishes a normal flip-card from a "Most Common" card, which is
  // stored identically but displayed with a fill-in-the-blank reveal style
  // instead of a flip animation. Defaults to 'flashcard' when absent.
  cardType?: 'flashcard' | 'most_common';
  easeFactor?: number;
  interval?: number;
  repetitions?: number;
  nextReviewDate?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface QuestionBankMeta {
  id: string;
  name: string;
  description: string;
  totalQuestions: number;
  majors: {
    name: string;
    questionCount: number;
    topics: { name: string; questionCount: number }[];
  }[];
  yearsAvailable: (number | string)[];
}
