import React, { useState } from 'react';
import {
  Search,
  Filter,
  Plus,
  Download,
  Eye,
  Edit3,
  Trash2,
  X,
  Save,
  CheckCircle2,
  AlertCircle,
  FileJson,
  BookOpen
} from 'lucide-react';
import { Question, OptionKey } from '../types';
import {
  getStoredQuestions,
  addSingleQuestion,
  updateSingleQuestion,
  deleteSingleQuestion,
  deleteAllQuestions,
  exportQuestionsJSON,
  migrateLocalQuestionsToSupabase,
  syncQuestionsWithSupabase
} from '../services/questionBankService';

interface AdminQuestionTableProps {
  adminUserId: string;
  onRefreshStats?: () => void;
}

export const AdminQuestionTable: React.FC<AdminQuestionTableProps> = ({
  adminUserId,
  onRefreshStats
}) => {
  const [questions, setQuestions] = useState<Question[]>(getStoredQuestions());

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedBank, setSelectedBank] = useState<string>('All');
  const [selectedYear, setSelectedYear] = useState<string>('All');
  const [selectedMajor, setSelectedMajor] = useState<string>('All');
  const [selectedClassification, setSelectedClassification] = useState<string>('All');

  // Modal States
  const [viewQuestion, setViewQuestion] = useState<Question | null>(null);
  const [editQuestion, setEditQuestion] = useState<Question | null>(null);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState<boolean>(false);
  const [isDeletingAll, setIsDeletingAll] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Add Question Form State
  const [newQ, setNewQ] = useState<Partial<Question>>({
    bankId: 'moh_bank',
    year: 2025,
    major: 'Internal Medicine',
    topic: 'Cardiology',
    difficulty: 'Medium',
    question: '',
    options: { A: '', B: '', C: '', D: '' },
    correctAnswer: 'A',
    explanation: ''
  });

  const reloadData = () => {
    const updated = getStoredQuestions();
    setQuestions(updated);
    if (onRefreshStats) onRefreshStats();
  };

  // Unique Majors list
  const availableMajors = Array.from(
    new Set(questions.map((q) => q.major || 'Unassigned'))
  ).sort();

  // Filter questions
  const filteredQuestions = questions.filter((q) => {
    if (searchQuery.trim()) {
      const sq = searchQuery.toLowerCase().trim();
      const matchText =
        q.id.toLowerCase().includes(sq) ||
        q.question.toLowerCase().includes(sq) ||
        (q.major && q.major.toLowerCase().includes(sq)) ||
        (q.topic && q.topic.toLowerCase().includes(sq));
      if (!matchText) return false;
    }

    if (selectedBank !== 'All' && q.bankId !== selectedBank) return false;
    if (selectedYear !== 'All' && q.year !== Number(selectedYear)) return false;
    if (selectedMajor !== 'All' && q.major !== selectedMajor) return false;
    if (selectedClassification !== 'All') {
      const status = q.classificationStatus || 'CLASSIFIED';
      if (status !== selectedClassification) return false;
    }

    return true;
  });

  const [isMigrating, setIsMigrating] = useState<boolean>(false);

  // Handle Add Question Submit
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);

    if (!newQ.question || !newQ.question.trim()) {
      setActionError('Question stem text is required.');
      return;
    }
    if (
      !newQ.options?.A ||
      !newQ.options?.B ||
      !newQ.options?.C ||
      !newQ.options?.D
    ) {
      setActionError('All four options (A, B, C, D) are required.');
      return;
    }

    const newId = `MOH-${newQ.year}-${Date.now().toString().slice(-4)}`;

    try {
      await addSingleQuestion(
        {
          id: newId,
          bankId: newQ.bankId || 'moh_bank',
          year: newQ.year || 2025,
          major: newQ.major || 'Internal Medicine',
          topic: newQ.topic || 'General',
          difficulty: newQ.difficulty || 'Medium',
          question: newQ.question.trim(),
          options: {
            A: newQ.options.A.trim(),
            B: newQ.options.B.trim(),
            C: newQ.options.C.trim(),
            D: newQ.options.D.trim()
          },
          correctAnswer: (newQ.correctAnswer || 'A') as OptionKey,
          explanation: newQ.explanation?.trim() || 'No explanation provided.'
        },
        adminUserId
      );

      setActionSuccess('Question created successfully in Supabase database.');
      setShowAddModal(false);
      setNewQ({
        bankId: 'moh_bank',
        year: 2025,
        major: 'Internal Medicine',
        topic: 'Cardiology',
        difficulty: 'Medium',
        question: '',
        options: { A: '', B: '', C: '', D: '' },
        correctAnswer: 'A',
        explanation: ''
      });
      reloadData();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: any) {
      setActionError(err.message || 'Failed to add question.');
    }
  };

  // Handle Edit Question Submit
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editQuestion) return;
    setActionError(null);

    try {
      await updateSingleQuestion(editQuestion, adminUserId);
      setActionSuccess(`Question ${editQuestion.id} updated successfully in Supabase.`);
      setEditQuestion(null);
      reloadData();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: any) {
      setActionError(err.message || 'Failed to update question.');
    }
  };

  // Handle Delete Question
  const handleDelete = async (id: string) => {
    try {
      await deleteSingleQuestion(id, adminUserId);
      setActionSuccess(`Question ${id} deleted from Supabase.`);
      setDeleteConfirmId(null);
      reloadData();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: any) {
      setActionError(err.message || 'Failed to delete question.');
    }
  };

  // Handle Migration from Local Storage to Supabase
  const handleMigrateToSupabase = async () => {
    setIsMigrating(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await migrateLocalQuestionsToSupabase(adminUserId);
      setActionSuccess(res.message);
      await syncQuestionsWithSupabase();
      reloadData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to sync questions to Supabase.');
    } finally {
      setIsMigrating(false);
    }
  };

  // Handle Export Questions JSON
  const handleExportJSON = () => {
    try {
      const jsonStr = exportQuestionsJSON({
        bankId: selectedBank,
        year: selectedYear !== 'All' ? Number(selectedYear) : undefined,
        major: selectedMajor,
        classificationStatus: selectedClassification
      });

      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `question_bank_export_${selectedYear}_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setActionError(err.message || 'Export failed.');
    }
  };

  // Handle Delete All Questions Confirm
  const handleDeleteAllConfirm = async () => {
    setIsDeletingAll(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const result = await deleteAllQuestions(adminUserId);
      setShowDeleteAllModal(false);
      setQuestions([]);
      if (onRefreshStats) onRefreshStats();
      setActionSuccess(result.message || 'تم حذف جميع الأسئلة بنجاح.');
    } catch (err: any) {
      console.error("Error deleting all questions:", err);
      setActionError(err.message || 'فشل حذف جميع الأسئلة.');
    } finally {
      setIsDeletingAll(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search & Actions Bar */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 shadow-lg">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by question text, ID, or keywords..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={() => setShowAddModal(true)}
              className="px-3.5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-extrabold flex items-center gap-1.5 transition-all shadow-md shadow-cyan-500/20"
            >
              <Plus className="w-4 h-4" />
              <span>Add Question</span>
            </button>

            <button
              onClick={handleMigrateToSupabase}
              disabled={isMigrating}
              className="px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-extrabold flex items-center gap-1.5 transition-all shadow-md shadow-emerald-600/20"
              title="Sync local browser questions to Supabase global database"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-200" />
              <span>{isMigrating ? 'Syncing...' : 'Sync Local to Supabase'}</span>
            </button>

            <button
              onClick={handleExportJSON}
              className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 transition-all"
              title="Export filtered questions as JSON"
            >
              <Download className="w-4 h-4 text-cyan-400" />
              <span>Export JSON</span>
            </button>

            <button
              onClick={() => {
                setActionError(null);
                setActionSuccess(null);
                setShowDeleteAllModal(true);
              }}
              className="px-3.5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-extrabold flex items-center gap-1.5 transition-all shadow-md shadow-rose-600/20"
              title="حذف جميع الأسئلة من بنك الأسئلة"
            >
              <Trash2 className="w-4 h-4" />
              <span>حذف جميع الأسئلة</span>
            </button>
          </div>
        </div>

        {/* Filters Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1">
          <div>
            <label className="text-[10px] text-slate-400 font-semibold uppercase block mb-1">
              Bank
            </label>
            <select
              value={selectedBank}
              onChange={(e) => setSelectedBank(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none"
            >
              <option value="All">All Banks</option>
              <option value="moh_bank">MOH Bank</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] text-slate-400 font-semibold uppercase block mb-1">
              Exam Year
            </label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none"
            >
              <option value="All">All Years (2015-2025)</option>
              {Array.from({ length: 11 }, (_, i) => 2015 + i).map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] text-slate-400 font-semibold uppercase block mb-1">
              Major
            </label>
            <select
              value={selectedMajor}
              onChange={(e) => setSelectedMajor(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none"
            >
              <option value="All">All Majors</option>
              {availableMajors.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] text-slate-400 font-semibold uppercase block mb-1">
              Status
            </label>
            <select
              value={selectedClassification}
              onChange={(e) => setSelectedClassification(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none"
            >
              <option value="All">All Statuses</option>
              <option value="CLASSIFIED">Classified</option>
              <option value="NEEDS_REVIEW">Needs Review</option>
            </select>
          </div>
        </div>
      </div>

      {actionSuccess && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {actionError && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-bold flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Questions Data Table */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 font-bold uppercase text-[10px] border-b border-slate-800">
              <tr>
                <th className="p-3.5">ID</th>
                <th className="p-3.5">Year</th>
                <th className="p-3.5">Major / Topic</th>
                <th className="p-3.5">Question Stem</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-200">
              {filteredQuestions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-slate-500">
                    No questions matching filter criteria.
                  </td>
                </tr>
              ) : (
                filteredQuestions.map((q) => (
                  <tr key={q.id} className="hover:bg-slate-950/40 transition-colors">
                    <td className="p-3.5 font-mono font-bold text-cyan-400 shrink-0 whitespace-nowrap">
                      {q.id}
                    </td>
                    <td className="p-3.5 font-medium whitespace-nowrap">{q.year}</td>
                    <td className="p-3.5 whitespace-nowrap">
                      <div className="font-semibold text-slate-100">{q.major}</div>
                      <div className="text-[10px] text-slate-400">{q.topic}</div>
                    </td>
                    <td className="p-3.5 max-w-xs truncate text-slate-300">{q.question}</td>
                    <td className="p-3.5 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                          q.classificationStatus === 'NEEDS_REVIEW'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        }`}
                      >
                        {q.classificationStatus || 'CLASSIFIED'}
                      </span>
                    </td>
                    <td className="p-3.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => setViewQuestion(q)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                          title="View Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setEditQuestion({ ...q })}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 transition-colors"
                          title="Edit Question"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(q.id)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-rose-400 transition-colors"
                          title="Delete Question"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="text-sm font-bold text-slate-100">Confirm Question Deletion</h3>
            <p className="text-xs text-slate-400">
              Are you sure you want to permanently delete question{' '}
              <strong className="text-cyan-400">{deleteConfirmId}</strong>?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-slate-950 text-xs font-bold"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewQuestion && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto space-y-4 shadow-2xl text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-cyan-400 font-bold text-sm">
                  {viewQuestion.id}
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  {viewQuestion.year}
                </span>
              </div>
              <button
                onClick={() => setViewQuestion(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <span className="text-slate-400 font-semibold block mb-1">Question Stem:</span>
                <div className="p-3 rounded-xl bg-slate-950 text-slate-100 leading-relaxed font-medium">
                  {viewQuestion.question}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-slate-400 font-semibold block">Answer Options:</span>
                {(['A', 'B', 'C', 'D'] as OptionKey[]).map((k) => (
                  <div
                    key={k}
                    className={`p-2.5 rounded-xl border flex items-center gap-2 ${
                      k === viewQuestion.correctAnswer
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200 font-bold'
                        : 'bg-slate-950 border-slate-800 text-slate-300'
                    }`}
                  >
                    <span className="w-6 h-6 rounded-lg bg-slate-800 flex items-center justify-center font-bold">
                      {k}
                    </span>
                    <span>{viewQuestion.options[k]}</span>
                  </div>
                ))}
              </div>

              <div>
                <span className="text-slate-400 font-semibold block mb-1">Explanation:</span>
                <div className="p-3 rounded-xl bg-slate-950 text-slate-300 leading-relaxed">
                  {viewQuestion.explanation}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Question Modal */}
      {editQuestion && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleEditSubmit}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto space-y-4 shadow-2xl text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-slate-100 text-sm">Edit Question {editQuestion.id}</h3>
              <button
                type="button"
                onClick={() => setEditQuestion(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="font-semibold text-slate-300 block mb-1">Year</label>
                <input
                  type="number"
                  value={editQuestion.year}
                  onChange={(e) => setEditQuestion({ ...editQuestion, year: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-300 block mb-1">Major</label>
                <input
                  type="text"
                  value={editQuestion.major}
                  onChange={(e) => setEditQuestion({ ...editQuestion, major: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-300 block mb-1">Topic</label>
                <input
                  type="text"
                  value={editQuestion.topic}
                  onChange={(e) => setEditQuestion({ ...editQuestion, topic: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-300 block mb-1">Question Stem</label>
              <textarea
                rows={3}
                value={editQuestion.question}
                onChange={(e) => setEditQuestion({ ...editQuestion, question: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
              />
            </div>

            <div className="space-y-2">
              <label className="font-semibold text-slate-300 block">Options A – D</label>
              {(['A', 'B', 'C', 'D'] as OptionKey[]).map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-slate-800 flex items-center justify-center font-bold shrink-0">
                    {k}
                  </span>
                  <input
                    type="text"
                    value={editQuestion.options[k]}
                    onChange={(e) =>
                      setEditQuestion({
                        ...editQuestion,
                        options: { ...editQuestion.options, [k]: e.target.value }
                      })
                    }
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-semibold text-slate-300 block mb-1">Correct Answer</label>
                <select
                  value={editQuestion.correctAnswer}
                  onChange={(e) =>
                    setEditQuestion({ ...editQuestion, correctAnswer: e.target.value as OptionKey })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
                >
                  <option value="A">Option A</option>
                  <option value="B">Option B</option>
                  <option value="C">Option C</option>
                  <option value="D">Option D</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-300 block mb-1">Difficulty</label>
                <select
                  value={editQuestion.difficulty}
                  onChange={(e) =>
                    setEditQuestion({ ...editQuestion, difficulty: e.target.value as any })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
                >
                  <option value="Easy">Easy</option>
                  <option value="Medium">Medium</option>
                  <option value="Hard">Hard</option>
                </select>
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-300 block mb-1">Explanation</label>
              <textarea
                rows={3}
                value={editQuestion.explanation}
                onChange={(e) => setEditQuestion({ ...editQuestion, explanation: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setEditQuestion(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-extrabold flex items-center gap-1.5"
              >
                <Save className="w-4 h-4" />
                <span>Save Changes</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Single Question Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateSubmit}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto space-y-4 shadow-2xl text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
                <Plus className="w-4 h-4 text-cyan-400" />
                <span>Add Single Question</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="font-semibold text-slate-300 block mb-1">Year</label>
                <input
                  type="number"
                  value={newQ.year}
                  onChange={(e) => setNewQ({ ...newQ, year: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-300 block mb-1">Major</label>
                <input
                  type="text"
                  value={newQ.major}
                  onChange={(e) => setNewQ({ ...newQ, major: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-300 block mb-1">Topic</label>
                <input
                  type="text"
                  value={newQ.topic}
                  onChange={(e) => setNewQ({ ...newQ, topic: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-300 block mb-1">Question Stem</label>
              <textarea
                rows={3}
                value={newQ.question}
                onChange={(e) => setNewQ({ ...newQ, question: e.target.value })}
                placeholder="Enter clinical vignette / question stem..."
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
              />
            </div>

            <div className="space-y-2">
              <label className="font-semibold text-slate-300 block">Options A – D</label>
              {(['A', 'B', 'C', 'D'] as OptionKey[]).map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-slate-800 flex items-center justify-center font-bold shrink-0">
                    {k}
                  </span>
                  <input
                    type="text"
                    value={newQ.options?.[k]}
                    onChange={(e) =>
                      setNewQ({
                        ...newQ,
                        options: { ...newQ.options, [k]: e.target.value } as any
                      })
                    }
                    placeholder={`Option ${k}...`}
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-semibold text-slate-300 block mb-1">Correct Answer</label>
                <select
                  value={newQ.correctAnswer}
                  onChange={(e) =>
                    setNewQ({ ...newQ, correctAnswer: e.target.value as OptionKey })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
                >
                  <option value="A">Option A</option>
                  <option value="B">Option B</option>
                  <option value="C">Option C</option>
                  <option value="D">Option D</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-300 block mb-1">Difficulty</label>
                <select
                  value={newQ.difficulty}
                  onChange={(e) =>
                    setNewQ({ ...newQ, difficulty: e.target.value as any })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
                >
                  <option value="Easy">Easy</option>
                  <option value="Medium">Medium</option>
                  <option value="Hard">Hard</option>
                </select>
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-300 block mb-1">Explanation</label>
              <textarea
                rows={3}
                value={newQ.explanation}
                onChange={(e) => setNewQ({ ...newQ, explanation: e.target.value })}
                placeholder="High-yield teaching explanation..."
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-extrabold flex items-center gap-1.5"
              >
                <Save className="w-4 h-4" />
                <span>Save Question</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirmation Modal for Delete All Questions */}
      {showDeleteAllModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-500/30 rounded-2xl p-6 max-w-md w-full space-y-5 shadow-2xl animate-in fade-in zoom-in duration-150">
            <div className="flex items-center gap-3 text-rose-500 pb-3 border-b border-slate-800">
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 shrink-0">
                <AlertCircle className="w-6 h-6 text-rose-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">تأكيد حذف جميع الأسئلة</h3>
                <p className="text-xs text-rose-400 font-medium">إجراء حساس ودائم</p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/40 text-slate-200 text-xs leading-relaxed space-y-2">
              <p className="font-bold text-rose-200 text-sm">
                هل أنت متأكد؟ سيتم حذف جميع الأسئلة نهائيًا ولا يمكن التراجع عن هذا الإجراء.
              </p>
              <p className="text-[11px] text-slate-400">
                سيتم مسح جميع الأسئلة من بنك الأسئلة بالكامل. لن تتأثر حسابات المستخدمين، الاشتراكات، المدفوعات، أو إثباتات الدفع.
              </p>
            </div>

            {actionError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{actionError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={isDeletingAll}
                onClick={() => {
                  setShowDeleteAllModal(false);
                  setActionError(null);
                }}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-all disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isDeletingAll}
                onClick={handleDeleteAllConfirm}
                className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-extrabold transition-all shadow-lg shadow-rose-600/30 flex items-center gap-2 disabled:opacity-50"
              >
                {isDeletingAll ? (
                  <span>جاري الحذف...</span>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>تأكيد الحذف النهائي</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
