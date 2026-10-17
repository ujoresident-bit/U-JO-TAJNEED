import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, BookOpen, Send, HelpCircle, Loader2, FileText,
  Bookmark, Highlighter, Sparkles, ListChecks, X, Trophy, CheckCircle2, XCircle
} from 'lucide-react';
import { resolveSession } from '../services/authService';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore - Vite ?url import resolves to a bundled worker script URL
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface BookPart {
  id: string;
  title: string;
  pdf_url: string;
  page_count: number;
}

interface Mark {
  id: string;
  kind: 'highlight' | 'bookmark';
  page: number;
  color: string;
  rect: { x: number; y: number; w: number; h: number } | null;
  label?: string | null;
}

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

type Panel = null | 'chat' | 'summary' | 'quiz' | 'marks';

interface SmartFirstAidViewProps {
  onNavigate: (view: string, params?: any) => void;
}

const HIGHLIGHT_COLORS: Record<string, { fill: string; swatch: string }> = {
  yellow: { fill: 'rgba(250, 204, 21, 0.38)', swatch: '#facc15' },
  green: { fill: 'rgba(74, 222, 128, 0.36)', swatch: '#4ade80' },
  pink: { fill: 'rgba(244, 114, 182, 0.38)', swatch: '#f472b6' },
  blue: { fill: 'rgba(96, 165, 250, 0.38)', swatch: '#60a5fa' }
};

// Minimal markdown (## headings, **bold**, - bullets) for AI summaries.
const renderInline = (text: string) =>
  text.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
    chunk.startsWith('**') && chunk.endsWith('**')
      ? <strong key={i} className="text-slate-100">{chunk.slice(2, -2)}</strong>
      : <React.Fragment key={i}>{chunk}</React.Fragment>
  );

