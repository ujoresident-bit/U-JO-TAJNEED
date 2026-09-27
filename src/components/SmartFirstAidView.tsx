import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, BookOpen, Send, HelpCircle, Loader2, FileText } from 'lucide-react';
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

interface SmartFirstAidViewProps {
  onNavigate: (view: string, params?: any) => void;
}

// Real PDF reader (PDF.js) with free page navigation and per-user resume
// position, plus an AI assistant strictly grounded in the currently open
// part's own extracted text.
export const SmartFirstAidView: React.FC<SmartFirstAidViewProps> = ({ onNavigate }) => {
  const [parts, setParts] = useState<BookPart[]>([]);
  const [progressByPart, setProgressByPart] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [activePart, setActivePart] = useState<BookPart | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [rendering, setRendering] = useState(false);

  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [asking, setAsking] = useState(false);
  const [showChat, setShowChat] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const user = resolveSession().user;
  const authHeaders = { 'x-telegram-user-id': user.telegramId || '', 'x-telegram-username': user.username || '' };

  useEffect(() => {
    fetch('/api/study-book', { headers: authHeaders })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setParts(data.parts || []);
          setProgressByPart(data.progressByPart || {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const openPart = async (part: BookPart) => {
    setActivePart(part);
    setChatHistory([]);
    setShowChat(false);
    const resumePage = progressByPart[part.id] || 1;
    setCurrentPage(resumePage);
    setPageInput(String(resumePage));

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

  // Save progress (debounced-by-effect: fires once per page change)
  useEffect(() => {
    if (!activePart) return;
    const t = setTimeout(() => {
      fetch(`/api/study-book/${activePart.id}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
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

  const handleAsk = async () => {
    if (!chatInput.trim() || !activePart) return;
    const question = chatInput.trim();
    setChatInput('');
    setChatHistory((h) => [...h, { role: 'user', text: question }]);
    setAsking(true);
    try {
      const res = await fetch(`/api/study-book/${activePart.id}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
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

  if (loading) {
    return <div className="text-center text-slate-500 text-sm py-16">Loading Smart First Aid Step1...</div>;
  }

  // ---- PDF Reader view ----
  if (activePart) {
    return (
      <div className="max-w-4xl mx-auto space-y-4 pb-16">
        <div className="flex items-center justify-between">
          <button onClick={() => { setActivePart(null); setPdfDoc(null); }} className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200">
            <ChevronLeft className="w-4 h-4" /><span>All Parts</span>
          </button>
          <h1 className="text-sm font-bold text-slate-100">{activePart.title}</h1>
          <button onClick={() => setShowChat((s) => !s)} className="flex items-center gap-1.5 text-xs font-semibold text-purple-400 hover:text-purple-300">
            <HelpCircle className="w-4 h-4" /><span>Ask AI</span>
          </button>
        </div>

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

        {/* PDF canvas */}
        <div className="glass-panel p-2 flex items-center justify-center overflow-auto min-h-[400px] relative">
          {rendering && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
            </div>
          )}
          <canvas ref={canvasRef} className="max-w-full rounded-lg shadow-xl" />
        </div>

        {/* AI assistant panel */}
        {showChat && (
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
      <button onClick={() => onNavigate('specialty_hub', { bankId: 'human_medicine' })} className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200">
        <ChevronLeft className="w-4 h-4" /><span>Back</span>
      </button>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-cyan-400" /><span>Smart First Aid Step1</span>
        </h1>
        <p className="text-xs text-slate-400">Read at your own pace, jump to any page, and ask the assistant anything about what you're reading.</p>
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
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
