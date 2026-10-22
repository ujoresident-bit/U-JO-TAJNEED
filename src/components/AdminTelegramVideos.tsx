import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  Loader2,
  Search,
  Trash2,
  Save,
  CheckCircle2,
  AlertTriangle,
  Clapperboard,
  Link2
} from 'lucide-react';
import { resolveSession } from '../services/authService';

interface TgVideoRow {
  id: number;
  bank_id: string;
  title: string;
  tg_chat_id: string;
  tg_message_id: number;
  duration_seconds: number | null;
  major: string | null;
  topic: string | null;
  match_status: 'auto' | 'review' | 'manual' | 'none';
}

interface TopicOpt {
  major: string;
  topic: string;
}

interface ParsedItem {
  messageId: number;
  title: string;
  durationSeconds: number;
}

const flattenText = (t: any): string => {
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return t.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('');
  return '';
};

// Reads a Telegram Desktop "Export chat history" result.json and returns the
// video messages with a title taken from the caption (first non-empty line)
// or, failing that, the file name.
const parseTelegramExport = (json: any): { items: ParsedItem[]; chatId: string; channelName: string } => {
  const messages: any[] = Array.isArray(json?.messages) ? json.messages : [];
  const items: ParsedItem[] = [];
  for (const m of messages) {
    if (m?.type !== 'message') continue;
    const mime = String(m.mime_type || '');
    const isVideo = m.media_type === 'video_file' || (mime.startsWith('video/') && m.media_type !== 'video_message');
    if (!isVideo) continue;
    const caption = flattenText(m.text)
      .split('\n')
      .map((s) => s.trim())
      .find(Boolean);
    const fileName = String(m.file_name || m.file || '')
      .split('/')
      .pop()!
      .replace(/\.[a-z0-9]{2,4}$/i, '')
      .replace(/[_]+/g, ' ')
      .trim();
    const title = caption || (fileName && !fileName.startsWith('(File') ? fileName : '') || `Video ${m.id}`;
    items.push({ messageId: Number(m.id), title, durationSeconds: Number(m.duration_seconds) || 0 });
  }
  const rawId = json?.id !== undefined ? String(json.id) : '';
  const chatId = rawId ? (rawId.startsWith('-') ? rawId : `-100${rawId}`) : '';
  return { items, chatId, channelName: String(json?.name || '') };
};

const STATUS_STYLE: Record<string, string> = {
  auto: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  manual: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
  review: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  none: 'bg-rose-500/10 text-rose-300 border-rose-500/30'
};
const STATUS_LABEL: Record<string, string> = {
  auto: 'Auto',
  manual: 'Manual',
  review: 'Check',
  none: 'No match'
};

