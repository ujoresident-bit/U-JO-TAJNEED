import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clapperboard,
  Trash2,
  Pencil,
  X,
  Save,
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  FolderPlus,
  Link2,
  Wand2
} from 'lucide-react';
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
  major?: string | null;
  topic?: string | null;
}

interface TopicPair {
  major: string;
  topic: string;
}

type QueueStatus = 'ready' | 'uploading' | 'done' | 'error';

interface QueueItem {
  key: string;
  file: File;
  title: string;
  category: string;
  major: string;
  topic: string;
  suggested: 'auto' | 'review' | 'none' | '';
  status: QueueStatus;
  error?: string;
}

const cleanTitle = (name: string) =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const fmtSize = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

const inputCls =
  'w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-purple-500';

// Admin video library: upload videos from the computer in bulk, give every
// video a title, put it in a named section (category) and link it to a
// question-bank Major/Topic so it appears inside the question screen.
export const AdminVideoManager: React.FC = () => {
  const bankId = 'human_medicine';
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [topics, setTopics] = useState<TopicPair[]>([]);
  const [sections, setSections] = useState<string[]>([]);
  const [newSection, setNewSection] = useState('');
  const [defaultSection, setDefaultSection] = useState('');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [filterSection, setFilterSection] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<VideoItem | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);
  const queueRef = useRef<QueueItem[]>([]);
  queueRef.current = queue;

  const user = resolveSession().user;
  const authHeaders = {
    'x-telegram-user-id': user.telegramId || '',
    'x-telegram-username': user.username || ''
  };
  const jsonAuthHeaders = { 'Content-Type': 'application/json', ...authHeaders };

  const loadVideos = () => {
    setLoading(true);
    fetch(`/api/admin/videos?bankId=${bankId}`, { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setVideos(d.videos || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const loadTopics = () => {
    fetch(`/api/admin/video-topics?bankId=${bankId}`, { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setTopics(d.topics || []);
          setSections((prev) => Array.from(new Set([...(d.sections || []), ...prev])).sort());
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadVideos();
    loadTopics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allSections = useMemo(() => {
    const s = new Set<string>(sections);
    videos.forEach((v) => v.category && s.add(v.category));
    return Array.from(s).sort();
  }, [sections, videos]);

  const majors = useMemo(() => Array.from(new Set(topics.map((t) => t.major))).sort(), [topics]);
  const topicsOf = (major: string) =>
    topics
      .filter((t) => t.major === major)
      .map((t) => t.topic)
      .sort();

  const addSection = () => {
    const n = newSection.trim();
    if (!n) return;
    setSections((prev) => Array.from(new Set([...prev, n])).sort());
    setDefaultSection(n);
    setNewSection('');
  };

  // ---- queue ----
  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = Array.from(e.target.files || []) as File[];
    if (fileRef.current) fileRef.current.value = '';
    if (files.length === 0) return;
    const items: QueueItem[] = files.map((f, i) => ({
      key: `${Date.now()}_${i}_${f.name}`,
      file: f,
      title: cleanTitle(f.name),
      category: defaultSection,
      major: '',
      topic: '',
      suggested: '',
      status: 'ready'
    }));
    setQueue((q) => [...q, ...items]);
    await suggestFor(items.map((i) => i.key), items.map((i) => i.title));
  };

  const suggestFor = async (keys: string[], titles: string[]) => {
    try {
      const res = await fetch('/api/admin/videos/suggest', {
        method: 'POST',
        headers: jsonAuthHeaders,
        body: JSON.stringify({ bankId, titles })
      });
      const d = await res.json();
      if (!d.success) return;
      const map = new Map<string, any>();
      keys.forEach((k, i) => map.set(k, d.suggestions[i]));
      setQueue((q) =>
        q.map((it) => {
          const s = map.get(it.key);
          if (!s) return it;
          return { ...it, major: s.major || '', topic: s.topic || '', suggested: s.status };
        })
      );
    } catch {
      /* suggestions are optional */
    }
  };

  const updateItem = (key: string, patch: Partial<QueueItem>) =>
    setQueue((q) => q.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const retitleAndSuggest = (key: string, title: string) => {
    updateItem(key, { title });
  };

  const resuggestAll = async () => {
    const pending = queue.filter((i) => i.status === 'ready' || i.status === 'error');
    await suggestFor(pending.map((i) => i.key), pending.map((i) => i.title));
  };

  const applySectionToAll = () => {
    setQueue((q) => q.map((it) => (it.status === 'done' ? it : { ...it, category: defaultSection })));
  };

  const uploadOne = async (it: QueueItem): Promise<void> => {
    updateItem(it.key, { status: 'uploading', error: undefined });
    try {
      const fd = new FormData();
      fd.append('file', it.file);
      fd.append('kind', 'video');
      const up = await fetch('/api/admin/videos/upload', { method: 'POST', headers: authHeaders, body: fd });
      const ud = await up.json().catch(() => ({}));
      if (!up.ok || !ud.success) throw new Error(ud.error || `Upload failed (${up.status}).`);
      const res = await fetch('/api/admin/videos', {
        method: 'POST',
        headers: jsonAuthHeaders,
        body: JSON.stringify({
          bankId,
          title: it.title.trim(),
          videoUrl: ud.url,
          category: it.category.trim(),
          major: it.major,
          topic: it.topic
        })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) throw new Error(d.error || 'Saving the video failed.');
      updateItem(it.key, { status: 'done' });
    } catch (e: any) {
      updateItem(it.key, { status: 'error', error: e?.message || 'Failed.' });
    }
  };

  const runQueue = async () => {
    stopRef.current = false;
    setRunning(true);
    // snapshot: process items that are ready/error in order
    const todo = queue.filter((i) => (i.status === 'ready' || i.status === 'error') && i.title.trim());
    for (const it of todo) {
      if (stopRef.current) break;
      // read the latest edited version of the row
      const latest = queueRef.current.find((x) => x.key === it.key) || it;
      await uploadOne(latest);
    }
    setRunning(false);
    loadVideos();
    loadTopics();
  };

  const clearDone = () => setQueue((q) => q.filter((i) => i.status !== 'done'));

  const doneCount = queue.filter((i) => i.status === 'done').length;
  const pendingCount = queue.filter((i) => i.status === 'ready' || i.status === 'error').length;
  const noTopicCount = queue.filter((i) => i.status !== 'done' && !i.topic).length;

  // ---- library ----
  const filteredVideos = useMemo(() => {
    const q = search.trim().toLowerCase();
    return videos.filter((v) => {
      if (filterSection === '__none' && v.category) return false;
      if (filterSection && filterSection !== '__none' && v.category !== filterSection) return false;
      if (q && !`${v.title} ${v.topic || ''} ${v.major || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [videos, filterSection, search]);

  const saveEdit = async () => {
    if (!editing) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/admin/videos/${editing.id}`, {
        method: 'PUT',
        headers: jsonAuthHeaders,
        body: JSON.stringify({
          title: editing.title,
          category: editing.category || '',
          major: editing.major || '',
          topic: editing.topic || '',
          durationLabel: editing.duration_label || '',
          description: editing.description || ''
        })
      });
      const d = await res.json();
      if (d.success) {
        setEditing(null);
        loadVideos();
      } else alert(d.error || 'Failed to save.');
    } catch {
      alert('Network error.');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this video? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/admin/videos/${id}`, { method: 'DELETE', headers: authHeaders });
      const d = await res.json();
      if (d.success) loadVideos();
      else alert(d.error || 'Failed to delete.');
    } catch {
      alert('Network error.');
    }
  };

  const renderTopicPicker = (
    major: string,
    topic: string,
    onChange: (major: string, topic: string) => void
  ) => (
    <div className="grid grid-cols-2 gap-2">
      <select value={major} onChange={(e) => onChange(e.target.value, '')} className={inputCls}>
        <option value="">— Major —</option>
        {majors.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        {major && !majors.includes(major) && <option value={major}>{major}</option>}
      </select>
      <select value={topic} onChange={(e) => onChange(major, e.target.value)} className={inputCls} disabled={!major}>
        <option value="">— Topic —</option>
        {topicsOf(major).map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
        {topic && !topicsOf(major).includes(topic) && <option value={topic}>{topic}</option>}
      </select>
    </div>
  );

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
        <Clapperboard className="w-5 h-5 text-purple-400" />
        <span>Videos — Human Medicine</span>
        <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px]">{videos.length}</span>
      </h2>

      {/* Sections */}
      <div className="glass-panel p-4 space-y-3 border border-slate-800">
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <FolderPlus className="w-4 h-4 text-purple-400" />
          <span>1. Sections</span>
        </h3>
        <div className="flex gap-2">
          <input
            value={newSection}
            onChange={(e) => setNewSection(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addSection()}
            placeholder="New section name (e.g. Cardiology basics)"
            className={inputCls}
          />
          <button
            onClick={addSection}
            className="px-4 rounded-lg bg-purple-500 hover:bg-purple-400 text-slate-950 text-xs font-bold shrink-0"
          >
            Add
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {allSections.length === 0 && <span className="text-[11px] text-slate-500">No sections yet.</span>}
          {allSections.map((s) => (
            <button
              key={s}
              onClick={() => setDefaultSection(defaultSection === s ? '' : s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                defaultSection === s
                  ? 'bg-purple-500 text-slate-950 border-purple-400'
                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
              }`}
            >
              {s}
              <span className="ml-1.5 text-[10px] opacity-70">{videos.filter((v) => v.category === s).length}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">
          The highlighted section is applied to newly chosen files. You can change it per video below.
        </p>
      </div>

      {/* Upload */}
      <div className="glass-panel p-4 space-y-3 border border-purple-500/30">
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <Upload className="w-4 h-4 text-purple-400" />
          <span>2. Upload videos from your computer</span>
        </h3>
        <input ref={fileRef} type="file" accept="video/*" multiple onChange={onPickFiles} className="hidden" />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={running}
          className="w-full px-3 py-3 rounded-lg bg-slate-950 border border-dashed border-slate-700 hover:border-purple-500 text-slate-300 text-xs flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Upload className="w-4 h-4" />
          <span>Choose one or many video files (max 50 MB each)</span>
        </button>

        {queue.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-slate-400">
                {queue.length} files · {doneCount} done · {pendingCount} waiting
              </span>
              {noTopicCount > 0 && (
                <span className="text-amber-300 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {noTopicCount} without a linked topic
                </span>
              )}
              <span className="flex-1" />
              <button onClick={resuggestAll} className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 font-bold flex items-center gap-1">
                <Wand2 className="w-3 h-3" /> Re-suggest topics
              </button>
              <button onClick={applySectionToAll} className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 font-bold">
                Apply section to all
              </button>
              {doneCount > 0 && (
                <button onClick={clearDone} className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 font-bold">
                  Clear finished
                </button>
              )}
            </div>

            <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
              {queue.map((it) => (
                <div
                  key={it.key}
                  className={`rounded-xl border p-3 space-y-2 ${
                    it.status === 'done'
                      ? 'border-emerald-500/30 bg-emerald-500/5'
                      : it.status === 'error'
                      ? 'border-rose-500/40 bg-rose-500/5'
                      : 'border-slate-800 bg-slate-950/60'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      value={it.title}
                      onChange={(e) => retitleAndSuggest(it.key, e.target.value)}
                      disabled={it.status === 'uploading' || it.status === 'done'}
                      className={inputCls}
                      placeholder="Video title"
                    />
                    <span className="shrink-0 w-5 h-5 flex items-center justify-center">
                      {it.status === 'uploading' && <Loader2 className="w-4 h-4 animate-spin text-purple-300" />}
                      {it.status === 'done' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                      {it.status === 'error' && <AlertTriangle className="w-4 h-4 text-rose-400" />}
                      {it.status === 'ready' && (
                        <button onClick={() => setQueue((q) => q.filter((x) => x.key !== it.key))} className="text-slate-500 hover:text-rose-400">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </span>
                  </div>
                  {it.status !== 'done' && (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <select
                          value={it.category}
                          onChange={(e) => updateItem(it.key, { category: e.target.value })}
                          className={inputCls}
                          disabled={it.status === 'uploading'}
                        >
                          <option value="">— Section —</option>
                          {allSections.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <div className="text-[10px] text-slate-500 self-center truncate">
                          {it.file.name} · {fmtSize(it.file.size)}
                          {it.file.size > 50 * 1024 * 1024 && <span className="text-rose-400"> · too large</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                        <Link2 className="w-3 h-3" />
                        <span>Linked topic</span>
                        {it.suggested === 'auto' && <span className="text-emerald-300">auto-matched</span>}
                        {it.suggested === 'review' && <span className="text-amber-300">please check</span>}
                        {it.suggested === 'none' && !it.topic && <span className="text-slate-500">no match — choose manually</span>}
                      </div>
                      {renderTopicPicker(it.major, it.topic, (major, topic) =>
                        updateItem(it.key, { major, topic, suggested: '' })
                      )}
                    </>
                  )}
                  {it.error && <p className="text-[11px] text-rose-300">{it.error}</p>}
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={runQueue}
                disabled={running || pendingCount === 0}
                className="px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 text-xs font-extrabold flex items-center gap-2"
              >
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                <span>{running ? 'Uploading… keep this page open' : `Upload ${pendingCount} video(s)`}</span>
              </button>
              {running && (
                <button
                  onClick={() => (stopRef.current = true)}
                  className="px-4 py-2.5 rounded-lg bg-slate-800 text-slate-200 text-xs font-bold"
                >
                  Stop after current
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Library */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-slate-100">3. Library</h3>
        <div className="flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title / topic…"
            className={`${inputCls} sm:max-w-xs`}
          />
          <select value={filterSection} onChange={(e) => setFilterSection(e.target.value)} className={`${inputCls} sm:max-w-[14rem]`}>
            <option value="">All sections</option>
            <option value="__none">No section</option>
            {allSections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="text-center text-slate-500 text-sm py-10">Loading videos...</div>
        ) : filteredVideos.length === 0 ? (
          <div className="text-center text-slate-500 text-sm py-10">No videos.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredVideos.map((v) => (
              <div key={v.id} className="glass-panel p-3 flex items-center gap-3">
                <div className="w-14 h-10 rounded-lg bg-slate-900 shrink-0 flex items-center justify-center">
                  <Clapperboard className="w-5 h-5 text-slate-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-100 truncate">{v.title}</p>
                  <p className="text-[10px] text-slate-500 truncate">{v.category || 'No section'}</p>
                  <p className={`text-[10px] truncate ${v.topic ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {v.topic ? `${v.major} › ${v.topic}` : 'Not linked to a topic'}
                  </p>
                </div>
                <button onClick={() => setEditing({ ...v })} className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-100">
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

      {editing && (
        <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-3" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-100">Edit video</h3>
              <button onClick={() => setEditing(null)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className={inputCls} placeholder="Title" />
            <select value={editing.category || ''} onChange={(e) => setEditing({ ...editing, category: e.target.value })} className={inputCls}>
              <option value="">— Section —</option>
              {allSections.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {renderTopicPicker(editing.major || '', editing.topic || '', (major, topic) =>
              setEditing({ ...editing, major, topic })
            )}
            <input
              value={editing.duration_label || ''}
              onChange={(e) => setEditing({ ...editing, duration_label: e.target.value })}
              className={inputCls}
              placeholder="Duration label (optional) e.g. 12:34"
            />
            <button
              onClick={saveEdit}
              disabled={editSaving || !editing.title.trim()}
              className="w-full py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 text-xs font-extrabold flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>{editSaving ? 'Saving…' : 'Save'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
