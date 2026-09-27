import React, { useEffect, useState } from 'react';
import { BookOpen, Plus, Trash2, Pencil, X, Save, ListPlus, CheckCircle2, AlertTriangle } from 'lucide-react';
import { resolveSession } from '../services/authService';

interface StudyTopic {
  id: string;
  system_name: string;
  topic_title: string;
  content: string;
  high_yield_facts: string[];
  sort_order: number;
}

const EMPTY_FORM = { systemName: '', topicTitle: '', content: '', highYieldFacts: '' };

export const AdminStudyContentManager: React.FC = () => {
  const [topics, setTopics] = useState<StudyTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkSystem, setBulkSystem] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const user = resolveSession().user;
  const authHeaders = { 'x-telegram-user-id': user.telegramId || '', 'x-telegram-username': user.username || '' };
  const jsonHeaders = { 'Content-Type': 'application/json', ...authHeaders };

  const loadTopics = () => {
    setLoading(true);
    fetch('/api/admin/study-topics', { headers: authHeaders })
      .then((res) => res.json())
      .then((data) => { if (data.success) setTopics(data.topics || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadTopics(); }, []);

  const openNewForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  };

  const openEditForm = (t: StudyTopic) => {
    setForm({
      systemName: t.system_name,
      topicTitle: t.topic_title,
      content: t.content,
      highYieldFacts: (t.high_yield_facts || []).join('\n')
    });
    setEditingId(t.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.systemName.trim() || !form.topicTitle.trim() || !form.content.trim()) {
      setError('System, Topic Title, and Content are required.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const payload = {
        systemName: form.systemName.trim(),
        topicTitle: form.topicTitle.trim(),
        content: form.content.trim(),
        highYieldFacts: form.highYieldFacts.split('\n').map((s) => s.trim()).filter(Boolean)
      };
      const url = editingId ? `/api/admin/study-topics/${editingId}` : '/api/admin/study-topics';
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: jsonHeaders, body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.success) {
        setShowForm(false);
        setSuccessMsg(editingId ? 'Topic updated.' : 'Topic added.');
        loadTopics();
        setTimeout(() => setSuccessMsg(null), 3000);
      } else {
        setError(data.error || 'Failed to save.');
      }
    } catch (err) {
      setError('Network error while saving.');
    } finally {
      setSaving(false);
    }
  };

  // Bulk format: separate topics with a line containing only "===", and
  // within each block use "TITLE:" / "CONTENT:" / "HIGHYIELD:" markers.
  const parseBulkTopics = (text: string, systemName: string) => {
    const blocks = text.split(/^===$/m).map((b) => b.trim()).filter(Boolean);
    const parsed: { topicTitle: string; content: string; highYieldFacts: string[] }[] = [];
    for (const block of blocks) {
      const titleMatch = block.match(/TITLE:\s*([\s\S]*?)(?=\nCONTENT:|$)/i);
      const contentMatch = block.match(/CONTENT:\s*([\s\S]*?)(?=\nHIGHYIELD:|$)/i);
      const hyMatch = block.match(/HIGHYIELD:\s*([\s\S]*)/i);
      const title = titleMatch ? titleMatch[1].trim() : '';
      const content = contentMatch ? contentMatch[1].trim() : '';
      const hy = hyMatch ? hyMatch[1].split('\n').map((s) => s.replace(/^-\s*/, '').trim()).filter(Boolean) : [];
      if (title && content) parsed.push({ topicTitle: title, content, highYieldFacts: hy });
    }
    return parsed.map((p) => ({ ...p, systemName }));
  };

  const bulkPreview = bulkSystem.trim() ? parseBulkTopics(bulkText, bulkSystem) : [];

  const handleBulkSave = async () => {
    if (!bulkSystem.trim()) {
      setError('Enter the System name this batch belongs to.');
      return;
    }
    const parsed = parseBulkTopics(bulkText, bulkSystem);
    if (parsed.length === 0) {
      setError('No valid TITLE:/CONTENT: blocks found. Check the format below.');
      return;
    }
    setError(null);
    setBulkSaving(true);
    try {
      for (const topic of parsed) {
        await fetch('/api/admin/study-topics', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(topic) });
      }
      setBulkText('');
      setSuccessMsg(`${parsed.length} topic${parsed.length !== 1 ? 's' : ''} added successfully.`);
      loadTopics();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err) {
      setError('Failed to save one or more topics.');
    } finally {
      setBulkSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this topic?')) return;
    const res = await fetch(`/api/admin/study-topics/${id}`, { method: 'DELETE', headers: authHeaders });
    const data = await res.json();
    if (data.success) loadTopics();
    else alert(data.error || 'Failed to delete.');
  };

  const groupedBySystem = topics.reduce<Record<string, StudyTopic[]>>((acc, t) => {
    (acc[t.system_name] = acc[t.system_name] || []).push(t);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-cyan-400" />
          <span>Smart First Aid Step1 — Content Management</span>
        </h2>
        <button onClick={openNewForm} className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex items-center gap-1.5">
          <Plus className="w-4 h-4" />
          <span>Add Topic</span>
        </button>
      </div>

      {successMsg && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" /><span>{successMsg}</span>
        </div>
      )}
      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /><span>{error}</span>
        </div>
      )}

      {showForm && (
        <div className="glass-panel p-5 space-y-3 border border-cyan-500/30">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-100">{editingId ? 'Edit Topic' : 'New Topic'}</h3>
            <div className="flex items-center gap-2">
              {!editingId && (
                <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-950 border border-slate-800">
                  <button type="button" onClick={() => setMode('single')} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold ${mode === 'single' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400'}`}>Single</button>
                  <button type="button" onClick={() => setMode('bulk')} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 ${mode === 'bulk' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400'}`}>
                    <ListPlus className="w-3.5 h-3.5" /><span>Bulk</span>
                  </button>
                </div>
              )}
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-100"><X className="w-4 h-4" /></button>
            </div>
          </div>

          {mode === 'single' || editingId ? (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400 font-bold">System *</label>
                  <input value={form.systemName} onChange={(e) => setForm({ ...form, systemName: e.target.value })} placeholder="e.g. Cardiovascular System" className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100" />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400 font-bold">Topic Title *</label>
                  <input value={form.topicTitle} onChange={(e) => setForm({ ...form, topicTitle: e.target.value })} placeholder="e.g. Heart Failure" className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-slate-400 font-bold">Content *</label>
                <textarea rows={8} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Main topic content (markdown supported)..." className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 font-mono text-[11px]" />
              </div>
              <div className="space-y-1">
                <label className="text-slate-400 font-bold">High-Yield Facts (one per line)</label>
                <textarea rows={4} value={form.highYieldFacts} onChange={(e) => setForm({ ...form, highYieldFacts: e.target.value })} placeholder={"BNP is elevated in heart failure\nJVD is a sign of right-sided HF"} className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100" />
              </div>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
                <Save className="w-4 h-4" /><span>{saving ? 'Saving...' : 'Save Topic'}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400 font-bold">System (applies to entire batch) *</label>
                <input value={bulkSystem} onChange={(e) => setBulkSystem(e.target.value)} placeholder="e.g. Cardiovascular System" className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100" />
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 leading-relaxed">
                Paste multiple topics — separate each with a line containing only <code className="text-cyan-400">===</code>:
                <pre className="mt-2 p-2.5 rounded-lg bg-black/40 text-slate-300 text-[11px] whitespace-pre-wrap font-mono">{`TITLE: Heart Failure
CONTENT: Heart failure is a clinical syndrome where the heart cannot pump enough blood...
HIGHYIELD:
- BNP is elevated in heart failure
- JVD is a sign of right-sided HF
===
TITLE: Arrhythmias
CONTENT: Arrhythmias are abnormalities of heart rhythm...
HIGHYIELD:
- Afib has an irregularly irregular rhythm`}</pre>
              </div>
              <textarea rows={12} value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder="Paste your TITLE:/CONTENT:/HIGHYIELD: formatted topics here..." className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-[11px]" />
              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-500">{bulkPreview.length > 0 ? `${bulkPreview.length} topic(s) detected` : 'No topics detected yet'}</span>
                <button onClick={handleBulkSave} disabled={bulkSaving || bulkPreview.length === 0} className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-extrabold flex items-center gap-2 disabled:opacity-40">
                  <ListPlus className="w-4 h-4" /><span>{bulkSaving ? 'Saving...' : `Save ${bulkPreview.length || ''} Topics`}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-center text-slate-500 text-sm py-10">Loading topics...</div>
      ) : Object.keys(groupedBySystem).length === 0 ? (
        <div className="text-center text-slate-500 text-sm py-10">No topics added yet.</div>
      ) : (
        Object.entries(groupedBySystem).map(([system, sysTopics]: [string, StudyTopic[]]) => (
          <div key={system} className="glass-panel p-4 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400">{system}</h3>
            {sysTopics.map((t) => (
              <div key={t.id} className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center gap-3">
                <span className="flex-1 text-xs font-medium text-slate-200 truncate">{t.topic_title}</span>
                <button onClick={() => openEditForm(t)} className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-cyan-400"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-400 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
};