const SummaryText: React.FC<{ text: string }> = ({ text }) => (
  <div className="space-y-1.5 text-xs text-slate-300 leading-relaxed">
    {text.split('\n').map((line, i) => {
      const t = line.trim();
      if (!t) return <div key={i} className="h-1" />;
      if (t.startsWith('#')) return <p key={i} className="pt-2 text-[11px] font-bold uppercase tracking-wider text-cyan-300">{t.replace(/^#+\s*/, '')}</p>;
      if (/^[-*•]\s+/.test(t)) return <p key={i} className="pl-4 relative"><span className="absolute left-1 text-cyan-400">•</span>{renderInline(t.replace(/^[-*•]\s+/, ''))}</p>;
      return <p key={i}>{renderInline(t)}</p>;
    })}
  </div>
);

// Real PDF reader (PDF.js) with free page navigation, per-user resume,
// highlights, bookmarks, an AI assistant, an AI summary and a short quiz —
// all strictly grounded in the currently open part's own text.
export const SmartFirstAidView: React.FC<SmartFirstAidViewProps> = ({ onNavigate }) => {
  const [parts, setParts] = useState<BookPart[]>([]);
  const [progressByPart, setProgressByPart] = useState<Record<string, number>>({});
  const [quizByPart, setQuizByPart] = useState<Record<string, { score: number; total: number }>>({});
  const [loading, setLoading] = useState(true);

  const [activePart, setActivePart] = useState<BookPart | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [rendering, setRendering] = useState(false);

  const [panel, setPanel] = useState<Panel>(null);

  // AI assistant
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [asking, setAsking] = useState(false);

  // Summary
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');

  // Quiz
  const [quiz, setQuiz] = useState<QuizQuestion[] | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState('');
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizPicked, setQuizPicked] = useState<number | null>(null);
  const [quizScore, setQuizScore] = useState(0);
  const [quizDone, setQuizDone] = useState(false);

  // Marks (highlights + bookmarks)
  const [marks, setMarks] = useState<Mark[]>([]);
  const [highlightMode, setHighlightMode] = useState(false);
  const [highlightColor, setHighlightColor] = useState('yellow');
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const user = resolveSession().user;
  const authHeaders = { 'x-telegram-user-id': user.telegramId || '', 'x-telegram-username': user.username || '' };
  const jsonHeaders = { 'Content-Type': 'application/json', ...authHeaders };

  useEffect(() => {
    fetch('/api/study-book', { headers: authHeaders })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setParts(data.parts || []);
          setProgressByPart(data.progressByPart || {});
          setQuizByPart(data.quizByPart || {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const openPart = async (part: BookPart) => {
    setActivePart(part);
    setChatHistory([]);
    setPanel(null);
    setSummary(null); setSummaryError('');
    setQuiz(null); setQuizError(''); setQuizDone(false); setQuizIndex(0); setQuizPicked(null); setQuizScore(0);
    setMarks([]); setHighlightMode(false);
    const resumePage = progressByPart[part.id] || 1;
    setCurrentPage(resumePage);
    setPageInput(String(resumePage));

    fetch(`/api/study-book/${part.id}/marks`, { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => { if (d.success) setMarks(d.marks || []); })
      .catch(() => {});

    const loadingTask = pdfjsLib.getDocument({ url: part.pdf_url });
    const doc = await loadingTask.promise;
    setPdfDoc(doc);
  };

  const renderPage = async (doc: any, pageNum: number) => {
    if (!doc || !canvasRef.current) return;
    setRendering(true);
    try {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.4 });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      await page.render({ canvasContext: context, viewport }).promise;
    } finally {
      setRendering(false);
    }
  };

  useEffect(() => {
    if (pdfDoc) renderPage(pdfDoc, currentPage);
  }, [pdfDoc, currentPage]);

  useEffect(() => {
    if (!activePart) return;
    const t = setTimeout(() => {
      fetch(`/api/study-book/${activePart.id}/progress`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ page: currentPage })
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [currentPage, activePart]);

  const goToPage = (n: number) => {
    if (!activePart) return;
    const clamped = Math.max(1, Math.min(n, activePart.page_count || n));
    setCurrentPage(clamped);
    setPageInput(String(clamped));
  };

  // ----- Bookmarks -----
  const pageBookmark = marks.find((m) => m.kind === 'bookmark' && m.page === currentPage);

  const toggleBookmark = async () => {
    if (!activePart) return;
    if (pageBookmark) {
      setMarks((ms) => ms.filter((m) => m.id !== pageBookmark.id));
      fetch(`/api/study-book/marks/${pageBookmark.id}`, { method: 'DELETE', headers: authHeaders }).catch(() => {});
      return;
    }
    try {
      const res = await fetch(`/api/study-book/${activePart.id}/marks`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ kind: 'bookmark', page: currentPage })
      });
      const d = await res.json();
      if (d.success) setMarks((ms) => [...ms, d.mark]);
    } catch {}
  };

  // ----- Highlights (drag a rectangle over the page) -----
  const pointFromEvent = (e: React.PointerEvent) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    };
  };

  const onOverlayDown = (e: React.PointerEvent) => {
    if (!highlightMode) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragStart.current = pointFromEvent(e);
    setDraft({ ...dragStart.current, w: 0, h: 0 });
  };

  const onOverlayMove = (e: React.PointerEvent) => {
    if (!highlightMode || !dragStart.current) return;
    const p = pointFromEvent(e);
    const s = dragStart.current;
    setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };

  const onOverlayUp = async () => {
    const d = draft;
    dragStart.current = null;
    setDraft(null);
    if (!highlightMode || !d || !activePart || d.w < 0.01 || d.h < 0.005) return;
    try {
      const res = await fetch(`/api/study-book/${activePart.id}/marks`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ kind: 'highlight', page: currentPage, color: highlightColor, rect: d })
      });
      const data = await res.json();
      if (data.success) setMarks((ms) => [...ms, data.mark]);
    } catch {}
  };

  const deleteMark = (id: string) => {
    setMarks((ms) => ms.filter((m) => m.id !== id));
    fetch(`/api/study-book/marks/${id}`, { method: 'DELETE', headers: authHeaders }).catch(() => {});
  };

  // ----- AI assistant -----
  const handleAsk = async () => {
    if (!chatInput.trim() || !activePart) return;
    const question = chatInput.trim();
    setChatInput('');
    setChatHistory((h) => [...h, { role: 'user', text: question }]);
    setAsking(true);
    try {
      const res = await fetch(`/api/study-book/${activePart.id}/ask`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ question })
      });
      const data = await res.json();
      setChatHistory((h) => [...h, { role: 'assistant', text: data.success ? data.answer : (data.error || 'Something went wrong.') }]);
    } catch {
      setChatHistory((h) => [...h, { role: 'assistant', text: 'Network error — please try again.' }]);
    } finally {
      setAsking(false);
    }
  };

  // ----- Summary -----
  const loadSummary = async () => {
    if (!activePart || summaryLoading) return;
    setSummaryLoading(true);
    setSummaryError('');
    try {
      const res = await fetch(`/api/study-book/${activePart.id}/summary`, { method: 'POST', headers: jsonHeaders, body: '{}' });
      const data = await res.json();
      if (data.success) setSummary(data.summary);
      else setSummaryError(data.error || 'Could not create a summary.');
    } catch {
      setSummaryError('Network error — please try again.');
    } finally {
      setSummaryLoading(false);
    }
  };

  // ----- Quiz -----
  const loadQuiz = async () => {
    if (!activePart || quizLoading) return;
    setQuizLoading(true);
    setQuizError('');
    try {
      const res = await fetch(`/api/study-book/${activePart.id}/quiz`, { headers: authHeaders });
      const data = await res.json();
      if (data.success) {
        setQuiz(data.questions);
        setQuizIndex(0); setQuizPicked(null); setQuizScore(0); setQuizDone(false);
      } else {
        setQuizError(data.error || 'Could not create a quiz.');
      }
    } catch {
      setQuizError('Network error — please try again.');
    } finally {
      setQuizLoading(false);
    }
  };

  const pickQuizOption = (i: number) => {
    if (!quiz || quizPicked !== null) return;
    setQuizPicked(i);
    if (i === quiz[quizIndex].correctIndex) setQuizScore((s) => s + 1);
  };

  const nextQuiz = async () => {
    if (!quiz || !activePart) return;
    if (quizIndex + 1 < quiz.length) {
      setQuizIndex(quizIndex + 1);
      setQuizPicked(null);
      return;
    }
    setQuizDone(true);
    try {
      await fetch(`/api/study-book/${activePart.id}/quiz-result`, {
        method: 'POST', headers: jsonHeaders, body: JSON.stringify({ score: quizScore, total: quiz.length })
      });
      setQuizByPart((q) => {
        const prev = q[activePart.id];
        if (prev && prev.total && prev.score / prev.total > quizScore / quiz.length) return q;
        return { ...q, [activePart.id]: { score: quizScore, total: quiz.length } };
      });
    } catch {}
  };

  const togglePanel = (p: Exclude<Panel, null>) => {
    setPanel((cur) => (cur === p ? null : p));
    if (p === 'summary' && !summary && !summaryLoading) loadSummary();
    if (p === 'quiz' && !quiz && !quizLoading) loadQuiz();
  };

  if (loading) {
    return <div className="text-center text-slate-500 text-sm py-16">Loading Smart First Aid Step1...</div>;
  }

  // ---- PDF Reader view ----
  if (activePart) {
    const pageHighlights = marks.filter((m) => m.kind === 'highlight' && m.page === currentPage && m.rect);
    const bookmarks = marks.filter((m) => m.kind === 'bookmark').sort((a, b) => a.page - b.page);
    const toolBtn = (active: boolean) =>
      `flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold border transition-colors ${
        active ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200' : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
      }`;

    return (
      <div className="max-w-4xl mx-auto space-y-4 pb-16">
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => { setActivePart(null); setPdfDoc(null); setPanel(null); }} className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 shrink-0">
            <ChevronLeft className="w-4 h-4" /><span>All Parts</span>
          </button>
          <h1 className="text-sm font-bold text-slate-100 truncate">{activePart.title}</h1>
          <span className="w-16 shrink-0" />
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button onClick={toggleBookmark} className={toolBtn(Boolean(pageBookmark))}>
            <Bookmark className={`w-3.5 h-3.5 ${pageBookmark ? 'fill-current' : ''}`} /><span>{pageBookmark ? 'Bookmarked' : 'Bookmark'}</span>
          </button>
          <button onClick={() => setHighlightMode((h) => !h)} className={toolBtn(highlightMode)}>
            <Highlighter className="w-3.5 h-3.5" /><span>Highlight</span>
          </button>
          <button onClick={() => togglePanel('marks')} className={toolBtn(panel === 'marks')}>
            <span>My marks ({marks.length})</span>
          </button>
          <button onClick={() => togglePanel('summary')} className={toolBtn(panel === 'summary')}>
            <Sparkles className="w-3.5 h-3.5" /><span>Summary</span>
          </button>
          <button onClick={() => togglePanel('quiz')} className={toolBtn(panel === 'quiz')}>
            <ListChecks className="w-3.5 h-3.5" /><span>Quiz</span>
          </button>
          <button onClick={() => togglePanel('chat')} className={toolBtn(panel === 'chat')}>
            <HelpCircle className="w-3.5 h-3.5" /><span>Ask AI</span>
          </button>
        </div>

        {highlightMode && (
          <div className="flex items-center justify-center gap-3 text-[11px] text-slate-400">
            <span>Drag over the text to highlight:</span>
            {Object.entries(HIGHLIGHT_COLORS).map(([name, c]) => (
              <button
                key={name}
                onClick={() => setHighlightColor(name)}
                aria-label={`${name} highlight`}
                className={`w-6 h-6 rounded-full border-2 ${highlightColor === name ? 'border-white' : 'border-transparent'}`}
                style={{ background: c.swatch }}
              />
            ))}
          </div>
        )}

        {/* Page navigation */}
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 disabled:opacity-30">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1.5 text-xs text-slate-300">
            <input
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && goToPage(Number(pageInput))}
              onBlur={() => goToPage(Number(pageInput) || currentPage)}
              className="w-14 px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-center text-slate-100"
            />
            <span>/ {activePart.page_count}</span>
          </div>
          <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= activePart.page_count} className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 disabled:opacity-30">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* PDF canvas + highlight overlay */}
        <div className="glass-panel p-2 flex items-center justify-center overflow-auto min-h-[400px] relative">
          {rendering && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-10">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
            </div>
          )}
          <div className="relative inline-block max-w-full">
            <canvas ref={canvasRef} className="block max-w-full h-auto rounded-lg shadow-xl" />
            <div
              ref={overlayRef}
              className="absolute inset-0"
              style={{ touchAction: highlightMode ? 'none' : 'auto', cursor: highlightMode ? 'crosshair' : 'default' }}
              onPointerDown={onOverlayDown}
              onPointerMove={onOverlayMove}
              onPointerUp={onOverlayUp}
              onPointerCancel={() => { dragStart.current = null; setDraft(null); }}
            >
              {pageHighlights.map((m) => (
                <div
                  key={m.id}
                  className="absolute"
                  style={{
                    left: `${m.rect!.x * 100}%`, top: `${m.rect!.y * 100}%`,
                    width: `${m.rect!.w * 100}%`, height: `${m.rect!.h * 100}%`,
                    background: (HIGHLIGHT_COLORS[m.color] || HIGHLIGHT_COLORS.yellow).fill,
                    pointerEvents: 'none'
                  }}
                >
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => deleteMark(m.id)}
                    aria-label="Remove highlight"
                    className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-slate-900/90 text-slate-200 flex items-center justify-center"
                    style={{ pointerEvents: 'auto' }}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
              {draft && (
                <div
                  className="absolute border border-white/60"
                  style={{
                    left: `${draft.x * 100}%`, top: `${draft.y * 100}%`,
                    width: `${draft.w * 100}%`, height: `${draft.h * 100}%`,
                    background: (HIGHLIGHT_COLORS[highlightColor] || HIGHLIGHT_COLORS.yellow).fill
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* My marks panel */}
        {panel === 'marks' && (
          <div className="glass-panel p-5 space-y-3">
            <p className="text-[11px] font-bold uppercase text-slate-400">Bookmarks</p>
            {bookmarks.length === 0 ? (
              <p className="text-xs text-slate-500">No bookmarks yet. Tap “Bookmark” on any page.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {bookmarks.map((b) => (
                  <span key={b.id} className="inline-flex items-center gap-1 pl-3 pr-1.5 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-xs text-cyan-200">
                    <button onClick={() => goToPage(b.page)}>Page {b.page}</button>
                    <button onClick={() => deleteMark(b.id)} aria-label="Remove bookmark" className="p-0.5 text-cyan-300/70 hover:text-white"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-[11px] font-bold uppercase text-slate-400 pt-2">Highlighted pages</p>
            {(() => {
              const pages = Array.from(new Set<number>(marks.filter((m) => m.kind === 'highlight').map((m) => m.page))).sort((a, b) => a - b);
              return pages.length === 0 ? (
                <p className="text-xs text-slate-500">No highlights yet. Turn on “Highlight” and drag over the text.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {pages.map((pg) => (
                    <button key={pg} onClick={() => goToPage(pg)} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200">
                      Page {pg}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* Summary panel */}
        {panel === 'summary' && (
          <div className="glass-panel p-5 space-y-3">
            <p className="text-[11px] font-bold uppercase text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" /><span>Summary of “{activePart.title}”</span>
            </p>
            {summaryLoading && <p className="text-xs text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Reading the part and writing a summary...</p>}
            {summaryError && (
              <div className="space-y-2">
                <p className="text-xs text-rose-300">{summaryError}</p>
                <button onClick={loadSummary} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200">Try again</button>
              </div>
            )}
            {summary && <SummaryText text={summary} />}
            <p className="text-[10px] text-slate-500">Based only on this part's text.</p>
          </div>
        )}

        {/* Quiz panel */}
        {panel === 'quiz' && (
          <div className="glass-panel p-5 space-y-4">
            <p className="text-[11px] font-bold uppercase text-slate-400 flex items-center gap-1.5">
              <ListChecks className="w-3.5 h-3.5 text-emerald-400" /><span>Quick quiz — {activePart.title}</span>
            </p>
            {quizLoading && <p className="text-xs text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Preparing questions from this part...</p>}
            {quizError && (
              <div className="space-y-2">
                <p className="text-xs text-rose-300">{quizError}</p>
                <button onClick={loadQuiz} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200">Try again</button>
              </div>
            )}
            {quiz && !quizDone && (
              <div className="space-y-3">
                <p className="text-[11px] text-slate-500">Question {quizIndex + 1} of {quiz.length}</p>
                <p className="text-sm text-slate-100 leading-relaxed">{quiz[quizIndex].question}</p>
                <div className="space-y-2">
                  {quiz[quizIndex].options.map((opt, i) => {
                    const correct = i === quiz[quizIndex].correctIndex;
                    let cls = 'border-white/10 text-slate-200 hover:bg-white/5';
                    if (quizPicked !== null && correct) cls = 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100';
                    else if (quizPicked === i) cls = 'border-rose-500/60 bg-rose-500/10 text-rose-100';
                    return (
                      <button key={i} onClick={() => pickQuizOption(i)} disabled={quizPicked !== null}
                        className={`w-full text-left px-4 py-3 rounded-xl border text-xs flex items-start gap-3 ${cls}`}>
                        <span className="font-bold shrink-0">{String.fromCharCode(65 + i)}.</span>
                        <span className="flex-1">{opt}</span>
                        {quizPicked !== null && correct && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                        {quizPicked === i && !correct && <XCircle className="w-4 h-4 text-rose-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
                {quizPicked !== null && (
                  <>
                    {quiz[quizIndex].explanation && <div className="p-3 rounded-xl bg-white/5 text-xs text-slate-300 leading-relaxed">{quiz[quizIndex].explanation}</div>}
                    <button onClick={nextQuiz} className="w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold">
                      {quizIndex + 1 < quiz.length ? 'Next question' : 'See my score'}
                    </button>
                  </>
                )}
              </div>
            )}
            {quiz && quizDone && (
              <div className="text-center space-y-3 py-2">
                <Trophy className="w-8 h-8 text-amber-400 mx-auto" />
                <p className="text-lg font-bold text-slate-100">{quizScore} / {quiz.length}</p>
                <p className="text-xs text-slate-400">{quizScore === quiz.length ? 'Perfect — you know this part.' : 'Skim the summary or re-read the pages you missed, then try again.'}</p>
                <button onClick={() => { setQuizIndex(0); setQuizPicked(null); setQuizScore(0); setQuizDone(false); }} className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-200">Retake quiz</button>
              </div>
            )}
          </div>
        )}

        {/* AI assistant panel */}
        {panel === 'chat' && (
          <div className="glass-panel p-5 space-y-3">
            <p className="text-[11px] font-bold uppercase text-slate-400 flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-purple-400" /><span>Ask About "{activePart.title}"</span>
            </p>
            <p className="text-[10px] text-slate-500">Answers are based only on this part's text — not general knowledge.</p>

            {chatHistory.length > 0 && (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {chatHistory.map((msg, i) => (
                  <div key={i} className={`p-3 rounded-xl text-xs leading-relaxed ${msg.role === 'user' ? 'bg-cyan-500/10 text-cyan-100 ml-8' : 'bg-white/5 text-slate-300 mr-8'}`}>
                    {msg.text}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
                placeholder="Ask anything about this part..."
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-purple-500"
              />
              <button onClick={handleAsk} disabled={asking || !chatInput.trim()} className="px-4 py-2.5 rounded-xl bg-purple-500 hover:bg-purple-400 text-slate-950 disabled:opacity-40">
                {asking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---- Parts list ----
  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-12">
      <button onClick={() => onNavigate('back')} className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200">
        <ChevronLeft className="w-4 h-4" /><span>Back</span>
      </button>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-cyan-400" /><span>Smart First Aid Step1</span>
        </h1>
        <p className="text-xs text-slate-400">Read at your own pace, highlight and bookmark pages, get an AI summary, test yourself with a quick quiz, and ask the assistant anything about what you're reading.</p>
      </div>

      {parts.length === 0 ? (
        <div className="glass-panel p-10 text-center space-y-3">
          <BookOpen className="w-10 h-10 text-cyan-400 mx-auto" />
          <h2 className="text-lg font-bold text-slate-100">No content yet</h2>
          <p className="text-xs text-slate-400">Your admin hasn't uploaded any book parts yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {parts.map((p) => {
            const lastPage = progressByPart[p.id];
            const qz = quizByPart[p.id];
            return (
              <button key={p.id} onClick={() => openPart(p)} className="w-full glass-panel p-4 flex items-center gap-3 text-left hover:border-cyan-500/40 transition-colors">
                <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-cyan-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200">{p.title}</p>
                  <p className="text-[11px] text-slate-500">
                    {p.page_count} pages{lastPage ? ` · Resume at page ${lastPage}` : ''}
                  </p>
                </div>
                {qz && (
                  <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300 text-[11px] font-bold">
                    <Trophy className="w-3 h-3" />{qz.score}/{qz.total}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
