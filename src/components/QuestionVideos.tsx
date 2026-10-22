import React, { useEffect, useState } from 'react';
import { Clapperboard, Play, X } from 'lucide-react';
import { resolveSession } from '../services/authService';

interface LinkedVideo {
  id: string;
  title: string;
  video_url: string;
  duration_label?: string | null;
  category?: string | null;
}

interface QuestionVideosProps {
  questionId: string;
}

// Shown once the student has answered: explanation videos linked to this
// question's topic. They play inside the app (no download button).
export const QuestionVideos: React.FC<QuestionVideosProps> = ({ questionId }) => {
  const [videos, setVideos] = useState<LinkedVideo[]>([]);
  const [active, setActive] = useState<LinkedVideo | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVideos([]);
    setActive(null);
    const user = resolveSession().user;
    fetch(`/api/videos/for-question?questionId=${encodeURIComponent(questionId)}`, {
      headers: {
        'x-telegram-user-id': user.telegramId || '',
        'x-telegram-username': user.username || ''
      }
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.success) setVideos(d.videos || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [questionId]);

  if (videos.length === 0) return null;

  return (
    <div className="rounded-2xl border border-purple-500/30 bg-purple-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2 text-purple-300 text-xs font-bold uppercase tracking-wider">
        <Clapperboard className="w-4 h-4" />
        <span>Watch the explanation</span>
      </div>
      <div className="space-y-2">
        {videos.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setActive(v)}
            className="w-full text-left px-3.5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/40 transition-colors flex items-center gap-3"
          >
            <span className="w-8 h-8 rounded-lg bg-purple-500/15 text-purple-300 flex items-center justify-center shrink-0">
              <Play className="w-4 h-4" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-slate-100 font-medium truncate">{v.title}</span>
              {v.duration_label && <span className="block text-[11px] text-slate-500">{v.duration_label}</span>}
            </span>
          </button>
        ))}
      </div>

      {active && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4" onClick={() => setActive(null)}>
          <div className="w-full max-w-3xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-slate-100 font-bold text-sm">{active.title}</h3>
              <button onClick={() => setActive(null)} className="text-slate-400 hover:text-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="aspect-video rounded-xl overflow-hidden bg-black">
              <video
                src={active.video_url}
                className="w-full h-full"
                controls
                controlsList="nodownload"
                onContextMenu={(e) => e.preventDefault()}
                autoPlay
                playsInline
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
