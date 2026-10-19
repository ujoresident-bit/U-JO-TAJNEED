import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, BookOpen, Send, HelpCircle, Loader2, FileText,
  Bookmark, Highlighter, Sparkles, ListChecks, X, Trophy, CheckCircle2, XCircle,
  ZoomIn, ZoomOut, Moon, Sun, Layers, Dumbbell, Square, RotateCcw
} from 'lucide-react';
import { resolveSession } from '../services/authService';
import { startBlock } from '../services/questionBankService';
import { filtersForPart, questionsForPart } from '../services/firstAidLinkService';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
// @ts-ignore - Vite ?url import resolves to a bundled worker script URL
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface BookPart {
  id: string;
  title: string;
  pdf_url: string;
  page_count: number;
  keywords?: string | null;
}

interface Rect { x: number; y: number; w: number; h: number }

interface Mark {
  id: string;
  kind: 'highlight' | 'bookmark';
  page: number;
  color: string;
  // single box (legacy / box tool) or one rectangle per selected text line
  rect: any;
  label?: string | null;
  text?: string | null;
}

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface AiCard { front: string; back: string }

type Panel = null | 'chat' | 'summary' | 'quiz' | 'marks' | 'cards';

interface SmartFirstAidViewProps {
  onNavigate: (view: string, params?: any) => void;
  initialPartId?: string;
  initialPage?: number;
}

const HIGHLIGHT_COLORS: Record<string, { fill: string; swatch: string }> = {
  yellow: { fill: 'rgba(250, 204, 21, 0.40)', swatch: '#facc15' },
  green: { fill: 'rgba(74, 222, 128, 0.38)', swatch: '#4ade80' },
  pink: { fill: 'rgba(244, 114, 182, 0.40)', swatch: '#f472b6' },
  blue: { fill: 'rgba(96, 165, 250, 0.40)', swatch: '#60a5fa' }
};

const lsGet = (key: string, fallback: string): string => {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};
const lsSet = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch {}
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

// Merge the many small client rects of a text selection into one clean
// rectangle per visual line (normalized 0..1 against the page layer).
const mergeSelectionRects = (rects: DOMRect[], layer: DOMRect): Rect[] => {
  const usable = rects
    .filter((r) => r.width > 1 && r.height > 3)
    .sort((a, b) => (a.top + a.height / 2) - (b.top + b.height / 2) || a.left - b.left);
  const lines: { top: number; bottom: number; left: number; right: number }[] = [];
  for (const r of usable) {
    const cy = r.top + r.height / 2;
    const line = lines.find((l) => Math.abs((l.top + l.bottom) / 2 - cy) < Math.min(r.height, l.bottom - l.top) * 0.5);
    if (line) {
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
      line.left = Math.min(line.left, r.left);
      line.right = Math.max(line.right, r.right);
    } else {
      lines.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    }
  }
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return lines
    .map((l) => {
      const x = clamp((l.left - layer.left) / layer.width);
      const y = clamp((l.top - layer.top) / layer.height);
      const right = clamp((l.right - layer.left) / layer.width);
      const bottom = clamp((l.bottom - layer.top) / layer.height);
      return { x, y, w: right - x, h: bottom - y };
    })
    .filter((r) => r.w > 0.003 && r.h > 0.003);
};

