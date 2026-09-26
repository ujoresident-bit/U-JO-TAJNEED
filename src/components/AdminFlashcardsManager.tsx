import React, { useState, useEffect } from 'react';
import {
  Layers,
  Plus,
  Trash2,
  Edit2,
  Save,
  X,
  CheckCircle2,
  HelpCircle,
  ListPlus,
  AlertTriangle
} from 'lucide-react';
import {
  getFlashcards,
  saveFlashcard,
  deleteFlashcard,
  syncFlashcardsFromSupabase
} from '../services/flashcardService';
import { Flashcard } from '../types';

export const AdminFlashcardsManager: React.FC = () => {
  const [flashcards, setFlashcards] = useState<Flashcard[]>(getFlashcards());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [question, setQuestion] = useState<string>('');
  const [answer, setAnswer] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Bulk-add mode: paste many "Q: ... / A: ..." blocks separated by a
  // line containing just "---", parse them client-side, preview the
  // count, then save them all in sequence via the exact same
  // saveFlashcard() call the single-add form already uses.
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [bulkText, setBulkText] = useState<string>('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const refreshList = () => {
    setFlashcards(getFlashcards());
    syncFlashcardsFromSupabase().then((synced) => {
      if (synced && Array.isArray(synced)) {
        setFlashcards(synced);
      }
    }).catch(() => {});
  };

  useEffect(() => {
    refreshList();
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || !answer.trim()) return;

    saveFlashcard({
      id: editingId || undefined,
      question: question.trim(),
      answer: answer.trim()
    });

    setQuestion('');
    setAnswer('');
    setEditingId(null);
    setSuccessMsg(editingId ? 'Flashcard updated successfully.' : 'Flashcard created successfully.');
    refreshList();

    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const parseBulkCards = (text: string): { question: string; answer: string }[] => {
    const blocks = text.split(/^---$/m).map((b) => b.trim()).filter(Boolean);
    const cards: { question: string; answer: string }[] = [];

    for (const block of blocks) {
      const qMatch = block.match(/Q:\s*([\s\S]*?)(?=\nA:|$)/i);
      const aMatch = block.match(/A:\s*([\s\S]*)/i);
      const q = qMatch ? qMatch[1].trim() : '';
      const a = aMatch ? aMatch[1].trim() : '';
      if (q && a) {
        cards.push({ question: q, answer: a });
      }
    }
    return cards;
  };

  const bulkPreviewCount = parseBulkCards(bulkText).length;

  const handleBulkSave = async () => {
    const cards = parseBulkCards(bulkText);
    if (cards.length === 0) {
      setBulkError('No valid "Q: ... / A: ..." blocks found. Check the format below.');
      return;
    }
    setBulkError(null);
    setBulkSaving(true);
    try {
      for (const card of cards) {
        await saveFlashcard({ question: card.question, answer: card.answer });
      }
      setBulkText('');
      setSuccessMsg(`${cards.length} flashcard${cards.length !== 1 ? 's' : ''} created successfully.`);
      refreshList();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setBulkError(err.message || 'Failed to save one or more flashcards.');
    } finally {
      setBulkSaving(false);
    }
  };

  const handleEdit = (card: Flashcard) => {
    setMode('single');
    setEditingId(card.id);
    setQuestion(card.question);
    setAnswer(card.answer);
  };

  const handleCancel = () => {
    setEditingId(null);
    setQuestion('');
    setAnswer('');
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this flashcard?')) {
      deleteFlashcard(id);
      if (editingId === id) handleCancel();
      refreshList();
    }
  };

  return (
    <div className="space-y-6">
      {/* Create / Edit Form Card */}
      <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-cyan-500/10 text-[#00F2FF]">
              <Layers className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-100">
              {editingId ? 'Edit Flashcard' : mode === 'bulk' ? 'Bulk Add Flashcards' : 'Create New Flashcard'}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {!editingId && (
              <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-950 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setMode('single')}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                    mode === 'single' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Single
                </button>
                <button
                  type="button"
                  onClick={() => setMode('bulk')}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 ${
                    mode === 'bulk' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ListPlus className="w-3.5 h-3.5" />
                  <span>Bulk</span>
                </button>
              </div>
            )}
            {editingId && (
              <button
                type="button"
                onClick={handleCancel}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1 transition-all"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancel Edit</span>
              </button>
            )}
          </div>
        </div>

        {successMsg && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {mode === 'single' || editingId ? (
          <form onSubmit={handleSave} className="space-y-4 text-xs">
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-300 flex items-center gap-1.5">
                <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
                <span>Question (Front of Card)</span>
              </label>
              <textarea
                required
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g., What is the first-line treatment for acute anaphylactic shock?"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors leading-relaxed"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-300 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Answer (Back of Card)</span>
              </label>
              <textarea
                required
                rows={3}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="e.g., Intramuscular Epinephrine (1:1000 dilution, 0.3-0.5 mg in adults) into the anterolateral thigh."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors leading-relaxed"
              />
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-extrabold text-xs flex items-center gap-2 transition-all shadow-md shadow-cyan-500/20 cursor-pointer"
              >
                {editingId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                <span>{editingId ? 'Update Flashcard' : 'Save Flashcard'}</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 leading-relaxed">
              Paste multiple cards using this format — separate each card with a line containing only <code className="text-cyan-400">---</code>:
              <pre className="mt-2 p-2.5 rounded-lg bg-black/40 text-slate-300 text-[11px] whitespace-pre-wrap font-mono">{`Q: What is the first-line treatment for anaphylaxis?
A: Intramuscular epinephrine (0.3-0.5 mg, 1:1000).
---
Q: What nerve innervates the diaphragm?
A: The phrenic nerve (C3-C5).`}</pre>
            </div>

            <textarea
              rows={12}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder="Paste your Q: / A: / --- formatted flashcards here..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors leading-relaxed font-mono text-[11px]"
            />

            {bulkError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{bulkError}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <span className="text-slate-500">
                {bulkPreviewCount > 0
                  ? `${bulkPreviewCount} card${bulkPreviewCount !== 1 ? 's' : ''} detected`
                  : 'No cards detected yet'}
              </span>
              <button
                type="button"
                onClick={handleBulkSave}
                disabled={bulkSaving || bulkPreviewCount === 0}
                className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-extrabold flex items-center gap-2 transition-all shadow-md shadow-cyan-500/20 disabled:opacity-40"
              >
                <ListPlus className="w-4 h-4" />
                <span>{bulkSaving ? 'Saving...' : `Save ${bulkPreviewCount || ''} Flashcards`}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Flashcards List */}
      <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-100 flex items-center gap-2">
            <span>Existing Flashcards</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs font-semibold">
              {flashcards.length}
            </span>
          </h3>
        </div>

        {flashcards.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500">
            No flashcards created yet. Use the form above to add your first card.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] font-bold border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3 w-5/12">Question</th>
                  <th className="px-4 py-3 w-5/12">Answer</th>
                  <th className="px-4 py-3 w-2/12 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {flashcards.map((card) => (
                  <tr
                    key={card.id}
                    className={`hover:bg-slate-800/40 transition-colors ${
                      editingId === card.id ? 'bg-cyan-500/10' : ''
                    }`}
                  >
                    <td className="px-4 py-3.5 align-top font-medium text-slate-100 max-w-xs leading-relaxed">
                      {card.question}
                    </td>
                    <td className="px-4 py-3.5 align-top text-slate-300 max-w-xs leading-relaxed">
                      {card.answer}
                    </td>
                    <td className="px-4 py-3.5 align-top text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleEdit(card)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 transition-colors"
                          title="Edit Flashcard"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(card.id)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-rose-400 hover:text-rose-300 transition-colors"
                          title="Delete Flashcard"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
