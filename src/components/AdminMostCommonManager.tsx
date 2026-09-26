import React, { useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  Plus,
  Trash2,
  Save,
  X,
  CheckCircle2,
  ListPlus,
  AlertTriangle
} from 'lucide-react';
import {
  getStoredQuestions,
  syncQuestionsWithSupabase,
  addSingleQuestion,
  deleteSingleQuestion,
  parseTextQuestions
} from '../services/questionBankService';
import { Question, OptionKey } from '../types';
import { getCurrentUser } from '../services/authService';

const EMPTY_FORM = {
  bankId: 'human_medicine',
  question: '',
  optionA: '',
  optionB: '',
  optionC: '',
  optionD: '',
  optionE: '',
  correctAnswer: 'A' as OptionKey,
  explanation: ''
};

// Dedicated, standalone "Most Common" management page — structured just
// like AdminFlashcardsManager (Single / Bulk toggle), but for full
// question objects instead of simple Q&A pairs, reusing the exact same
// text-parsing format the main Import Wizard understands for bulk mode.
export const AdminMostCommonManager: React.FC = () => {
  const [questions, setQuestions] = useState<Question[]>(() =>
    getStoredQuestions().filter((q) => q.isMostCommon)
  );
  const [bankFilter, setBankFilter] = useState<string>('human_medicine');
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [form, setForm] = useState(EMPTY_FORM);
  const [bulkText, setBulkText] = useState('');
  const [bulkBank, setBulkBank] = useState<string>('human_medicine');
  const [saving, setSaving] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const user = getCurrentUser();

  const refreshList = () => {
    setQuestions(getStoredQuestions().filter((q) => q.isMostCommon));
    syncQuestionsWithSupabase().then((synced) => {
      if (synced && Array.isArray(synced)) {
        setQuestions(synced.filter((q) => q.isMostCommon));
      }
    }).catch(() => {});
  };

  useEffect(() => {
    refreshList();
  }, []);

  const filteredQuestions = questions.filter((q) => q.bankId === bankFilter);

  const buildQuestionObject = (bankId: string, data: typeof EMPTY_FORM): Omit<Question, 'createdAt' | 'updatedAt'> => {
    const options: any = { A: data.optionA.trim(), B: data.optionB.trim() };
    if (data.optionC.trim()) options.C = data.optionC.trim();
    if (data.optionD.trim()) options.D = data.optionD.trim();
    if (data.optionE.trim()) options.E = data.optionE.trim();

    return {
      id: `mc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      bankId,
      question: data.question.trim(),
      options,
      correctAnswer: data.correctAnswer,
      explanation: data.explanation.trim() || 'No explanation provided.',
      major: 'Most Common',
      topic: 'Most Common',
      year: 'MOST_COMMON',
      difficulty: 'Medium',
      isMostCommon: true,
      needsReview: false,
      classificationStatus: 'CLASSIFIED'
    };
  };

  const handleSingleSave = async () => {
    if (!form.question.trim() || !form.optionA.trim() || !form.optionB.trim()) {
      setError('Question, Option A, and Option B are required.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await addSingleQuestion(buildQuestionObject(form.bankId, form), user.telegramId);
      setForm({ ...EMPTY_FORM, bankId: form.bankId });
      setSuccessMsg('Most Common question added successfully.');
      refreshList();
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save question.');
    } finally {
      setSaving(false);
    }
  };

  const parsedBulkQuestions = useMemo(() => parseTextQuestions(bulkText), [bulkText]);

  const handleBulkSave = async () => {
    if (parsedBulkQuestions.length === 0) {
      setError('No valid questions found. Check the format below.');
      return;
    }
    setError(null);
    setBulkSaving(true);
    try {
      for (const parsed of parsedBulkQuestions) {
        const q = buildQuestionObject(bulkBank, {
          ...EMPTY_FORM,
          question: parsed.question,
          optionA: parsed.options.A || '',
          optionB: parsed.options.B || '',
          optionC: parsed.options.C || '',
          optionD: parsed.options.D || '',
          optionE: parsed.options.E || '',
          correctAnswer: parsed.correctAnswer,
          explanation: parsed.explanation || ''
        });
        await addSingleQuestion(q, user.telegramId);
      }
      setBulkText('');
      setSuccessMsg(`${parsedBulkQuestions.length} Most Common question${parsedBulkQuestions.length !== 1 ? 's' : ''} added successfully.`);
      refreshList();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to save one or more questions.');
    } finally {
      setBulkSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this question from Most Common? This deletes the question entirely.')) return;
    try {
      await deleteSingleQuestion(id, user.telegramId);
      refreshList();
    } catch (err: any) {
      alert(err.message || 'Failed to delete question.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Create Form Card */}
      <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-100">
              {mode === 'bulk' ? 'Bulk Add Most Common' : 'Add Most Common Question'}
            </h3>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-950 border border-slate-800">
            <button
              type="button"
              onClick={() => setMode('single')}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                mode === 'single' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Single
            </button>
            <button
              type="button"
              onClick={() => setMode('bulk')}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 ${
                mode === 'bulk' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ListPlus className="w-3.5 h-3.5" />
              <span>Bulk</span>
            </button>
          </div>
        </div>

        {successMsg && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {mode === 'single' ? (
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Bank</label>
              <select
                value={form.bankId}
                onChange={(e) => setForm({ ...form, bankId: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100"
              >
                <option value="human_medicine">Human Medicine</option>
                <option value="dentistry">Dentistry</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Question *</label>
              <textarea
                rows={2}
                value={form.question}
                onChange={(e) => setForm({ ...form, question: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Option A *</label>
                <input value={form.optionA} onChange={(e) => setForm({ ...form, optionA: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100" />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Option B *</label>
                <input value={form.optionB} onChange={(e) => setForm({ ...form, optionB: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100" />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Option C (optional)</label>
                <input value={form.optionC} onChange={(e) => setForm({ ...form, optionC: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100" />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Option D (optional)</label>
                <input value={form.optionD} onChange={(e) => setForm({ ...form, optionD: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100" />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Option E (optional)</label>
                <input value={form.optionE} onChange={(e) => setForm({ ...form, optionE: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100" />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Correct Answer *</label>
                <select
                  value={form.correctAnswer}
                  onChange={(e) => setForm({ ...form, correctAnswer: e.target.value as OptionKey })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100"
                >
                  {(['A', 'B', 'C', 'D', 'E'] as OptionKey[])
                    .filter((k) => k === 'A' || k === 'B' || (form as any)[`option${k}`])
                    .map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Explanation (optional)</label>
              <textarea
                rows={2}
                value={form.explanation}
                onChange={(e) => setForm({ ...form, explanation: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100"
              />
            </div>

            <div className="flex justify-end pt-1">
              <button
                onClick={handleSingleSave}
                disabled={saving}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold flex items-center gap-2 transition-all shadow-md shadow-amber-500/20 disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>{saving ? 'Saving...' : 'Save Question'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Bank (applies to entire batch)</label>
              <select
                value={bulkBank}
                onChange={(e) => setBulkBank(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100"
              >
                <option value="human_medicine">Human Medicine</option>
                <option value="dentistry">Dentistry</option>
              </select>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 leading-relaxed">
              Paste multiple questions using this format:
              <pre className="mt-2 p-2.5 rounded-lg bg-black/40 text-slate-300 text-[11px] whitespace-pre-wrap font-mono">{`Q: What is the first-line treatment for anaphylaxis?
A: Intramuscular epinephrine
B: Oral antihistamine
C: IV corticosteroids
Answer: A
Explanation: Epinephrine IM is the first-line treatment.

Q: What nerve innervates the diaphragm?
A: Vagus nerve
B: Phrenic nerve
Answer: B
Explanation: The phrenic nerve (C3-C5) innervates the diaphragm.`}</pre>
            </div>

            <textarea
              rows={12}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder="Paste your Q: / A: / B: / Answer: / Explanation: formatted questions here..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 font-mono text-[11px]"
            />

            <div className="flex items-center justify-between pt-1">
              <span className="text-slate-500">
                {parsedBulkQuestions.length > 0
                  ? `${parsedBulkQuestions.length} question${parsedBulkQuestions.length !== 1 ? 's' : ''} detected`
                  : 'No questions detected yet'}
              </span>
              <button
                onClick={handleBulkSave}
                disabled={bulkSaving || parsedBulkQuestions.length === 0}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold flex items-center gap-2 transition-all shadow-md shadow-amber-500/20 disabled:opacity-40"
              >
                <ListPlus className="w-4 h-4" />
                <span>{bulkSaving ? 'Saving...' : `Save ${parsedBulkQuestions.length || ''} Questions`}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Existing Most Common Questions */}
      <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 flex-wrap gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-100 flex items-center gap-2">
            <span>Existing Most Common Questions</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs font-semibold">
              {filteredQuestions.length}
            </span>
          </h3>
          <select
            value={bankFilter}
            onChange={(e) => setBankFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-xs"
          >
            <option value="human_medicine">Human Medicine</option>
            <option value="dentistry">Dentistry</option>
          </select>
        </div>

        {filteredQuestions.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500">
            No Most Common questions for this bank yet.
          </div>
        ) : (
          <div className="space-y-2">
            {filteredQuestions.map((q) => (
              <div key={q.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-100 line-clamp-2">{q.question}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">Correct: {q.correctAnswer}</p>
                </div>
                <button
                  onClick={() => handleDelete(q.id)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-rose-400 hover:text-rose-300 transition-colors shrink-0"
                  title="Remove"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
