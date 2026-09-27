import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Plus, Trash2, X, Upload, Loader2, CheckCircle2, AlertTriangle, FileText } from 'lucide-react';
import { resolveSession } from '../services/authService';

interface BookPart {
  id: string;
  title: string;
  pdf_url: string;
  page_count: number;
  sort_order: number;
}

// Admin manager for Smart First Aid Step1 v2 — the admin's own book,
// uploaded as PDF "parts" (one per chapter/system) rather than typed in
// manually. Text is extracted automatically server-side on upload so the
// AI assistant has real content to ground answers in immediately.
export const AdminStudyContentManager: React.FC = () => {
  const [parts, setParts] = useState<BookPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const user = resolveSession().user;
  const authHeaders = { 'x-telegram-user-id': user.telegramId || '', 'x-telegram-username': user.username || '' };

  const loadParts = () => {
    setLoading(true);
    fetch('/api/admin/study-book', { headers: authHeaders })
      .then((res) => res.json())
      .then((data) => { if (data.success) setParts(data.parts || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadParts(); }, []);

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!title.trim()) { setError('Enter a title for this part (e.g. "Cardiovascular System").'); return; }
    if (!file) { setError('Choose a PDF file to upload.'); return; }

    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', title.trim());
      const res = await fetch('/api/admin/study-book/upload', { method: 'POST', headers: authHeaders, body: fd });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg(
          data.textExtracted
            ? `"${title}" uploaded — ${data.part.page_count} pages, text extracted for the AI assistant.`
            : `"${title}" uploaded — ${data.part.page_count} pages, but no text could be extracted (scanned/image-only PDF). The AI assistant won't have grounding text for this part.`
        );
        setTitle('');
        if (fileRef.current) fileRef.current.value = '';
        setShowForm(false);
        loadParts();
        setTimeout(() => setSuccessMsg(null), 6000);
      } else {
        setError(data.error || 'Upload failed.');
      }
    } catch (err) {
      setError('Network error while uploading.');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this book part? Students will lose access to it.')) return;
    const res = await fetch(`/api/admin/study-book/${id}`, { method: 'DELETE', headers: authHeaders });
    const data = await res.json();
    if (data.success) loadParts();
    else alert(data.error || 'Failed to delete.');
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-cyan-400" />
          <span>Smart First Aid Step1 — Book Parts</span>
        </h2>
        <button onClick={() => setShowForm(true)} className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex items-center gap-1.5">
          <Plus className="w-4 h-4" /><span>Upload PDF Part</span>
        </button>
      </div>

      <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-200 text-xs leading-relaxed">
        Split your 600-page book into smaller PDF files by chapter/system (each under 50MB) and upload them one at a time here. Text is extracted automatically so the AI assistant can answer questions grounded in each part's real content.
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
            <h3 className="text-sm font-bold text-slate-100">Upload New Part</h3>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-100"><X className="w-4 h-4" /></button>
          </div>
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="text-slate-400 font-bold">Part Title *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Cardiovascular System" className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100" />
            </div>
            <div className="space-y-1">
              <label className="text-slate-400 font-bold">PDF File *</label>
              <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={() => setError(null)} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-950 border border-dashed border-slate-700 hover:border-cyan-500 text-slate-300 flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4" />
                <span>{fileRef.current?.files?.[0]?.name || 'Choose PDF file (max 50MB)'}</span>
              </button>
            </div>
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              <span>{uploading ? 'Uploading & extracting text...' : 'Upload'}</span>
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-slate-500 text-sm py-10">Loading...</div>
      ) : parts.length === 0 ? (
        <div className="text-center text-slate-500 text-sm py-10">No parts uploaded yet.</div>
      ) : (
        <div className="space-y-2">
          {parts.map((p) => (
            <div key={p.id} className="glass-panel p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5 text-cyan-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-100 truncate">{p.title}</p>
                <p className="text-[10px] text-slate-500">{p.page_count} pages</p>
              </div>
              <button onClick={() => handleDelete(p.id)} className="p-2 rounded-lg hover:bg-rose-500/10 text-slate-400 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
