import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Plus,
  Trash2,
  Edit2,
  Save,
  X,
  CheckCircle2,
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

// Standalone "Most Common" content manager — NOT tied to any question
// bank. Structurally identical to AdminFlashcardsManager (same simple
// Q&A model, same Single/Bulk modes), just tagged cardType: 'most_common'
// so it's stored and displayed completely separately from regular
// Flashcards, with a different (fill-in-the-blank) reveal style on the
// student side.
export const AdminMostCommonManager: React.FC = () => {
  const [cards, setCards] = useState<Flashcard[]>(getFlashcards('most_common'));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [bulkText, setBulkText] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const refreshList = () => {
    setCards(getFlashcards('most_common'));
    syncFlashcardsFromSupabase('most_common').then((synced) => {
      if (synced && Array.isArray(synced)) setCards(synced);
    }).catch(() => {});
  };

  useEffect(() => {
    refreshList();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || !answer.trim()) return;

    try {
      await saveFlashcard({
        id: editingId || undefined,
        question: question.trim(),
        answer: answer.trim(),
        cardType: 'most_common'
      });
      setQuestion('');
      setAnswer('');
      setEditingId(null);
      setSuccessMsg(editingId ? 'Updated successfully.' : 'Added successfully.');
      refreshList();
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setBulkError(err.message || 'Failed to save.');
    }
  };

  const parseBulkCards = (text: string): { question: string; answer: string }[] => {
    const blocks = text.split(/^---$/m).map((b) => b.trim()).filter(Boolean);
    const parsed: { question: string; answer: string }[] = [];
    for (const block of blocks) {
      const qMatch = block.match(/Q:\s*([\s\S]*?)(?=\nA:|$)/i);
      const aMatch = block.match(/A:\s*([\s\S]*)/i);
      const q = qMatch ? qMatch[1].trim() : '';
      const a = aMatch ? aMatch[1].trim() : '';
      if (q && a) parsed.push({ question: q, answer: a });
    }
    return parsed;
  };

  const bulkPreviewCount = parseBulkCards(bulkText).length;

  const handleBulkSave = async () => {
    const parsed = parseBulkCards(bulkText);
    if (parsed.length === 0) {
      setBulkError('No valid "Q: ... / A: ..." blocks found. Check the format below.');
      return;
    }
    setBulkError(null);
    setBulkSaving(true);
    try {
      for (const item of parsed) {
        await saveFlashcard({ question: item.question, answer: item.answer, cardType: 'most_common' });
      }
      setBulkText('');
      setSuccessMsg(`${parsed.length} card${parsed.length !== 1 ? 's' : ''} added successfully.`);
      refreshList();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setBulkError(err.message || 'Failed to save one or more cards.');
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
    if (window.confirm('Delete this Most Common card?')) {
      deleteFlashcard(id, 'most_common');
      if (editingId === id) handleCancel();
      refreshList();
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-100">
              {editingId ? 'Edit Most Common Card' : mode === 'bulk' ? 'Bulk Add Most Common' : 'Create Most Common Card'}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {!editingId && (
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
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}
        {bulkError && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{bulkError}</span>
          </div>
        )}

        {mode === 'single' || editingId ? (
          <form onSubmit={handleSave} className="space-y-4 text-xs">
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-300">Question</label>
              <textarea
                required
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g., What is the most common cause of community-acquired pneumonia?"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors leading-relaxed"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-300">Answer</label>
              <textarea
                required
                rows={3}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="e.g., Streptococcus pneumoniae."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors leading-relaxed"
              />
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs flex items-center gap-2 transition-all shadow-md shadow-amber-500/20"
              >
                {editingId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                <span>{editingId ? 'Update Card' : 'Save Card'}</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 leading-relaxed">
              Paste multiple cards using this format — separate each with a line containing only <code className="text-amber-400">---</code>:
              <pre className="mt-2 p-2.5 rounded-lg bg-black/40 text-slate-300 text-[11px] whitespace-pre-wrap font-mono">{`Q: What is the most common cause of community-acquired pneumonia?
A: Streptococcus pneumoniae.
---
Q: What is the most common site of colon cancer?
A: The rectosigmoid region.`}</pre>
            </div>

            <textarea
              rows={12}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder="Paste your Q: / A: / --- formatted cards here..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 leading-relaxed font-mono text-[11px]"
            />

            <div className="flex items-center justify-between pt-1">
              <span className="text-slate-500">
                {bulkPreviewCount > 0 ? `${bulkPreviewCount} card${bulkPreviewCount !== 1 ? 's' : ''} detected` : 'No cards detected yet'}
              </span>
              <button
                type="button"
                onClick={handleBulkSave}
                disabled={bulkSaving || bulkPreviewCount === 0}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold flex items-center gap-2 transition-all shadow-md shadow-amber-500/20 disabled:opacity-40"
              >
                <ListPlus className="w-4 h-4" />
                <span>{bulkSaving ? 'Saving...' : `Save ${bulkPreviewCount || ''} Cards`}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-100 flex items-center gap-2">
            <span>Existing Most Common Cards</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs font-semibold">{cards.length}</span>
          </h3>
        </div>

        {cards.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500">
            No Most Common cards yet. Use the form above to add your first one.
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
                {cards.map((card) => (
                  <tr key={card.id} className={`hover:bg-slate-800/40 transition-colors ${editingId === card.id ? 'bg-amber-500/10' : ''}`}>
                    <td className="px-4 py-3.5 align-top font-medium text-slate-100 max-w-xs leading-relaxed">{card.question}</td>
                    <td className="px-4 py-3.5 align-top text-slate-300 max-w-xs leading-relaxed">{card.answer}</td>
                    <td className="px-4 py-3.5 align-top text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => handleEdit(card)} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 transition-colors" title="Edit">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(card.id)} className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-rose-400 hover:text-rose-300 transition-colors" title="Delete">
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
