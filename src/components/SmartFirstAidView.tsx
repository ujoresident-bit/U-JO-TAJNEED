import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, BookOpen, Send, Sparkles, CheckCircle2, HelpCircle, Layers, Loader2 } from 'lucide-react';
import { resolveSession } from '../services/authService';

interface StudyTopic {
  id: string;
  system_name: string;
  topic_title: string;
  content: string;
  high_yield_facts: string[];
}

interface SmartFirstAidViewProps {
  onNavigate: (view: string, params?: any) => void;
}

export const SmartFirstAidView: React.FC<SmartFirstAidViewProps> = ({ onNavigate }) => {
  const [topics, setTopics] = useState<StudyTopic[]>([]);
  const [readIds, setReadIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSystem, setActiveSystem] = useState<string | null>(null);
  const [activeTopic, setActiveTopic] = useState<StudyTopic | null>(null);

  const [related, setRelated] = useState<{ questions: any[]; flashcards: any[] }>({ questions: [], flashcards: [] });

  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [asking, setAsking] = useState(false);

  const user = resolveSession().user;
  const authHeaders = { 'x-telegram-user-id': user.telegramId || '', 'x-telegram-username': user.username || '' };

  useEffect(() => {
    fetch('/api/study-topics', { headers: authHeaders })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setTopics(data.topics || []);
          setReadIds(data.readTopicIds || []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const systems = useMemo(() => Array.from(new Set(topics.map((t) => t.system_name))), [topics]);
  const topicsInSystem = (sys: string) => topics.filter((t) => t.system_name === sys);

  const openTopic = (topic: StudyTopic) => {
    setActiveTopic(topic);
    setChatHistory([]);
    setRelated({ questions: [], flashcards: [] });

    fetch('/api/study-topics/' + topic.id + '/mark-read', { method: 'POST', headers: authHeaders })
      .then(() => setReadIds((prev) => (prev.includes(topic.id) ? prev : [...prev, topic.id])))
      .catch(() => {});

    fetch('/api/study-topics/' + topic.id + '/related')
      .then((res) => res.json())
      .then((data) => { if (data.success) setRelated({ questions: data.questions || [], flashcards: data.flashcards || [] }); })
      .catch(() => {});
  };

  const handleAsk = async () => {
    if (!chatInput.trim() || !activeTopic) return;
    const question = chatInput.trim();
    setChatInput('');
    setChatHistory((h) => [...h, { role: 'user', text: question }]);
    setAsking(true);
    try {
      const res = await fetch(`/api/study-topics/${activeTopic.id}/ask`, {
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

  // ---- Topic reading view ----
  if (activeTopic) {
    return (
      <div className="max-w-3xl mx-auto space-y-6 pb-16">
        <button onClick={() => setActiveTopic(null)} className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200">
          <ChevronLeft className="w-4 h-4" /><span>Back to {activeTopic.system_name}</span>
        </button>

        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-widest text-cyan-400 font-bold">{activeTopic.system_name}</p>
          <h1 className="text-2xl font-bold text-slate-100">{activeTopic.topic_title}</h1>
        </div>

        <div className="glass-panel p-6 space-y-4">
          <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{activeTopic.content}</p>

          {activeTopic.high_yield_facts?.length > 0 && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2">
              <p className="text-[11px] font-bold uppercase text-amber-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /><span>High-Yield Facts</span>
              </p>
              <ul className="space-y-1">
                {activeTopic.high_yield_facts.map((f, i) => (
                  <li key={i} className="text-xs text-amber-100 flex items-start gap-2">
                    <span className="text-amber-400 mt-0.5">•</span><span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Related practice — auto-linked from the existing question bank & flashcards */}
        {(related.questions.length > 0 || related.flashcards.length > 0) && (
          <div className="glass-panel p-5 space-y-3">
            <p className="text-[11px] font-bold uppercase text-slate-400 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-emerald-400" /><span>Related Practice</span>
            </p>
            {related.questions.length > 0 && (
              <div>
                <p className="text-[10px] text-slate-500 mb-1">{related.questions.length} related question(s) in your question bank</p>
                <button onClick={() => onNavigate('bank', { bankId: 'human_medicine' })} className="text-xs text-cyan-400 hover:underline">
                  Browse related questions →
                </button>
              </div>
            )}
            {related.flashcards.length > 0 && (
              <div>
                <p className="text-[10px] text-slate-500 mb-1">{related.flashcards.length} related flashcard(s)</p>
                <button onClick={() => onNavigate('flashcards')} className="text-xs text-cyan-400 hover:underline">
                  Review related flashcards →
                </button>
              </div>
            )}
          </div>
        )}

        {/* AI assistant — strictly grounded in this topic's own text */}
        <div className="glass-panel p-5 space-y-3">
          <p className="text-[11px] font-bold uppercase text-slate-400 flex items-center gap-1.5">
            <HelpCircle className="w-3.5 h-3.5 text-purple-400" /><span>Ask About This Topic</span>
          </p>
          <p className="text-[10px] text-slate-500">Answers are based only on this topic's text — not general knowledge.</p>

          {chatHistory.length > 0 && (
            <div className="space-y-2 max-h-72 overflow-y-auto">
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
              placeholder="e.g. What does elevated BNP indicate?"
              className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-purple-500"
            />
            <button onClick={handleAsk} disabled={asking || !chatInput.trim()} className="px-4 py-2.5 rounded-xl bg-purple-500 hover:bg-purple-400 text-slate-950 disabled:opacity-40">
              {asking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Topic list within a chosen system ----
  if (activeSystem) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 pb-12">
        <button onClick={() => setActiveSystem(null)} className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200">
          <ChevronLeft className="w-4 h-4" /><span>Back to Systems</span>
        </button>
        <h1 className="text-xl font-bold text-slate-100">{activeSystem}</h1>
        <div className="space-y-2">
          {topicsInSystem(activeSystem).map((t) => (
            <button key={t.id} onClick={() => openTopic(t)} className="w-full glass-panel p-4 flex items-center justify-between text-left hover:border-cyan-500/40 transition-colors">
              <span className="text-sm font-medium text-slate-200">{t.topic_title}</span>
              {readIds.includes(t.id) && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---- Systems overview ----
  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <button onClick={() => onNavigate('specialty_hub', { bankId: 'human_medicine' })} className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200">
        <ChevronLeft className="w-4 h-4" /><span>Back</span>
      </button>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-cyan-400" /><span>Smart First Aid Step1</span>
        </h1>
        <p className="text-xs text-slate-400">Browse by system, read high-yield content, and ask the assistant anything about what you're studying.</p>
      </div>

      {systems.length === 0 ? (
        <div className="glass-panel p-10 text-center space-y-3">
          <BookOpen className="w-10 h-10 text-cyan-400 mx-auto" />
          <h2 className="text-lg font-bold text-slate-100">No content yet</h2>
          <p className="text-xs text-slate-400">Your admin hasn't added any study content yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {systems.map((sys) => {
            const sysTopics = topicsInSystem(sys);
            const readCount = sysTopics.filter((t) => readIds.includes(t.id)).length;
            return (
              <button key={sys} onClick={() => setActiveSystem(sys)} className="glass-panel p-5 text-left space-y-2 hover:border-cyan-500/40 transition-colors">
                <h2 className="text-sm font-bold text-slate-100">{sys}</h2>
                <p className="text-[11px] text-slate-500">{sysTopics.length} topics · {readCount} read</p>
                <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                  <div className="bg-cyan-500 h-full rounded-full" style={{ width: `${sysTopics.length ? (readCount / sysTopics.length) * 100 : 0}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
