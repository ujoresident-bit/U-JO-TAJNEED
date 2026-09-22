import { Question, QuestionStats, QuestionBankMeta, AdminConfig } from '../types';

export const INITIAL_ADMIN_CONFIG: AdminConfig = {
  paymentPhoneNumber: '079 812 3456',
  paymentAccountName: 'Saif Al-Deen (U JO Resident)',
  subscriptionPrice: 25, // 25 JOD
  subscriptionDurationDays: 30,
  paymentInstructions: 'Transfer via Zain Cash or CliQ to the phone number above. Enter your Telegram username and optional transaction reference ID when submitting.'
};

export const MOH_BANK_META: QuestionBankMeta = {
  id: 'moh_bank',
  name: 'MOH Residency Question Bank',
  description: 'Jordanian Ministry of Health Residency Entrance & Board Exam Bank',
  totalQuestions: 0,
  yearsAvailable: [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
  majors: []
};

export const DEMO_QUESTIONS: Question[] = [];

export const DEMO_QUESTION_STATS: Record<string, QuestionStats> = {};