// Turn a highlight into a flashcard. If the sentence around it can be found
// in the page text, make a fill-in-the-blank card; otherwise a "complete the
// point" card for longer highlights. Very short highlights without context
// make useless cards, so they are skipped.
const buildCard = (text: string, pageText: string, partTitle: string, page: number): { front: string; back: string } | null => {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 4) return null;
  const cue = `${partTitle} · p.${page}`;
  const idx = pageText ? pageText.toLowerCase().indexOf(t.toLowerCase()) : -1;
  if (idx >= 0 && t.length <= 180) {
    const lo = Math.max(0, idx - 240);
    const before = pageText.slice(lo, idx);
    const cut = Math.max(before.lastIndexOf('. '), before.lastIndexOf('; '), before.lastIndexOf(': '));
    const start = cut >= 0 ? lo + cut + 2 : (lo > 0 ? lo + before.indexOf(' ') + 1 : lo);
    const endHighlight = idx + t.length;
    const hi = Math.min(pageText.length, endHighlight + 240);
    const after = pageText.slice(endHighlight, hi);
    const m = after.search(/[.;]\s/);
    const end = m >= 0 ? endHighlight + m + 1 : hi;
    const ctxBefore = pageText.slice(start, idx);
    const ctxAfter = pageText.slice(endHighlight, end);
    if ((ctxBefore + ctxAfter).trim().length >= 12) {
      return {
        front: `${cue}\n\n${ctxBefore}_____${ctxAfter}`.trim(),
        back: `${t}\n\n“${ctxBefore}${t}${ctxAfter}”`
      };
    }
  }
  const words = t.split(' ');
  if (words.length >= 8) {
    return { front: `${cue}\n\nComplete the point:\n“${words.slice(0, 5).join(' ')} …”`, back: t };
  }
  return null;
};

