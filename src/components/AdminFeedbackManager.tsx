import React, { useEffect, useMemo, useState } from 'react';
import {
  Flag,
  RefreshCw,
  CheckCircle2,
  Undo2,
  Pencil,
  Search,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import {
  fetchAllFeedback,
  setFeedbackResolved,
  FeedbackItem,
  FeedbackKind
} from '../services/adminService';

interface AdminFeedbackManagerProps {
  // Jump to the reported item in the matching admin editor.
  onOpenItem: (kind: FeedbackKind, itemId: string) => void;
  onUnresolvedCount?: (count: number) => void;
}

const KIND_META: Record<FeedbackKind, { label: string; badge: string }> = {
  question: { label: 'Question', badge: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30' },
  flashcard: { label: 'Flashcard', badge: 'bg-purple-500/10 text-purple-300 border-purple-500/30' },
  most_common: { label: 'Most Common', badge: 'bg-amber-500/10 text-amber-300 border-amber-500/30' }
};

export const AdminFeedbackManager: React.FC<AdminFeedbackManagerProps> = ({
  onOpenItem,
  onUnresolvedCount
}) => {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<'all' | FeedbackKind>('all');
  const [statusFilter, setStatusFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await fetchAllFeedback();
      setItems(all);
      onUnresolvedCount?.(all.filter((i) => !i.resolved).length);
    } catch (e: any) {
      setError(e?.message || 'Failed to load feedback.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleResolved = async (item: FeedbackItem) => {
    setBusyId(`${item.kind}:${item.id}`);
    try {
      await setFeedbackResolved(item, !item.resolved);
      const next = items.map((i) =>
        i.id === item.id && (i.kind === 'question') === (item.kind === 'question')
          ? { ...i, resolved: !item.resolved }
          : i
      );
      setItems(next);
      onUnresolvedCount?.(next.filter((i) => !i.resolved).length);
    } catch (e: any) {
      setError(e?.message || 'Failed to update.');
    } finally {
      setBusyId(null);
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (kindFilter !== 'all' && i.kind !== kindFilter) return false;
      if (statusFilter === 'open' && i.resolved) return false;
      if (statusFilter === 'resolved' && !i.resolved) return false;
      if (q) {
        const hay = [i.itemId, i.preview, i.answerPreview, i.message, i.reporterName, i.context]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, kindFilter, statusFilter, search]);

  const counts = useMemo(() => {
    const open = items.filter((i) => !i.resolved);
    return {
      all: open.length,
      question: open.filter((i) => i.kind === 'question').length,
      flashcard: open.filter((i) => i.kind === 'flashcard').length,
      most_common: open.filter((i) => i.kind === 'most_common').length
    };
  }, [items]);

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
      active
        ? 'bg-cyan-500 text-slate-950 border-cyan-400'
        : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
    }`;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
            <Flag className="w-4 h-4 text-amber-400" />
            <span>User Feedback</span>
            <span className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-extrabold">
              {counts.all} open
            </span>
          </h3>
          <button
            onClick={load}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by text, ID, reporter or note…"
            className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-cyan-500 outline-none text-xs text-slate-100 placeholder-slate-600"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => setKindFilter('all')} className={chip(kindFilter === 'all')}>
            All ({counts.all})
          </button>
          <button onClick={() => setKindFilter('question')} className={chip(kindFilter === 'question')}>
            Questions ({counts.question})
          </button>
          <button onClick={() => setKindFilter('flashcard')} className={chip(kindFilter === 'flashcard')}>
            Flashcards ({counts.flashcard})
          </button>
          <button onClick={() => setKindFilter('most_common')} className={chip(kindFilter === 'most_common')}>
            Most Common ({counts.most_common})
          </button>
          <span className="w-px bg-slate-800 mx-1" />
          <button onClick={() => setStatusFilter('open')} className={chip(statusFilter === 'open')}>
            Open
          </button>
          <button onClick={() => setStatusFilter('resolved')} className={chip(statusFilter === 'resolved')}>
            Resolved
          </button>
          <button onClick={() => setStatusFilter('all')} className={chip(statusFilter === 'all')}>
            Any
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-slate-500 text-xs flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading feedback…</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-500 rounded-2xl bg-slate-900/60 border border-slate-800">
          No feedback matches this view.
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((item) => {
            const meta = KIND_META[item.kind];
            const key = `${item.kind}:${item.id}`;
            return (
              <div
                key={key}
                className={`rounded-2xl border p-4 space-y-3 ${
                  item.resolved
                    ? 'bg-slate-900/50 border-slate-800 opacity-70'
                    : 'bg-slate-900/90 border-slate-700'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase ${meta.badge}`}>
                      {meta.label}
                    </span>
                    <code className="text-[11px] text-slate-400 break-all">{item.itemId}</code>
                    {item.context && <span className="text-[11px] text-slate-500">{item.context}</span>}
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {item.reporterName} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}
                  </span>
                </div>

                {item.message ? (
                  <p className="text-sm text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 leading-relaxed whitespace-pre-wrap">
                    {item.message}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 italic">(no note)</p>
                )}

                {item.exists ? (
                  <div className="text-xs text-slate-300 space-y-1 leading-relaxed">
                    {item.preview && <p className="text-slate-200">{item.preview}</p>}
                    {item.answerPreview && (
                      <p className="text-emerald-300/90">
                        <span className="text-slate-500">A: </span>
                        {item.answerPreview}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-rose-300">This item no longer exists (it may have been deleted).</p>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={() => onOpenItem(item.kind, item.itemId)}
                    disabled={!item.exists}
                    className="px-3.5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 text-xs font-extrabold flex items-center gap-1.5"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Open &amp; edit</span>
                  </button>
                  <button
                    onClick={() => toggleResolved(item)}
                    disabled={busyId === key}
                    className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-bold flex items-center gap-1.5"
                  >
                    {item.resolved ? <Undo2 className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                    <span>{item.resolved ? 'Reopen' : 'Mark resolved'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
