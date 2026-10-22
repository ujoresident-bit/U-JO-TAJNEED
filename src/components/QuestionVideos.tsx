import React, { useEffect, useState } from 'react';
import { Clapperboard, Loader2, Play, CheckCircle2 } from 'lucide-react';
import { resolveSession } from '../services/authService';

interface TgVideo {
  id: number | string;
  title: string;
  duration_seconds?: number | null;
}

interface QuestionVideosProps {
  questionId: string;
}

const fmtDuration = (s?: number | null): string => {
  if (!s || s <= 0) return '';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
};

// Shown under the explanation once the student has answered: lists the
// explanation videos linked to this question's topic. Tapping one makes the
// bot send the video into the student's Telegram chat (protected from
// forwarding / saving), so no video file or link is exposed in the app.
export const QuestionVideos: React.FC<QuestionVideosProps> = ({ questionId }) => {
  const [videos, setVideos] = useState<TgVideo[]>([]);
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
    setVideos([]);
    setSentId(null);
    setError(null);
    fetch(`/api/videos/for-question?questionId=${encodeURIComponent(questionId)}`, { headers })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.success) setVideos(d.videos || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId]);

  const send = async (v: TgVideo) => {
    const id = String(v.id);
    setSendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/videos/tg/${encodeURIComponent(id)}/send`, {
        method: 'POST',
        headers
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.success) setSentId(id);
      else setError((d.error || 'Could not send the video.') + (d.detail ? ` [${d.detail}]` : ''));
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

  if (videos.length === 0) return null;

  return (
    <div className="rounded-2xl border border-purple-500/30 bg-purple-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2 text-purple-300 text-xs font-bold uppercase tracking-wider">
        <Clapperboard className="w-4 h-4" />
        <span>Watch the explanation</span>
      </div>

      <div className="space-y-2">
        {videos.map((v) => {
          const id = String(v.id);
          const isSending = sendingId === id;
          const isSent = sentId === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => send(v)}
              disabled={isSending}
              className="w-full text-left px-3.5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/40 transition-colors flex items-center gap-3 disabled:opacity-60"
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
                <span className="block text-sm text-slate-100 font-medium truncate">{v.title}</span>
                {fmtDuration(v.duration_seconds) && (
                  <span className="block text-[11px] text-slate-500">{fmtDuration(v.duration_seconds)}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {sentId && (
        <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex items-center justify-between gap-3">
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
    </div>
  );
};