// Real PDF reader (PDF.js): selectable text with true text highlighting,
// bookmarks, zoom, night mode, an AI assistant, AI summary / quiz /
// flashcards, and a bridge to the question bank — all grounded in the
// currently open part.
export const SmartFirstAidView: React.FC<SmartFirstAidViewProps> = ({ onNavigate, initialPartId, initialPage }) => {
  const [parts, setParts] = useState<BookPart[]>([]);
  const [progressByPart, setProgressByPart] = useState<Record<string, number>>({});
  const [quizByPart, setQuizByPart] = useState<Record<string, { score: number; total: number }>>({});
  const [loading, setLoading] = useState(true);

  const [activePart, setActivePart] = useState<BookPart | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [loadPct, setLoadPct] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [rendering, setRendering] = useState(false);
  const [pageHasText, setPageHasText] = useState(true);

  // Reading preferences (remembered on this device)
  const [zoom, setZoom] = useState<number>(() => Math.min(2.5, Math.max(1, Number(lsGet('ujo_fa_zoom', '1')) || 1)));
  const [night, setNight] = useState<boolean>(() => lsGet('ujo_fa_night', '0') === '1');
  const [autoCard, setAutoCard] = useState<boolean>(() => lsGet('ujo_fa_autocard', '1') === '1');

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

  // AI flashcards
  const [aiCards, setAiCards] = useState<AiCard[] | null>(null);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [cardsError, setCardsError] = useState('');
  const [cardsAdded, setCardsAdded] = useState(false);
  const [cardsAdding, setCardsAdding] = useState(false);
  const [flippedCards, setFlippedCards] = useState<Record<number, boolean>>({});

  // Marks (highlights + bookmarks)
  const [marks, setMarks] = useState<Mark[]>([]);
  const [boxMode, setBoxMode] = useState(false);
  const [highlightColor, setHighlightColor] = useState('yellow');
  const [draft, setDraft] = useState<Rect | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [pending, setPending] = useState<{ rects: Rect[]; text: string } | null>(null);
  const pendingRef = useRef<{ rects: Rect[]; text: string } | null>(null);
  const clearTimer = useRef<any>(null);
  const [toast, setToast] = useState('');
  const [practiceBusy, setPracticeBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageBoxRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const renderId = useRef(0);
  const renderTask = useRef<any>(null);
  const textLayerTask = useRef<any>(null);
  const pageTextRef = useRef('');
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const user = resolveSession().user;
  const authHeaders = { 'x-telegram-user-id': user.telegramId || '', 'x-telegram-username': user.username || '' };
  const jsonHeaders = { 'Content-Type': 'application/json', ...authHeaders };

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? '' : t)), 2200);
  };

  const openedInitial = useRef(false);

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

  // Deep link: open a specific part/page (from a question or a review card)
  useEffect(() => {
    if (openedInitial.current || !initialPartId || parts.length === 0) return;
    const target = parts.find((p) => p.id === initialPartId);
    if (target) {
      openedInitial.current = true;
      openPart(target, initialPage);
    }
  }, [parts, initialPartId]);

  const resetPartState = () => {
    setChatHistory([]);
    setPanel(null);
    setSummary(null); setSummaryError('');
    setQuiz(null); setQuizError(''); setQuizDone(false); setQuizIndex(0); setQuizPicked(null); setQuizScore(0);
    setAiCards(null); setCardsError(''); setCardsAdded(false); setFlippedCards({});
    setMarks([]); setBoxMode(false); setPending(null); pendingRef.current = null;
  };

  const openPart = async (part: BookPart, startPage?: number) => {
    setActivePart(part);
    resetPartState();
    const resumePage = startPage || progressByPart[part.id] || 1;
    setCurrentPage(resumePage);
    setPageInput(String(resumePage));
    setPdfDoc(null);
    setDocLoading(true);
    setLoadPct(0);

    fetch(`/api/study-book/${part.id}/marks`, { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => { if (d.success) setMarks(d.marks || []); })
      .catch(() => {});

    try {
      const loadingTask = pdfjsLib.getDocument({ url: part.pdf_url });
      loadingTask.onProgress = (p: { loaded: number; total?: number }) => {
        if (p.total) setLoadPct(Math.min(99, Math.round((p.loaded / p.total) * 100)));
      };
      const doc = await loadingTask.promise;
      setPdfDoc(doc);
    } catch {
      flash('Could not open this PDF. Please try again.');
    } finally {
      setDocLoading(false);
    }
  };

  // ----- Rendering: canvas (sharp on hi-dpi) + selectable text layer -----
  const renderPage = useCallback(async (doc: any, pageNum: number, zoomValue: number) => {
    if (!doc || !canvasRef.current || !pageBoxRef.current || !textLayerRef.current) return;
    const myId = ++renderId.current;
    setRendering(true);
    try {
      try { renderTask.current?.cancel?.(); } catch {}
      try { textLayerTask.current?.cancel?.(); } catch {}

      const page = await doc.getPage(pageNum);
      if (myId !== renderId.current) return;

      const base = page.getViewport({ scale: 1 });
      const available = Math.max(240, (wrapRef.current?.clientWidth || 800) - 16);
      const scale = Math.min(4, (available / base.width) * zoomValue);
      const viewport = page.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const box = pageBoxRef.current;
      box.style.width = `${viewport.width}px`;
      box.style.height = `${viewport.height}px`;
      box.style.setProperty('--total-scale-factor', String(scale));
      box.style.setProperty('--scale-round-x', '1px');
      box.style.setProperty('--scale-round-y', '1px');

      const task = page.render({
        canvas,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
      });
      renderTask.current = task;

      // Text layer (what the student selects to highlight)
      const layer = textLayerRef.current;
      layer.replaceChildren();
      const textContent = await page.getTextContent();
      if (myId !== renderId.current) return;
      const items: any[] = textContent.items || [];
      const hasText = items.some((i) => typeof i.str === 'string' && i.str.trim().length > 0);
      setPageHasText(hasText);
      pageTextRef.current = items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      if (hasText) {
        const tl = new (pdfjsLib as any).TextLayer({ textContentSource: textContent, container: layer, viewport });
        textLayerTask.current = tl;
        await tl.render().catch(() => {});
      }

      await task.promise.catch((e: any) => {
        if (e?.name !== 'RenderingCancelledException') throw e;
      });
    } catch (e: any) {
      if (e?.name !== 'RenderingCancelledException') console.warn('[FirstAid] render failed', e);
    } finally {
      if (myId === renderId.current) setRendering(false);
    }
  }, []);

  useEffect(() => {
    if (pdfDoc) renderPage(pdfDoc, currentPage, zoom);
  }, [pdfDoc, currentPage, zoom, renderPage]);

  // Re-fit the page when the window / orientation changes
  useEffect(() => {
    if (!pdfDoc) return;
    let t: any;
    const onResize = () => { clearTimeout(t); t = setTimeout(() => renderPage(pdfDoc, currentPage, zoom), 250); };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); clearTimeout(t); };
  }, [pdfDoc, currentPage, zoom, renderPage]);

  useEffect(() => {
    if (!activePart) return;
    const t = setTimeout(() => {
      fetch(`/api/study-book/${activePart.id}/progress`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ page: currentPage })
      }).catch(() => {});
      setProgressByPart((p) => ({ ...p, [activePart.id]: currentPage }));
    }, 600);
    return () => clearTimeout(t);
  }, [currentPage, activePart]);

  const goToPage = (n: number) => {
    if (!activePart) return;
    const clamped = Math.max(1, Math.min(n, activePart.page_count || n));
    setPending(null); pendingRef.current = null;
    setCurrentPage(clamped);
    setPageInput(String(clamped));
  };

  // Arrow keys to turn pages
  useEffect(() => {
    if (!activePart) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'ArrowRight') goToPage(currentPage + 1);
      if (e.key === 'ArrowLeft') goToPage(currentPage - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activePart, currentPage]);

  // ----- Zoom / night mode -----
  const changeZoom = (delta: number) => {
    const next = Math.round(Math.min(2.5, Math.max(1, zoom + delta)) * 100) / 100;
    setZoom(next);
    lsSet('ujo_fa_zoom', String(next));
  };
  const toggleNight = () => {
    setNight((n) => { lsSet('ujo_fa_night', n ? '0' : '1'); return !n; });
  };
  const toggleAutoCard = () => {
    setAutoCard((a) => { lsSet('ujo_fa_autocard', a ? '0' : '1'); return !a; });
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

  // ----- Text selection → highlight -----
  useEffect(() => {
    if (!activePart) return;
    const onSelectionChange = () => {
      const sel = window.getSelection();
      const layer = textLayerRef.current;
      if (!sel || !layer || sel.rangeCount === 0 || sel.isCollapsed) {
        // Keep the pending selection briefly: tapping the colour bar collapses it.
        if (pendingRef.current && !clearTimer.current) {
          clearTimer.current = setTimeout(() => {
            clearTimer.current = null;
            pendingRef.current = null;
            setPending(null);
          }, 900);
        }
        return;
      }
      const range = sel.getRangeAt(0);
      if (!layer.contains(range.commonAncestorContainer)) return;
      if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null; }
      const text = sel.toString().replace(/\s+/g, ' ').trim();
      if (text.length < 2) return;
      const rects = mergeSelectionRects(Array.from(range.getClientRects()), layer.getBoundingClientRect());
      if (rects.length === 0) return;
      const next = { rects, text };
      pendingRef.current = next;
      setPending(next);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null; }
    };
  }, [activePart]);

  const applyHighlight = async (color: string) => {
    const sel = pendingRef.current;
    if (!sel || !activePart) return;
    setHighlightColor(color);
    pendingRef.current = null;
    setPending(null);
    try { window.getSelection()?.removeAllRanges(); } catch {}

    const card = autoCard ? buildCard(sel.text, pageTextRef.current, activePart.title, currentPage) : null;
    try {
      const res = await fetch(`/api/study-book/${activePart.id}/marks`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          kind: 'highlight', page: currentPage, color,
          rects: sel.rects, text: sel.text, ...(card ? { card } : {})
        })
      });
      const data = await res.json();
      if (data.success) {
        setMarks((ms) => [...ms, data.mark]);
        flash(data.card ? 'Highlighted · added to your daily review' : 'Highlighted');
      } else {
        flash(data.error || 'Could not save the highlight.');
      }
    } catch {
      flash('Network error — highlight not saved.');
    }
  };

  const dismissSelection = () => {
    pendingRef.current = null;
    setPending(null);
    try { window.getSelection()?.removeAllRanges(); } catch {}
  };

  // ----- Box tool (for scanned pages that have no selectable text) -----
  const pointFromEvent = (e: React.PointerEvent) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    };
  };
  const onOverlayDown = (e: React.PointerEvent) => {
    if (!boxMode) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragStart.current = pointFromEvent(e);
    setDraft({ ...dragStart.current, w: 0, h: 0 });
  };
  const onOverlayMove = (e: React.PointerEvent) => {
    if (!boxMode || !dragStart.current) return;
    const p = pointFromEvent(e);
    const s = dragStart.current;
    setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const onOverlayUp = async () => {
    const d = draft;
    dragStart.current = null;
    setDraft(null);
    if (!boxMode || !d || !activePart || d.w < 0.01 || d.h < 0.005) return;
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

  // Swipe left/right to turn pages (only when not zoomed and not selecting)
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s || zoom > 1.05 || boxMode || pendingRef.current) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Date.now() - s.t > 450 || Math.abs(dx) < 80 || Math.abs(dy) > 45) return;
    goToPage(currentPage + (dx < 0 ? 1 : -1));
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

  // ----- AI flashcards -----
  const loadCards = async () => {
    if (!activePart || cardsLoading) return;
    setCardsLoading(true);
    setCardsError('');
    try {
      const res = await fetch(`/api/study-book/${activePart.id}/cards`, { headers: authHeaders });
      const data = await res.json();
      if (data.success) {
        setAiCards(data.cards);
        setCardsAdded(Boolean(data.added));
        setFlippedCards({});
      } else {
        setCardsError(data.error || 'Could not create flashcards.');
      }
    } catch {
      setCardsError('Network error — please try again.');
    } finally {
      setCardsLoading(false);
    }
  };

  const addCardsToReview = async () => {
    if (!activePart || cardsAdding) return;
    setCardsAdding(true);
    try {
      const res = await fetch(`/api/study-book/${activePart.id}/cards/add-to-review`, { method: 'POST', headers: jsonHeaders, body: '{}' });
      const data = await res.json();
      if (data.success) {
        setCardsAdded(true);
        flash(data.alreadyAdded ? 'Already in your daily review' : `${data.added} cards added · first review tomorrow`);
      } else {
        flash(data.error || 'Could not add the cards.');
      }
    } catch {
      flash('Network error — please try again.');
    } finally {
      setCardsAdding(false);
    }
  };

  const togglePanel = (p: Exclude<Panel, null>) => {
    setPanel((cur) => (cur === p ? null : p));
    if (p === 'summary' && !summary && !summaryLoading) loadSummary();
    if (p === 'quiz' && !quiz && !quizLoading) loadQuiz();
    if (p === 'cards' && !aiCards && !cardsLoading) loadCards();
  };

  // ----- Question bank bridge -----
  const linkedQuestionCount = useMemo(
    () => (activePart ? questionsForPart(activePart).length : 0),
    [activePart]
  );

  const practiceThisTopic = async () => {
    if (!activePart || practiceBusy) return;
    const filters = filtersForPart(activePart);
    if (!filters) return;
    setPracticeBusy(true);
    try {
      const block = await startBlock(
        user.telegramId || '',
        { ...filters, statusFilter: 'ALL', includeQBankBasic: true, questionCount: Math.min(20, linkedQuestionCount) },
        'human_medicine'
      );
      onNavigate('question_screen', { blockId: block.id });
    } catch (err: any) {
      flash(err?.message || 'Could not start the practice block.');
    } finally {
      setPracticeBusy(false);
    }
  };

  if (loading) {
    return <div className="text-center text-slate-500 text-sm py-16">Loading Smart First Aid Step1...</div>;
  }

  // ---- PDF Reader view ----
  if (activePart) {
    const pageHighlights = marks.filter((m) => m.kind === 'highlight' && m.page === currentPage && m.rect);
    const bookmarks = marks.filter((m) => m.kind === 'bookmark').sort((a, b) => a.page - b.page);
    const highlights = marks.filter((m) => m.kind === 'highlight').sort((a, b) => a.page - b.page);
    const toolBtn = (active: boolean) =>
      `flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold border transition-colors ${
        active ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200' : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
      }`;

    return (
      <div className="max-w-4xl mx-auto space-y-4 pb-28">
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => { setActivePart(null); setPdfDoc(null); setPanel(null); dismissSelection(); }} className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 shrink-0">
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
          <button onClick={() => togglePanel('marks')} className={toolBtn(panel === 'marks')}>
            <Highlighter className="w-3.5 h-3.5" /><span>My marks ({marks.length})</span>
          </button>
          <button onClick={() => togglePanel('summary')} className={toolBtn(panel === 'summary')}>
            <Sparkles className="w-3.5 h-3.5" /><span>Summary</span>
          </button>
          <button onClick={() => togglePanel('cards')} className={toolBtn(panel === 'cards')}>
            <Layers className="w-3.5 h-3.5" /><span>Cards</span>
          </button>
          <button onClick={() => togglePanel('quiz')} className={toolBtn(panel === 'quiz')}>
            <ListChecks className="w-3.5 h-3.5" /><span>Quiz</span>
          </button>
          <button onClick={() => togglePanel('chat')} className={toolBtn(panel === 'chat')}>
            <HelpCircle className="w-3.5 h-3.5" /><span>Ask AI</span>
          </button>
          {linkedQuestionCount > 0 && (
            <button onClick={practiceThisTopic} disabled={practiceBusy} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold border bg-emerald-500/15 border-emerald-500/40 text-emerald-200 disabled:opacity-50">
              {practiceBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Dumbbell className="w-3.5 h-3.5" />}
              <span>Practice questions ({linkedQuestionCount})</span>
            </button>
          )}
        </div>

        {/* Reading controls */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <div className="flex items-center gap-1 rounded-xl bg-slate-900 border border-slate-800 p-1">
            <button onClick={() => changeZoom(-0.25)} disabled={zoom <= 1} aria-label="Zoom out" className="p-1.5 rounded-lg text-slate-300 disabled:opacity-30"><ZoomOut className="w-4 h-4" /></button>
            <button onClick={() => { setZoom(1); lsSet('ujo_fa_zoom', '1'); }} className="px-1.5 text-[11px] font-bold text-slate-300 min-w-[42px]">{Math.round(zoom * 100)}%</button>
            <button onClick={() => changeZoom(0.25)} disabled={zoom >= 2.5} aria-label="Zoom in" className="p-1.5 rounded-lg text-slate-300 disabled:opacity-30"><ZoomIn className="w-4 h-4" /></button>
          </div>
          <button onClick={toggleNight} className={toolBtn(night)}>
            {night ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}<span>{night ? 'Day page' : 'Night page'}</span>
          </button>
          {!pageHasText && (
            <button onClick={() => setBoxMode((b) => !b)} className={toolBtn(boxMode)}>
              <Square className="w-3.5 h-3.5" /><span>Box highlight</span>
            </button>
          )}
        </div>

        {boxMode && (
          <div className="flex items-center justify-center gap-3 text-[11px] text-slate-400">
            <span>Drag over the area to highlight:</span>
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
        {!boxMode && pageHasText && (
          <p className="text-center text-[11px] text-slate-500">Select any text on the page (press and hold on a phone) to highlight it.</p>
        )}
        {!pageHasText && !rendering && (
          <p className="text-center text-[11px] text-amber-300/80">This page is an image with no selectable text — use “Box highlight”.</p>
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

        {/* PDF canvas + text layer + highlights */}
        <div
          ref={wrapRef}
          className="glass-panel p-2 overflow-auto min-h-[400px] relative"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {(rendering || docLoading) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/30 z-20 pointer-events-none">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
              {docLoading && loadPct > 0 && <span className="text-[11px] text-slate-200">Loading book… {loadPct}%</span>}
            </div>
          )}
          <div className="flex justify-center">
            <div ref={pageBoxRef} className="relative shrink-0 bg-white rounded-lg shadow-xl overflow-hidden" style={{ minHeight: 300 }}>
              <canvas
                ref={canvasRef}
                className="block"
                style={night ? { filter: 'invert(0.92) hue-rotate(180deg)' } : undefined}
              />
              {/* Saved highlights sit between the page and the (invisible) text */}
              <div className="absolute inset-0 pointer-events-none" style={night ? undefined : { mixBlendMode: 'multiply' }}>
                {pageHighlights.flatMap((m) => {
                  const list: Rect[] = m.rect?.rects ? m.rect.rects : [m.rect as Rect];
                  return list.map((r, i) => (
                    <div
                      key={`${m.id}-${i}`}
                      className="absolute rounded-[2px]"
                      style={{
                        left: `${r.x * 100}%`, top: `${r.y * 100}%`,
                        width: `${r.w * 100}%`, height: `${r.h * 100}%`,
                        background: (HIGHLIGHT_COLORS[m.color] || HIGHLIGHT_COLORS.yellow).fill
                      }}
                    />
                  ));
                })}
                {/* The selection being edited */}
                {pending?.rects.map((r, i) => (
                  <div
                    key={`p-${i}`}
                    className="absolute rounded-[2px]"
                    style={{
                      left: `${r.x * 100}%`, top: `${r.y * 100}%`,
                      width: `${r.w * 100}%`, height: `${r.h * 100}%`,
                      background: (HIGHLIGHT_COLORS[highlightColor] || HIGHLIGHT_COLORS.yellow).fill,
                      outline: '1px dashed rgba(34,211,238,0.8)'
                    }}
                  />
                ))}
              </div>
              <div ref={textLayerRef} className="ujo-textlayer" style={{ pointerEvents: boxMode ? 'none' : 'auto' }} />
              <div
                ref={overlayRef}
                className="absolute inset-0"
                style={{ pointerEvents: boxMode ? 'auto' : 'none', touchAction: boxMode ? 'none' : 'auto', cursor: boxMode ? 'crosshair' : 'default' }}
                onPointerDown={onOverlayDown}
                onPointerMove={onOverlayMove}
                onPointerUp={onOverlayUp}
                onPointerCancel={() => { dragStart.current = null; setDraft(null); }}
              >
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
            <p className="text-[11px] font-bold uppercase text-slate-400 pt-2">Highlights</p>
            {highlights.length === 0 ? (
              <p className="text-xs text-slate-500">No highlights yet. Select text on the page and choose a colour.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {highlights.map((h) => (
                  <div key={h.id} className="flex items-start gap-2 p-2.5 rounded-xl bg-white/5 border border-white/10">
                    <span className="w-2.5 h-2.5 rounded-full mt-1 shrink-0" style={{ background: (HIGHLIGHT_COLORS[h.color] || HIGHLIGHT_COLORS.yellow).swatch }} />
                    <button onClick={() => goToPage(h.page)} className="flex-1 text-left text-xs text-slate-200 leading-relaxed">
                      {h.text ? <span className="line-clamp-3">{h.text}</span> : <span className="text-slate-500">Highlighted area</span>}
                      <span className="block text-[10px] text-slate-500 mt-0.5">Page {h.page}</span>
                    </button>
                    <button onClick={() => deleteMark(h.id)} aria-label="Remove highlight" className="p-1 text-slate-400 hover:text-rose-400 shrink-0"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            )}
            <label className="flex items-center gap-2 pt-2 text-[11px] text-slate-400 cursor-pointer select-none">
              <input type="checkbox" checked={autoCard} onChange={toggleAutoCard} className="accent-cyan-400" />
              <span>Turn new highlights into flashcards for my daily review</span>
            </label>
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

        {/* AI flashcards panel */}
        {panel === 'cards' && (
          <div className="glass-panel p-5 space-y-3">
            <p className="text-[11px] font-bold uppercase text-slate-400 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-amber-300" /><span>Flashcards — {activePart.title}</span>
            </p>
            {cardsLoading && <p className="text-xs text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Writing flashcards from this part...</p>}
            {cardsError && (
              <div className="space-y-2">
                <p className="text-xs text-rose-300">{cardsError}</p>
                <button onClick={loadCards} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200">Try again</button>
              </div>
            )}
            {aiCards && (
              <>
                <div className="space-y-2">
                  {aiCards.map((c, i) => (
                    <button
                      key={i}
                      onClick={() => setFlippedCards((f) => ({ ...f, [i]: !f[i] }))}
                      className="w-full text-left p-3 rounded-xl bg-white/5 border border-white/10"
                    >
                      <span className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${flippedCards[i] ? 'text-emerald-400' : 'text-cyan-400'}`}>
                        {flippedCards[i] ? 'Answer' : `Card ${i + 1} — tap to reveal`}
                      </span>
                      <span className={`block text-xs leading-relaxed ${flippedCards[i] ? 'text-emerald-100' : 'text-slate-100'}`}>
                        {flippedCards[i] ? c.back : c.front}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={addCardsToReview}
                  disabled={cardsAdding || cardsAdded}
                  className="w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {cardsAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : cardsAdded ? <CheckCircle2 className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
                  <span>{cardsAdded ? 'In your daily review' : `Add all ${aiCards.length} to my daily review`}</span>
                </button>
                <p className="text-[10px] text-slate-500">Cards are written from this part's text only. Review them with the Review card in the Human Medicine hub.</p>
              </>
            )}
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

        {/* Floating highlight bar — appears when text is selected */}
        {pending && (
          <div
            className="fixed left-1/2 -translate-x-1/2 bottom-5 z-50 flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-slate-900/95 border border-white/15 shadow-2xl backdrop-blur"
            style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
          >
            <Highlighter className="w-4 h-4 text-slate-400" />
            {Object.entries(HIGHLIGHT_COLORS).map(([name, c]) => (
              <button
                key={name}
                onClick={() => applyHighlight(name)}
                aria-label={`Highlight ${name}`}
                className="w-8 h-8 rounded-full border-2 border-white/30 active:scale-90 transition-transform"
                style={{ background: c.swatch }}
              />
            ))}
            <button
              onClick={toggleAutoCard}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border ${autoCard ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200' : 'border-white/15 text-slate-400'}`}
            >
              {autoCard ? '+ Review ✓' : '+ Review'}
            </button>
            <button onClick={dismissSelection} aria-label="Cancel" className="p-1 text-slate-400"><X className="w-4 h-4" /></button>
          </div>
        )}

        {toast && (
          <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-50 px-4 py-2 rounded-xl bg-slate-900/95 border border-cyan-500/30 text-xs text-cyan-100 shadow-xl">
            {toast}
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
        <p className="text-xs text-slate-400">Read at your own pace, highlight text, turn highlights and AI flashcards into your daily review, test yourself, and practice the matching exam questions.</p>
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
            const pct = lastPage && p.page_count ? Math.min(100, Math.round((lastPage / p.page_count) * 100)) : 0;
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
                  {pct > 0 && (
                    <div className="mt-1.5 h-1 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full bg-cyan-400/70" style={{ width: `${pct}%` }} />
                    </div>
                  )}
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
