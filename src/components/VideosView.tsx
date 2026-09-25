import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Search, Play, Clapperboard, X } from 'lucide-react';
import { resolveSession } from '../services/authService';

interface VideoItem {
  id: string;
  title: string;
  description?: string;
  thumbnail_url?: string;
  video_url: string;
  category?: string;
  duration_label?: string;
}

interface VideosViewProps {
  bankId: string;
  onNavigate: (view: string, params?: any) => void;
}

// Netflix-style browsable video library: thumbnail cards in a responsive
// grid, a search bar that filters by title/category, and a lightweight
// player overlay when a card is selected.
export const VideosView: React.FC<VideosViewProps> = ({ bankId, onNavigate }) => {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeVideo, setActiveVideo] = useState<VideoItem | null>(null);

  useEffect(() => {
    const user = resolveSession().user;
    fetch(`/api/videos?bankId=${encodeURIComponent(bankId)}`, {
      headers: {
        'x-telegram-user-id': user.telegramId || '',
        'x-telegram-username': user.username || ''
      }
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setVideos(data.videos || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [bankId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return videos;
    return videos.filter(
      (v) => v.title.toLowerCase().includes(q) || (v.category || '').toLowerCase().includes(q)
    );
  }, [videos, search]);

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      <button
        onClick={() => onNavigate('specialty_hub', { bankId })}
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        <span>Back</span>
      </button>

      <div className="space-y-1">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-100 flex items-center gap-2">
          <Clapperboard className="w-6 h-6 text-purple-400" />
          <span>Videos</span>
        </h1>
        <p className="text-xs text-slate-400">Browse the video library for this specialty.</p>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search videos..."
          className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-purple-500"
        />
      </div>

      {loading ? (
        <div className="text-center text-slate-500 text-sm py-16">Loading videos...</div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel p-10 text-center space-y-3">
          <Clapperboard className="w-10 h-10 text-purple-400 mx-auto" />
          <h2 className="text-lg font-bold text-slate-100">
            {videos.length === 0 ? 'No videos yet' : 'No matches found'}
          </h2>
          <p className="text-xs text-slate-400">
            {videos.length === 0
              ? "Your admin hasn't added any videos for this specialty yet."
              : 'Try a different search term.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {filtered.map((v) => (
            <button
              key={v.id}
              onClick={() => setActiveVideo(v)}
              className="group text-left space-y-2"
            >
              <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-900 border border-white/5 group-hover:border-purple-500/50 transition-all">
                {v.thumbnail_url ? (
                  <img src={v.thumbnail_url} alt={v.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
                    <Clapperboard className="w-8 h-8 text-slate-600" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
                  <Play className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity fill-white" />
                </div>
                {v.duration_label && (
                  <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-bold text-white">
                    {v.duration_label}
                  </span>
                )}
              </div>
              <p className="text-xs font-semibold text-slate-200 line-clamp-2 group-hover:text-purple-300 transition-colors">{v.title}</p>
              {v.category && <p className="text-[10px] text-slate-500">{v.category}</p>}
            </button>
          ))}
        </div>
      )}

      {activeVideo && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setActiveVideo(null)}>
          <div className="w-full max-w-3xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-slate-100 font-bold text-sm">{activeVideo.title}</h3>
              <button onClick={() => setActiveVideo(null)} className="text-slate-400 hover:text-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="aspect-video rounded-xl overflow-hidden bg-black">
              <video
                src={activeVideo.video_url}
                className="w-full h-full"
                controls
                autoPlay
                playsInline
              />
            </div>
            {activeVideo.description && (
              <p className="text-xs text-slate-400">{activeVideo.description}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
