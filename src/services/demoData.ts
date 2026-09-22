import { Question, QuestionStats, QuestionBankMeta, AdminConfig } from '../types';

export const INITIAL_ADMIN_CONFIG: AdminConfig = {
  paymentPhoneNumber: '0798813251',
  paymentAccountName: 'U JO TAJNEED',
  subscriptionPrice: 25, // 25 JOD — per-bank pricing lives in Supabase's bank_pricing table
  subscriptionDurationDays: 30,
  paymentInstructions: 'Transfer via Zain Cash or CliQ to the phone number above. Enter your Telegram username and optional transaction reference ID when submitting.'
};

export const MOH_BANK_META: QuestionBankMeta = {
  id: 'human_medicine',
  name: 'U JO TAJNEED — Human Medicine',
  description: 'Human Medicine practice question bank for the Medical Services recruitment exam',
  totalQuestions: 0,
  yearsAvailable: [],
  majors: []
};

export const USMLE_BANK_META: QuestionBankMeta = {
  id: 'dentistry',
  name: 'U JO TAJNEED — Dentistry',
  description: 'Dentistry practice question bank for the Medical Services recruitment exam',
  totalQuestions: 0,
  yearsAvailable: [],
  majors: []
};

export const DEMO_QUESTIONS: Question[] = [];

export const DEMO_QUESTION_STATS: Record<string, QuestionStats> = {};
