import React, { useEffect, useState } from 'react';
import { Clapperboard, Plus, Trash2, Pencil, X, Save } from 'lucide-react';
import { resolveSession } from '../services/authService';

interface VideoItem {
  id: string;
  bank_id: string;
  title: string;
  description?: string;
  thumbnail_url?: string;
  video_url: string;
  category?: string;
  duration_label?: string;
  sort_order?: number;
}

const EMPTY_FORM = {
  bankId: 'human_medicine',
  title: '',
  description: '',
  thumbnailUrl: '',
  videoUrl: '',
  category: '',
  durationLabel: '',
  sortOrder: 0
};

// Admin CRUD for the Netflix-style video library. Videos are referenced
// by URL (e.g. a YouTube/Vimeo embed link) rather than uploaded as raw
// binary files, since this app has no video-hosting infrastructure of
// its own — admins host the file elsewhere and paste the link here.
export const AdminVideoManager: React.FC = () => {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [bankFilter, setBankFilter] = useState<string>('human_medicine');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const user = resolveSession().user;
  const authHeaders = {
    'Content-Type': 'application/json',
    'x-telegram-user-id': user.telegramId || '',
    'x-telegram-username': user.username || ''
  };

  const loadVideos = () => {
    setLoading(true);
    fetch(`/api/admin/videos?bankId=${encodeURIComponent(bankFilter)}`, { headers: authHeaders })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setVideos(data.videos || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadVideos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankFilter]);

  const openNewForm = () => {
    setForm({ ...EMPTY_FORM, bankId: bankFilter });
    setEditingId(null);
    setShowForm(true);
  };

  const openEditForm = (v: VideoItem) => {
    setForm({
      bankId: v.bank_id,
      title: v.title,
      description: v.description || '',
      thumbnailUrl: v.thumbnail_url || '',
      videoUrl: v.video_url,
      category: v.category || '',
      durationLabel: v.duration_label || '',
      sortOrder: v.sort_order || 0
    });
    setEditingId(v.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.videoUrl.trim()) return;
    setSaving(true);
    try {
      const url = editingId ? `/api/admin/videos/${editingId}` : '/api/admin/videos';
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: authHeaders, body: JSON.stringify(form) });
      const data = await res.json();
      if (data.success) {
        setShowForm(false);
        loadVideos();
      } else {
        alert(data.error || 'Failed to save video.');
      }
    } catch (err) {
      alert('Network error while saving video.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this video? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/admin/videos/${id}`, { method: 'DELETE', headers: authHeaders });
      const data = await res.json();
      if (data.success) loadVideos();
      else alert(data.error || 'Failed to delete video.');
    } catch {
      alert('Network error while deleting video.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
          <Clapperboard className="w-5 h-5 text-purple-400" />
          <span>Video Library Management</span>
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={bankFilter}
            onChange={(e) => setBankFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-xs"
          >
            <option value="human_medicine">Human Medicine</option>
            <option value="dentistry">Dentistry</option>
          </select>
          <button
            onClick={openNewForm}
            className="px-4 py-2 rounded-lg bg-purple-500 hover:bg-purple-400 text-slate-950 text-xs font-bold flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Add Video</span>
          </button>
        </div>
      </div>

      {showForm && (
        <div className="glass-panel p-5 space-y-3 border border-purple-500/30">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-100">{editingId ? 'Edit Video' : 'New Video'}</h3>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-100">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="space-y-1">
              <label className="text-slate-400 font-bold">Bank</label>
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
              <label className="text-slate-400 font-bold">Category (optional)</label>
              <input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. Cardiology"
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-slate-400 font-bold">Title *</label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-slate-400 font-bold">Video URL (embed link) *</label>
              <input
                value={form.videoUrl}
                onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
                placeholder="https://www.youtube.com/embed/VIDEO_ID"
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-slate-400 font-bold">Thumbnail URL (optional)</label>
              <input
                value={form.thumbnailUrl}
                onChange={(e) => setForm({ ...form, thumbnailUrl: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100"
              />
            </div>
            <div className="space-y-1">
              <label className="text-slate-400 font-bold">Duration Label (optional)</label>
              <input
                value={form.durationLabel}
                onChange={(e) => setForm({ ...form, durationLabel: e.target.value })}
                placeholder="e.g. 12:34"
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-slate-400 font-bold">Description (optional)</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100"
              />
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !form.title.trim() || !form.videoUrl.trim()}
            className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving...' : 'Save Video'}</span>
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center text-slate-500 text-sm py-10">Loading videos...</div>
      ) : videos.length === 0 ? (
        <div className="text-center text-slate-500 text-sm py-10">No videos added for this bank yet.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {videos.map((v) => (
            <div key={v.id} className="glass-panel p-3 flex items-center gap-3">
              <div className="w-20 h-12 rounded-lg overflow-hidden bg-slate-900 shrink-0">
                {v.thumbnail_url ? (
                  <img src={v.thumbnail_url} alt={v.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Clapperboard className="w-5 h-5 text-slate-600" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-100 truncate">{v.title}</p>
                <p className="text-[10px] text-slate-500 truncate">{v.category || 'Uncategorized'}</p>
              </div>
              <button onClick={() => openEditForm(v)} className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-100">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => handleDelete(v.id)} className="p-2 rounded-lg hover:bg-rose-500/10 text-slate-400 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