export const AdminTelegramVideos: React.FC = () => {
  const user = resolveSession().user;
  const headers = {
    'Content-Type': 'application/json',
    'x-telegram-user-id': user.telegramId || '',
    'x-telegram-username': user.username || ''
  };

  const [bankId, setBankId] = useState('human_medicine');
  const [videos, setVideos] = useState<TgVideoRow[]>([]);
  const [topics, setTopics] = useState<TopicOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // import state
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<{ items: ParsedItem[]; chatId: string; channelName: string } | null>(null);
  const [chatId, setChatId] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  // review state
  const [statusFilter, setStatusFilter] = useState<'attention' | 'all' | 'auto' | 'manual' | 'review' | 'none'>('attention');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkChoice, setBulkChoice] = useState('');
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | 'bulk' | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(60);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tg-videos?bankId=${encodeURIComponent(bankId)}`, { headers });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || 'Failed to load videos.');
      setVideos(d.videos || []);
      setTopics(d.topics || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load videos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportMsg(null);
    try {
      const text = await file.text();
      const result = parseTelegramExport(JSON.parse(text));
      setParsed(result);
      setChatId(result.chatId);
      if (result.items.length === 0) {
        setImportMsg('No video messages were found in this file. Make sure you exported the channel as JSON.');
      }
    } catch {
      setParsed(null);
      setImportMsg('Could not read this file. Use the result.json from Telegram Desktop export (JSON format).');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const runImport = async () => {
    if (!parsed || parsed.items.length === 0) return;
    setImporting(true);
    setImportMsg(null);
    setProgress(0);
    const total = { total: 0, auto: 0, review: 0, none: 0, kept: 0 };
    try {
      const chunk = 150;
      for (let i = 0; i < parsed.items.length; i += chunk) {
        const res = await fetch('/api/admin/tg-videos/import', {
          method: 'POST',
          headers,
          body: JSON.stringify({ bankId, chatId, items: parsed.items.slice(i, i + chunk) })
        });
        const d = await res.json();
        if (!d.success) throw new Error(d.error || 'Import failed.');
        (Object.keys(total) as (keyof typeof total)[]).forEach((k) => {
          total[k] += d.summary?.[k] || 0;
        });
        setProgress(Math.min(i + chunk, parsed.items.length));
      }
      setImportMsg(
        `Imported ${total.total} videos — ${total.auto} matched automatically, ${total.review} need a check, ${total.none} have no match` +
          (total.kept ? `, ${total.kept} kept your manual choice.` : '.')
      );
      setParsed(null);
      setStatusFilter('attention');
      await load();
    } catch (e: any) {
      setImportMsg(e?.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const counts = useMemo(() => {
    const c = { auto: 0, manual: 0, review: 0, none: 0 };
    videos.forEach((v) => {
      c[v.match_status] = (c[v.match_status] || 0) + 1;
    });
    return c;
  }, [videos]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return videos.filter((v) => {
      if (statusFilter === 'attention' && !(v.match_status === 'review' || v.match_status === 'none')) return false;
      if (statusFilter !== 'attention' && statusFilter !== 'all' && v.match_status !== statusFilter) return false;
      if (q && !(`${v.title} ${v.major || ''} ${v.topic || ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [videos, statusFilter, search]);

  useEffect(() => {
    setVisibleLimit(60);
  }, [statusFilter, search, bankId]);

  const topicOptions = useMemo(() => {
    const byMajor = new Map<string, string[]>();
    topics.forEach((t) => {
      if (!byMajor.has(t.major)) byMajor.set(t.major, []);
      byMajor.get(t.major)!.push(t.topic);
    });
    return Array.from(byMajor.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([major, list]) => ({ major, list: list.sort() }));
  }, [topics]);

  const currentChoice = (v: TgVideoRow) =>
    drafts[v.id] !== undefined ? drafts[v.id] : v.topic ? `${v.major || ''}||${v.topic}` : '';

  const applyChoice = (choice: string) => {
    const [major, topic] = choice.split('||');
    return { major: major || null, topic: topic || null };
  };

  const saveRow = async (v: TgVideoRow) => {
    const choice = currentChoice(v);
    const { major, topic } = applyChoice(choice);
    setBusy(v.id);
    try {
      const res = await fetch(`/api/admin/tg-videos/${v.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ major, topic })
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error);
      setVideos((prev) =>
        prev.map((x) =>
          x.id === v.id ? { ...x, major, topic, match_status: major || topic ? 'manual' : 'none' } : x
        )
      );
      setDrafts((p) => {
        const n = { ...p };
        delete n[v.id];
        return n;
      });
    } catch (e: any) {
      setError(e?.message || 'Failed to save.');
    } finally {
      setBusy(null);
    }
  };

  const confirmAuto = async (v: TgVideoRow) => {
    if (!v.topic) return;
    setBusy(v.id);
    try {
      const res = await fetch(`/api/admin/tg-videos/${v.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ major: v.major, topic: v.topic })
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error);
      setVideos((prev) => prev.map((x) => (x.id === v.id ? { ...x, match_status: 'manual' } : x)));
    } catch (e: any) {
      setError(e?.message || 'Failed to confirm.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (v: TgVideoRow) => {
    if (!window.confirm(`Remove this video from the app?\n\n${v.title}`)) return;
    setBusy(v.id);
    try {
      const res = await fetch(`/api/admin/tg-videos/${v.id}`, { method: 'DELETE', headers });
      const d = await res.json();
      if (!d.success) throw new Error(d.error);
      setVideos((prev) => prev.filter((x) => x.id !== v.id));
    } catch (e: any) {
      setError(e?.message || 'Failed to delete.');
    } finally {
      setBusy(null);
    }
  };

  const bulkAssign = async () => {
    if (!bulkChoice || selected.size === 0) return;
    const { major, topic } = applyChoice(bulkChoice);
    setBusy('bulk');
    try {
      const res = await fetch('/api/admin/tg-videos/bulk-assign', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ids: Array.from(selected), major, topic })
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error);
      setVideos((prev) =>
        prev.map((x) => (selected.has(x.id) ? { ...x, major, topic, match_status: 'manual' } : x))
      );
      setSelected(new Set());
      setBulkChoice('');
    } catch (e: any) {
      setError(e?.message || 'Bulk assign failed.');
    } finally {
      setBusy(null);
    }
  };

  const toggleSel = (id: number) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
      active
        ? 'bg-cyan-500 text-slate-950 border-cyan-400'
        : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
    }`;

  // Plain render function (not a component) so the <select> keeps its state across re-renders.
  const renderTopicSelect = (value: string, onChange: (v: string) => void, className = '') => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 px-2 py-2 focus:outline-none focus:border-cyan-500 ${className}`}
    >
      <option value="">— choose topic —</option>
      {topicOptions.map((g) => (
        <optgroup key={g.major} label={g.major}>
          {g.list.map((t) => (
            <option key={`${g.major}||${t}`} value={`${g.major}||${t}`}>
              {t}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );

  return (
    <div className="space-y-5">
      {/* ---------- Import ---------- */}
      <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
            <Clapperboard className="w-4 h-4 text-purple-400" />
            <span>Telegram Videos</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs font-semibold">{videos.length}</span>
          </h3>
          <select
            value={bankId}
            onChange={(e) => setBankId(e.target.value)}
            className="rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 px-2 py-2"
          >
            <option value="human_medicine">Human Medicine</option>
            <option value="dentistry">Dentistry</option>
          </select>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          1) In Telegram Desktop open the channel → ⋮ → <b>Export chat history</b> → untick media → Format: <b>JSON</b>.
          2) Choose the <code>result.json</code> here. Each video is matched to a topic by its title automatically.
          The bot must be an <b>admin of the channel</b>.
        </p>

        <input ref={fileRef} type="file" accept="application/json,.json" onChange={handleFile} className="hidden" />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          className="px-4 py-2.5 rounded-xl bg-purple-500 hover:bg-purple-400 disabled:opacity-50 text-slate-950 text-xs font-extrabold flex items-center gap-2"
        >
          <Upload className="w-4 h-4" />
          <span>Choose result.json</span>
        </button>

        {parsed && parsed.items.length > 0 && (
          <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 space-y-3">
            <p className="text-sm text-slate-100">
              Found <b className="text-emerald-300">{parsed.items.length}</b> videos
              {parsed.channelName ? <> in <b>{parsed.channelName}</b></> : null}.
            </p>
            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 font-semibold">Channel ID (filled automatically — check it)</label>
              <input
                value={chatId}
                onChange={(e) => setChatId(e.target.value.trim())}
                placeholder="-1001234567890"
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div className="text-[11px] text-slate-500 space-y-0.5">
              {parsed.items.slice(0, 3).map((i) => (
                <div key={i.messageId} className="truncate">• {i.title}</div>
              ))}
              {parsed.items.length > 3 && <div>…</div>}
            </div>
            <button
              onClick={runImport}
              disabled={importing || !/^-?\d+$/.test(chatId)}
              className="px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 text-xs font-extrabold flex items-center gap-2"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              <span>
                {importing ? `Importing ${progress} / ${parsed.items.length}…` : `Import & auto-match ${parsed.items.length} videos`}
              </span>
            </button>
          </div>
        )}

        {importMsg && (
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>{importMsg}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ---------- Review ---------- */}
      <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-5 shadow-xl space-y-4">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setStatusFilter('attention')} className={chip(statusFilter === 'attention')}>
            Needs attention ({counts.review + counts.none})
          </button>
          <button onClick={() => setStatusFilter('auto')} className={chip(statusFilter === 'auto')}>
            Auto ({counts.auto})
          </button>
          <button onClick={() => setStatusFilter('manual')} className={chip(statusFilter === 'manual')}>
            Manual ({counts.manual})
          </button>
          <button onClick={() => setStatusFilter('all')} className={chip(statusFilter === 'all')}>
            All ({videos.length})
          </button>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, major or topic…"
            className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-cyan-500 outline-none text-xs text-slate-100 placeholder-slate-600"
          />
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30">
            <span className="text-xs text-cyan-200 font-bold">{selected.size} selected</span>
            {renderTopicSelect(bulkChoice, setBulkChoice, 'flex-1 min-w-[180px]')}
            <button
              onClick={bulkAssign}
              disabled={!bulkChoice || busy === 'bulk'}
              className="px-3 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 text-xs font-extrabold"
            >
              Assign topic
            </button>
            <button onClick={() => setSelected(new Set())} className="px-3 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold">
              Clear
            </button>
          </div>
        )}

        {loading ? (
          <div className="py-10 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500">
            {videos.length === 0 ? 'No videos yet — import your channel export above.' : 'Nothing in this view.'}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.slice(0, visibleLimit).map((v) => {
              const dirty = drafts[v.id] !== undefined;
              return (
                <div key={v.id} className="rounded-xl bg-slate-950 border border-slate-800 p-3 space-y-2">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected.has(v.id)}
                      onChange={() => toggleSel(v.id)}
                      className="mt-1 accent-cyan-500"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-100 font-medium leading-snug break-words">{v.title}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        msg #{v.tg_message_id}
                        {v.major || v.topic ? ` · ${[v.major, v.topic].filter(Boolean).join(' › ')}` : ''}
                      </p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase shrink-0 ${STATUS_STYLE[v.match_status]}`}>
                      {STATUS_LABEL[v.match_status]}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-7">
                    {renderTopicSelect(
                      currentChoice(v),
                      (val) => setDrafts((p) => ({ ...p, [v.id]: val })),
                      'flex-1 min-w-[180px]'
                    )}
                    {dirty && (
                      <button
                        onClick={() => saveRow(v)}
                        disabled={busy === v.id}
                        className="px-3 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 text-xs font-extrabold flex items-center gap-1.5"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Save</span>
                      </button>
                    )}
                    {!dirty && v.match_status === 'review' && v.topic && (
                      <button
                        onClick={() => confirmAuto(v)}
                        disabled={busy === v.id}
                        className="px-3 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-1.5"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Confirm</span>
                      </button>
                    )}
                    <button
                      onClick={() => remove(v)}
                      disabled={busy === v.id}
                      className="p-2 rounded-lg bg-slate-800 hover:bg-rose-950 text-rose-400"
                      title="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
            {filtered.length > visibleLimit && (
              <button
                onClick={() => setVisibleLimit((n) => n + 100)}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
              >
                Show more ({filtered.length - visibleLimit} left)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
