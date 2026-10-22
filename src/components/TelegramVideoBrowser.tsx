import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Play, CheckCircle2, Lock, Clapperboard } from 'lucide-react';
import { resolveSession } from '../services/authService';

interface TgVideo {
  id: number | string;
  title: string;
  duration_seconds?: number | null;
  major?: string | null;
  topic?: string | null;
}

interface TelegramVideoBrowserProps {
  bankId: string;
  search: string;
  onLoaded?: (count: number) => void;
}

const fmtDuration = (s?: number | null): string => {
  if (!s || s <= 0) return '';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Student "Videos" section for explanation videos kept in a Telegram channel:
// grouped Major -> Topic (the same topics the question bank uses), searchable.
// Tapping a video makes the bot send it into the student's chat (protected).
export const TelegramVideoBrowser: React.FC<TelegramVideoBrowserProps> = ({ bankId, search, onLoaded }) => {
  const [videos, setVideos] = useState<TgVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState<string | null>(null);
  const [openMajors, setOpenMajors] = useState<Set<string>>(new Set());
  const [openTopics, setOpenTopics] = useState<Set<string>>(new Set());
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const user = resolveSession().user;
  const headers: Record<string, string> = {
    'x-telegram-user-id': user.telegramId || '',
    'x-telegram-username': user.username || ''
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/videos/tg-list?bankId=${encodeURIComponent(bankId)}`, { headers })
      .then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (ok && data.success) {
          setVideos(data.videos || []);
          onLoaded?.((data.videos || []).length);
        } else {
          setLocked(data.error || 'Not available.');
          onLoaded?.(0);
        }
      })
      .catch(() => {
        if (!cancelled) onLoaded?.(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId]);

  const q = search.trim().toLowerCase();
  const searching = q.length > 0;

  const groups = useMemo(() => {
    const list = videos.filter(
      (v) => !q || `${v.title} ${v.major || ''} ${v.topic || ''}`.toLowerCase().includes(q)
    );
    const byMajor = new Map<string, Map<string, TgVideo[]>>();
    for (const v of list) {
      const major = v.major || 'Other';
      const topic = v.topic || 'General';
      if (!byMajor.has(major)) byMajor.set(major, new Map());
      const tm = byMajor.get(major)!;
      if (!tm.has(topic)) tm.set(topic, []);
      tm.get(topic)!.push(v);
    }
    return Array.from(byMajor.entries())
      .sort((a, b) => (a[0] === 'Other' ? 1 : b[0] === 'Other' ? -1 : a[0].localeCompare(b[0])))
      .map(([major, tm]) => ({
        major,
        count: Array.from(tm.values()).reduce((n, l) => n + l.length, 0),
        topics: Array.from(tm.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([topic, vids]) => ({ topic, vids }))
      }));
  }, [videos, q]);

  const toggle = (set: Set<string>, setFn: (s: Set<string>) => void, key: string) => {
    const n = new Set(set);
    n.has(key) ? n.delete(key) : n.add(key);
    setFn(n);
  };

  const send = async (v: TgVideo) => {
    const id = String(v.id);
    setSendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/videos/tg/${encodeURIComponent(id)}/send`, { method: 'POST', headers });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.success) setSentId(id);
      else setError(d.error || 'Could not send the video.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSendingId(null);
    }
  };

  const closeApp = () => {
    try {
      (window as any)?.Telegram?.WebApp?.close?.();
    } catch {
      /* ignore */
    }
  };

  if (loading) {
    return (
      <div className="py-10 text-center text-slate-500 text-sm flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Loading videos…</span>
      </div>
    );
  }

  if (locked) {
    return (
      <div className="glass-panel p-8 text-center space-y-2">
        <Lock className="w-8 h-8 text-slate-500 mx-auto" />
        <p className="text-sm text-slate-300">{locked}</p>
      </div>
    );
  }

  if (videos.length === 0) return null;

  if (groups.length === 0) {
    return <p className="text-center text-xs text-slate-500 py-8">No videos match your search.</p>;
  }

  return (
    <div className="space-y-3">
      {sentId && (
        <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex items-center justify-between gap-3 sticky top-2 z-10 backdrop-blur">
          <span>Sent to your Telegram chat with the bot.</span>
          <button
            type="button"
            onClick={closeApp}
            className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold text-[11px] shrink-0"
          >
            Open chat
          </button>
        </div>
      )}
      {error && <p className="text-xs text-rose-400">{error}</p>}

      {groups.map((g) => {
        const majorOpen = searching || openMajors.has(g.major);
        return (
          <div key={g.major} className="rounded-2xl bg-slate-900/80 border border-slate-800 overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(openMajors, setOpenMajors, g.major)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left"
            >
              <span className="flex items-center gap-2 text-slate-100 font-bold text-sm">
                <Clapperboard className="w-4 h-4 text-purple-400" />
                {g.major}
              </span>
              <span className="flex items-center gap-2 text-xs text-slate-400">
                {g.count}
                {majorOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </span>
            </button>

            {majorOpen && (
              <div className="border-t border-slate-800 divide-y divide-slate-800/70">
                {g.topics.map((t) => {
                  const key = `${g.major}||${t.topic}`;
                  const topicOpen = searching || openTopics.has(key);
                  return (
                    <div key={key}>
                      <button
                        type="button"
                        onClick={() => toggle(openTopics, setOpenTopics, key)}
                        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-800/40"
                      >
                        <span className="text-sm text-slate-200">{t.topic}</span>
                        <span className="flex items-center gap-2 text-[11px] text-slate-500">
                          {t.vids.length}
                          {topicOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </span>
                      </button>
                      {topicOpen && (
                        <div className="px-3 pb-3 space-y-2">
                          {t.vids.map((v) => {
                            const id = String(v.id);
                            const isSending = sendingId === id;
                            const isSent = sentId === id;
                            return (
                              <button
                                key={id}
                                type="button"
                                onClick={() => send(v)}
                                disabled={isSending}
                                className="w-full text-left px-3 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/40 transition-colors flex items-center gap-3 disabled:opacity-60"
                              >
                                <span className="w-8 h-8 rounded-lg bg-purple-500/15 text-purple-300 flex items-center justify-center shrink-0">
                                  {isSending ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : isSent ? (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                  ) : (
                                    <Play className="w-4 h-4" />
                                  )}
                                </span>
                                <span className="flex-1 min-w-0">
                                  <span className="block text-sm text-slate-100 truncate">{v.title}</span>
                                  {fmtDuration(v.duration_seconds) && (
                                    <span className="block text-[11px] text-slate-500">{fmtDuration(v.duration_seconds)}</span>
                                  )}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
