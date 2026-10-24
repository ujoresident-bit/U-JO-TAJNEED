import { useBlocksSynced } from './useBlocksSynced';
import React, { useState, useMemo, useEffect, useDeferredValue } from 'react';
import {
  Filter,
  BookOpen,
  Play,
  Layers,
  Calendar,
  Lock,
  RotateCcw,
  Sliders,
  Check,
  CreditCard,
  AlertTriangle,
  RefreshCw,
  X,
  HelpCircle,
  CheckCircle2,
  Clock,
  Search,
  ChevronRight
} from 'lucide-react';
import { PerfStyles, CountUp } from './PerfKit';
import MajorsMap from './MajorsMap';
import {
  getQuestionBankMeta,
  getFilteredQuestions,
  startBlock,
  getStoredQuestions,
  getUserQuestionStatusSets,
  syncQuestionsWithSupabase
} from '../services/questionBankService';
import {
  getQuestionStatusCounts,
  fetchResetCountFromSupabase,
  resetUserQuestionBankProgress
} from '../services/progressService';
import {
  resolveSession,
  getCanonicalTelegramUser,
  getCanonicalTelegramUserId,
  getCurrentUser,
  verifyTelegramAdminAuthorization
} from '../services/authService';
import { syncSubscriptionFromSupabase } from '../services/subscriptionService';
import { BlockFilters, QuestionStatusFilter, Question } from '../types';

interface QuestionBankViewProps {
  onNavigate: (view: string, params?: any) => void;
  bankId?: string;
}

const QB_CSS = `
.qb{--ink:#EAF1F7;--dim:#93A3B6;--ice:#CFEFF8;--cy:#4FD6EC;--am:#E8B66A;--gr:#6FE0B4;--rose:#FF8FA3;--serif:'Instrument Serif',Georgia,serif;--sans:'Geist',system-ui,sans-serif;--mono:'Geist Mono',ui-monospace,monospace;color:var(--ink);font-family:var(--sans);max-width:1040px;margin:0 auto;overflow-x:clip}
.qb *{box-sizing:border-box}
.qb button{font-family:inherit;cursor:pointer}
.qb button:focus-visible{outline:2px solid var(--cy);outline-offset:3px}
.qb-mono{font:500 10.5px var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--dim)}
.qb-trunc{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;max-width:55vw;vertical-align:bottom}
.qb-top{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.qb-tl{display:flex;gap:8px;flex-wrap:wrap}
.qb-tbtn{min-height:40px;padding:0 14px;border-radius:999px;border:1px solid rgba(207,239,248,.14);background:rgba(207,239,248,.04);color:var(--dim);font:500 12px var(--sans);display:inline-flex;align-items:center;gap:6px}
.qb-tbtn:hover:not(:disabled){color:var(--ink)}
.qb-tbtn.danger{color:var(--rose);border-color:rgba(255,143,163,.3)}
.qb-tbtn:disabled{opacity:.45;cursor:not-allowed}
.qb-hero{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;align-items:end;margin-top:14px}
.qb-h1{margin:8px 0 0;font:400 clamp(42px,11vw,72px)/.96 var(--serif);letter-spacing:-.015em;color:var(--ink)}
.qb-h1 em{color:var(--ice)}
.qb-sub{margin:10px 0 0;color:var(--dim);font-size:14px;line-height:1.5;max-width:38ch}
.qb-net{position:relative;height:300px;margin:6px -4px 0;-webkit-mask-image:radial-gradient(ellipse 74% 74% at 50% 50%,#000 60%,transparent 100%);mask-image:radial-gradient(ellipse 74% 74% at 50% 50%,#000 60%,transparent 100%)}
.qb-net canvas{width:100%;height:100%;display:block;cursor:grab}
.qb-nethint{margin:0;text-align:center}
@media(min-width:860px){.qb-hero{grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:24px}.qb-net{height:430px;margin:0}}
.qb-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:28px;margin-top:18px}
@media(min-width:860px){.qb-grid{grid-template-columns:minmax(0,1fr) 340px;gap:36px;align-items:start}}
.qb-sec{margin-top:26px}.qb-sec:first-child{margin-top:0}
.qb-sh{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:12px}
.qb-sh h2{margin:0;font:400 26px/1 var(--serif);color:var(--ink)}
.qb-sh .qb-mono{white-space:nowrap}
.qb-tiles{display:flex;gap:10px;overflow-x:auto;padding:2px 2px 8px;margin:0 -2px;scrollbar-width:none}
.qb-tiles::-webkit-scrollbar{display:none}
.qb-tile{flex:0 0 auto;min-width:118px;text-align:left;padding:14px 16px;border-radius:20px;border:1px solid rgba(207,239,248,.09);background:linear-gradient(160deg,rgba(207,239,248,.05),rgba(207,239,248,.012));color:var(--ink);transition:all .3s}
.qb-tile b{display:block;font:400 32px/1 var(--serif);font-variant-numeric:tabular-nums;margin-top:8px}
.qb-tile[aria-pressed=true]{border-color:rgba(var(--t),.55);background:linear-gradient(160deg,rgba(var(--t),.16),rgba(var(--t),.03));box-shadow:0 18px 50px -24px rgba(var(--t),.6)}
.qb-tile[aria-pressed=true] .qb-mono{color:rgb(var(--t))}
.t-all{--t:79,214,236}.t-done{--t:111,224,180}.t-inc{--t:232,182,106}.t-new{--t:180,168,245}
.qb-chips{display:flex;flex-wrap:wrap;gap:8px}
.qb-chip{display:inline-flex;align-items:center;gap:8px;min-height:42px;padding:0 15px;border-radius:999px;border:1px solid rgba(207,239,248,.13);background:rgba(207,239,248,.035);color:#D3DDE8;font:500 13.5px var(--sans);transition:all .25s;max-width:100%}
.qb-chip i{font:500 11px var(--mono);font-style:normal;color:var(--dim);font-variant-numeric:tabular-nums}
.qb-chip:hover{border-color:rgba(79,214,236,.45)}
.qb-chip[aria-pressed=true]{background:linear-gradient(180deg,#DDF4FB,#BFE6F2);color:#03131B;border-color:transparent;box-shadow:0 10px 30px -14px rgba(79,214,236,.7)}
.qb-chip[aria-pressed=true] i{color:#33576a}
.qb-seg{display:inline-grid;grid-auto-flow:column;gap:4px;padding:4px;border-radius:16px;background:rgba(207,239,248,.05);max-width:100%;overflow-x:auto}
.qb-seg button{min-height:42px;padding:0 18px;border:0;border-radius:12px;background:none;color:var(--dim);font:600 13px var(--sans);white-space:nowrap}
.qb-seg button[aria-pressed=true]{background:rgba(79,214,236,.18);color:var(--cy)}
.qb-row{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;text-align:left;padding:16px 18px;border-radius:20px;border:1px solid rgba(207,239,248,.09);background:linear-gradient(160deg,rgba(207,239,248,.05),rgba(207,239,248,.012));color:var(--ink)}
.qb-row:hover{border-color:rgba(79,214,236,.4)}
.qb-row b{display:block;font:400 22px/1.1 var(--serif)}
.qb-row .s{display:block;margin-top:4px;color:var(--dim);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qb-selt{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.qb-selt .qb-chip{min-height:32px;padding:0 11px;font-size:12px;background:rgba(79,214,236,.12);border-color:rgba(79,214,236,.35);color:var(--ice)}
.qb-aside{display:none}
@media(min-width:860px){.qb-aside{display:block}}
.qb-block{border-radius:26px;padding:22px;border:1px solid rgba(79,214,236,.22);background:linear-gradient(160deg,rgba(79,214,236,.09),rgba(207,239,248,.02) 60%);box-shadow:0 30px 80px -44px rgba(79,214,236,.45);position:sticky;top:76px}
.qb-ring{position:relative;width:132px;height:132px;margin:2px auto 6px}
.qb-ring svg{width:100%;height:100%;transform:rotate(-90deg)}
.qb-ring .c{position:absolute;inset:0;display:grid;place-items:center;text-align:center}
.qb-ring b{display:block;font:400 40px/1 var(--serif);font-variant-numeric:tabular-nums}
.qb-ring .qb-mono{font-size:9.5px}
.qb-len{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:8px}
.qb-len button{min-height:44px;border-radius:12px;border:1px solid rgba(207,239,248,.13);background:rgba(207,239,248,.035);color:var(--ink);font:500 14px var(--mono)}
.qb-len button[aria-pressed=true]{background:rgba(79,214,236,.2);border-color:rgba(79,214,236,.6);color:var(--cy)}
.qb-sum{margin:16px 0 0;padding:0;list-style:none;display:grid;gap:8px;font-size:12.5px}
.qb-sum li{display:flex;justify-content:space-between;gap:14px}
.qb-sum li span:first-child{color:var(--dim);flex:none}
.qb-sum li span:last-child{text-align:right;color:#D8E2EC;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qb-go{margin-top:18px;width:100%;min-height:58px;border:0;border-radius:16px;display:flex;align-items:center;justify-content:space-between;padding:0 10px 0 22px;font:600 15px var(--sans);color:#03131B;background:linear-gradient(180deg,#DDF4FB,#BFE6F2);box-shadow:0 14px 50px -14px rgba(79,214,236,.65);transition:transform .25s}
.qb-go:hover:not(:disabled){transform:translateY(-2px)}
.qb-go .a{width:40px;height:40px;border-radius:12px;background:#03131B;color:var(--ice);display:grid;place-items:center;flex:none}
.qb-go:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
.qb-go.sub-b{background:linear-gradient(180deg,#F6D9A6,#E8B66A);color:#1a1204}.qb-go.sub-b .a{background:#1a1204;color:var(--am)}
.qb-warn{margin-top:14px;padding:12px 14px;border-radius:14px;border:1px solid rgba(232,182,106,.3);background:rgba(232,182,106,.08);color:#F2D9A8;font-size:12.5px;line-height:1.5}
.qb-err{margin-top:14px;padding:12px 14px;border-radius:14px;border:1px solid rgba(255,143,163,.35);background:rgba(255,143,163,.08);color:var(--rose);font-size:12.5px;display:flex;gap:8px;align-items:center}
.qb-ok{margin-top:14px;padding:12px 14px;border-radius:14px;border:1px solid rgba(111,224,180,.35);background:rgba(111,224,180,.08);color:var(--gr);font-size:12.5px;display:flex;gap:8px;align-items:center}
.qb-card{padding:18px;border-radius:22px;border:1px solid rgba(207,239,248,.1);background:linear-gradient(160deg,rgba(207,239,248,.05),rgba(207,239,248,.012))}
.qb-amber{border-color:rgba(232,182,106,.3)}
.qb-pulse{animation:pf-fade 1.2s ease infinite alternate}
.qb-modal{position:relative;width:100%;max-width:440px;padding:22px;border-radius:24px;border:1px solid rgba(255,143,163,.3);background:linear-gradient(180deg,#10161d,#0a0e13);display:grid;gap:16px}
.qb-x{position:absolute;top:12px;right:12px;width:38px;height:38px;border-radius:12px;border:0;background:none;color:var(--dim);display:grid;place-items:center}
.qb-mi{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;color:var(--rose);border:1px solid rgba(255,143,163,.3);background:rgba(255,143,163,.08);flex:none}
.qb-mh{margin:0;font:400 24px/1.1 var(--serif);color:var(--ink)}
.qb-mb{font-size:12.5px;line-height:1.55;color:var(--dim);padding:14px;border-radius:14px;background:rgba(0,0,0,.35);border:1px solid rgba(207,239,248,.08)}
.qb-bar{position:fixed;left:0;right:0;bottom:0;z-index:20;padding:10px max(16px,env(safe-area-inset-right,0px)) calc(10px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));background:linear-gradient(180deg,rgba(7,9,12,0),rgba(7,9,12,.92) 30%);pointer-events:none}
.qb-bar .in{pointer-events:auto;display:flex;align-items:center;gap:12px;max-width:1040px;margin:0 auto;padding:10px 10px 10px 18px;border-radius:20px;border:1px solid rgba(79,214,236,.28);background:#0c141a;box-shadow:0 20px 60px -20px rgba(79,214,236,.5)}
.qb-bar .n{font:400 30px/1 var(--serif);font-variant-numeric:tabular-nums}
.qb-bar .qb-go{margin:0 0 0 auto;flex:1;min-height:52px;max-width:260px}
@media(min-width:860px){.qb-bar{display:none}}
@media(prefers-reduced-motion:reduce){.qb *{animation:none!important;transition:none!important}}
`;

// Searchable multi-select sheet for topics (there can be hundreds of them).
const TopicPicker: React.FC<{
  open: boolean;
  onClose: () => void;
  topics: string[];
  counts: Record<string, number>;
  selected: string[];
  onToggle: (t: string) => void;
  onClear: () => void;
}> = ({ open, onClose, topics, counts, selected, onToggle, onClear }) => {
  const [query, setQuery] = useState('');
  useEffect(() => { if (open) setQuery(''); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  const q = query.trim().toLowerCase();
  const list = useMemo(() => {
    const base = q ? topics.filter((t) => t.toLowerCase().includes(q)) : topics;
    return [...base].sort((a, b) => {
      const sa = selected.includes(a) ? 0 : 1;
      const sb = selected.includes(b) ? 0 : 1;
      return sa - sb || a.localeCompare(b);
    });
  }, [topics, q, selected]);

  if (!open) return null;
  const isAll = selected.includes('All');
  const selCount = isAll ? 0 : selected.length;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Choose topics">
      <div className="pf-fade absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="pf-sheet relative w-full sm:max-w-lg max-h-[86vh] flex flex-col rounded-t-3xl sm:rounded-3xl border border-white/10 bg-[#0b1016] shadow-2xl">
        <div className="p-5 pb-3 space-y-3 border-b border-white/[0.07]">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Choose topics</h3>
              <p className="text-[11px] text-slate-500">{topics.length} topics available</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search topics..."
              className="w-full pl-10 pr-9 py-3 rounded-xl bg-white/[0.05] border border-white/[0.08] focus:border-cyan-400/60 focus:bg-white/[0.07] outline-none text-sm text-slate-100 placeholder:text-slate-600 transition-colors"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-500 hover:text-white" aria-label="Clear search">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {selCount > 0 && (
            <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
              {selected.map((t) => (
                <button key={t} onClick={() => onToggle(t)} className="pf-pop inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-cyan-500/20 border border-cyan-400/40 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/30">
                  <span className="max-w-[10rem] truncate">{t}</span><X className="w-3 h-3" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {!q && (
            <button
              onClick={onClear}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-colors ${isAll ? 'bg-cyan-500/15 border border-cyan-400/40' : 'hover:bg-white/[0.05] border border-transparent'}`}
            >
              <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${isAll ? 'bg-cyan-400 border-cyan-300' : 'border-white/20'}`}>
                {isAll && <Check className="w-3.5 h-3.5 text-slate-950 pf-check" />}
              </span>
              <span className="flex-1 text-sm font-semibold text-slate-100">All topics</span>
            </button>
          )}
          {list.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">No topics match "{query}".</div>
          ) : (
            list.map((t) => {
              const on = !isAll && selected.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => onToggle(t)}
                  className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-colors border ${on ? 'bg-cyan-500/15 border-cyan-400/40' : 'border-transparent hover:bg-white/[0.05]'}`}
                >
                  <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${on ? 'bg-cyan-400 border-cyan-300' : 'border-white/20'}`}>
                    {on && <Check className="w-3.5 h-3.5 text-slate-950 pf-check" />}
                  </span>
                  <span className="flex-1 text-sm text-slate-200">{t}</span>
                  <span className="text-[11px] tabular-nums text-slate-500 px-2 py-0.5 rounded-full bg-white/[0.05]">{counts[t] ?? 0}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="p-4 border-t border-white/[0.07] flex items-center gap-3">
          <button
            onClick={onClear}
            disabled={isAll}
            className="px-4 py-3 rounded-xl text-xs font-semibold text-slate-300 border border-white/10 hover:bg-white/5 disabled:opacity-40 transition-colors"
          >
            Clear
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-black uppercase tracking-wider shadow-lg shadow-cyan-500/25 active:scale-[.98] transition-all"
          >
            {isAll ? 'Done' : `Done · ${selCount} selected`}
          </button>
        </div>
      </div>
    </div>
  );
};

export const QuestionBankView: React.FC<QuestionBankViewProps> = ({ onNavigate, bankId = 'moh_bank' }) => {
  const syncTick = useBlocksSynced();
  const canonicalUser = getCurrentUser();
  const [currentSession, setCurrentSession] = useState(() => resolveSession(canonicalUser.telegramId));
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [subscriptionLoading, setSubscriptionLoading] = useState<boolean>(true);

  const session = currentSession;
  const user = currentSession.user;

  useEffect(() => {
    let isCancelled = false;
    setSubscriptionLoading(true);

    const currentUser = getCurrentUser();
    const tgId = currentUser.telegramId;
    const username = currentUser.username;

    console.log('[QuestionBankView - Subscription Check Mount]', {
      tgId,
      username,
      currentTime: new Date().toISOString()
    });

    async function verifyAndSyncSubscription() {
      try {
        // 1. Check admin allowlist
        const isAdmin = verifyTelegramAdminAuthorization(tgId) || verifyTelegramAdminAuthorization(username);
        if (isAdmin) {
          if (!isCancelled) {
            setIsSubscribed(true);
            const adminSession = resolveSession(tgId);
            setCurrentSession(adminSession);
            console.log('[QuestionBankView] Admin user recognized, full access granted.', { tgId });
          }
          return;
        }

        // 2. Authoritative API call to verify active subscription
        const subObj = await syncSubscriptionFromSupabase(tgId, username);
        const refreshedSession = resolveSession(tgId);

        const active = Boolean(
          refreshedSession.isAdmin ||
          refreshedSession.isSubscribed ||
          (
            subObj !== null &&
            (subObj.status === 'ACTIVE' || subObj.status === 'APPROVED') &&
            (!subObj.expiryDate || new Date(subObj.expiryDate).getTime() > Date.now())
          )
        );

        console.log('[QuestionBankView - Authoritative Sync Result]', {
          tgId,
          username,
          subObj,
          refreshedStatus: refreshedSession.subscriptionStatus,
          active,
          currentTime: new Date().toISOString()
        });

        if (!isCancelled) {
          setIsSubscribed(active);
          setCurrentSession(refreshedSession);
        }
      } catch (err) {
        console.warn('[QuestionBankView] Subscription sync error, falling back to local session:', err);
        if (!isCancelled) {
          const fallbackSession = resolveSession(tgId);
          setIsSubscribed(fallbackSession.isAdmin || fallbackSession.isSubscribed);
          setCurrentSession(fallbackSession);
        }
      } finally {
        if (!isCancelled) {
          setSubscriptionLoading(false);
        }
      }
    }

    verifyAndSyncSubscription();

    return () => {
      isCancelled = true;
    };
  }, [canonicalUser.telegramId]);

  const [questions, setQuestions] = useState<Question[]>(() => getStoredQuestions().filter((q) => q.bankId === bankId));

  useEffect(() => {
    syncQuestionsWithSupabase()
      .then((synced) => {
        if (synced && synced.length > 0) {
          setQuestions(synced.filter((q) => q.bankId === bankId));
        }
      })
      .catch(() => {});
  }, [bankId]);

  const bankMeta = getQuestionBankMeta(bankId);
  const allQuestions = questions;

  // Filter States
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<QuestionStatusFilter>('ALL');
  const [selectedMajors, setSelectedMajors] = useState<string[]>(['All']);
  const [selectedTopics, setSelectedTopics] = useState<string[]>(['All']);
  const [selectedYears, setSelectedYears] = useState<(number | string)[]>([]);
  const [selectedExamTypes, setSelectedExamTypes] = useState<string[]>([]); // empty = all types
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('All');
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [topicSheetOpen, setTopicSheetOpen] = useState<boolean>(false);

  // Reset Progress state
  const [resetCount, setResetCount] = useState<number>(0);
  const [showResetModal, setShowResetModal] = useState<boolean>(false);
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const [resetSuccessMsg, setResetSuccessMsg] = useState<string | null>(null);

  // Fetch persistent reset count on mount
  useEffect(() => {
    fetchResetCountFromSupabase(user.telegramId).then((count) => {
      setResetCount(count);
    });
  }, [user.telegramId]);

  // Compute status sets for current user
  const statusSets = useMemo(() => {
    return getUserQuestionStatusSets(user.telegramId);
  }, [user.telegramId, resetCount, syncTick]);

  // Compute available topics based on selected Majors
  const availableTopics = useMemo(() => {
    if (selectedMajors.includes('All') || selectedMajors.length === 0) {
      const allTopicsSet = new Set<string>();
      bankMeta.majors.forEach((m) => {
        m.topics.forEach((t) => allTopicsSet.add(t.name));
      });
      return Array.from(allTopicsSet);
    }

    const filteredTopicsSet = new Set<string>();
    bankMeta.majors.forEach((m) => {
      if (selectedMajors.includes(m.name)) {
        m.topics.forEach((t) => filteredTopicsSet.add(t.name));
      }
    });
    return Array.from(filteredTopicsSet);
  }, [selectedMajors, bankMeta]);

  // Handle Major Multi-Select Toggle
  const handleToggleMajor = (majorName: string) => {
    setErrorMsg(null);
    if (majorName === 'All') {
      setSelectedMajors(['All']);
      return;
    }

    let updatedMajors: string[];
    if (selectedMajors.includes('All')) {
      updatedMajors = [majorName];
    } else if (selectedMajors.includes(majorName)) {
      updatedMajors = selectedMajors.filter((m) => m !== majorName);
      if (updatedMajors.length === 0) {
        updatedMajors = ['All'];
      }
    } else {
      updatedMajors = [...selectedMajors, majorName];
    }

    setSelectedMajors(updatedMajors);

    // Clean up selected topics if they are no longer in available topics
    if (!updatedMajors.includes('All')) {
      const validNewTopicsSet = new Set<string>();
      bankMeta.majors.forEach((m) => {
        if (updatedMajors.includes(m.name)) {
          m.topics.forEach((t) => validNewTopicsSet.add(t.name));
        }
      });
      const cleanedTopics = selectedTopics.filter(
        (t) => t === 'All' || validNewTopicsSet.has(t)
      );
      setSelectedTopics(cleanedTopics.length > 0 ? cleanedTopics : ['All']);
    }
  };

  // Handle Topic Multi-Select Toggle
  const handleToggleTopic = (topicName: string) => {
    setErrorMsg(null);
    if (topicName === 'All') {
      setSelectedTopics(['All']);
      return;
    }

    if (selectedTopics.includes('All')) {
      setSelectedTopics([topicName]);
    } else if (selectedTopics.includes(topicName)) {
      const updated = selectedTopics.filter((t) => t !== topicName);
      setSelectedTopics(updated.length > 0 ? updated : ['All']);
    } else {
      setSelectedTopics([...selectedTopics, topicName]);
    }
  };

  // Heavy count/filter work runs on deferred copies so taps on chips and the map respond instantly.
  const dMajors = useDeferredValue(selectedMajors);
  const dTopics = useDeferredValue(selectedTopics);
  const dYears = useDeferredValue(selectedYears);
  const dExamType = useDeferredValue(selectedExamTypes);
  const dDifficulty = useDeferredValue(selectedDifficulty);
  const dStatus = useDeferredValue(selectedStatusFilter);
  const dCount = useDeferredValue(questionCount);

  // Years offered: all years, or only those under the selected exam types (union).
  const yearOptions = useMemo(() => {
    if (selectedExamTypes.length === 0 || !bankMeta.yearsByType) return bankMeta.yearsAvailable;
    const set = new Set<number | string>();
    selectedExamTypes.forEach((t) => (bankMeta.yearsByType![t] || []).forEach((y) => set.add(y)));
    return bankMeta.yearsAvailable.filter((y) => set.has(y));
  }, [selectedExamTypes, bankMeta.yearsByType, bankMeta.yearsAvailable]);

  // Non-status filter object for calculating status card totals
  const nonStatusFilters: BlockFilters = useMemo(
    () => ({
      majors: dMajors.includes('All') ? undefined : dMajors,
      topics: dTopics.includes('All') ? undefined : dTopics,
      years: dYears.length > 0 ? dYears : undefined,
      examTypes: dExamType.length > 0 ? dExamType : undefined,
      difficulty: dDifficulty !== 'All' ? dDifficulty : undefined,
      bankId,
    }),
    [dMajors, dTopics, dYears, dExamType, dDifficulty, bankId]
  );

  // Questions matching non-status criteria (used for card totals)
  const nonStatusMatchingQuestions = useMemo(() => {
    return getFilteredQuestions(nonStatusFilters);
  }, [nonStatusFilters]);

  // Compute status counts for questions matching current non-status filters
  const statusCounts = useMemo(() => {
    return getQuestionStatusCounts(user.telegramId, nonStatusMatchingQuestions);
  }, [user.telegramId, nonStatusMatchingQuestions, statusSets]);

  // Construct current full filter object including statusFilter
  const currentFilters: BlockFilters = useMemo(
    () => ({
      major: dMajors.length === 1 && dMajors[0] !== 'All' ? dMajors[0] : undefined,
      majors: dMajors.includes('All') ? undefined : dMajors,
      topic: dTopics.length === 1 && dTopics[0] !== 'All' ? dTopics[0] : undefined,
      topics: dTopics.includes('All') ? undefined : dTopics,
      years: dYears.length > 0 ? dYears : undefined,
      examTypes: dExamType.length > 0 ? dExamType : undefined,
      difficulty: dDifficulty !== 'All' ? dDifficulty : undefined,
      dCount,
      statusFilter: dStatus,
      userId: user.telegramId,
      bankId
    }),
    [dMajors, dTopics, dYears, dExamType, dDifficulty, dCount, dStatus, user.telegramId, bankId]
  );

  // Active question pool matching ALL filters (including status filter)
  const matchingQuestions = useMemo(() => {
    return getFilteredQuestions(currentFilters);
  }, [currentFilters]);

  // Compute dynamic Major Question Counts respecting active Status, Topic, Year, Difficulty filters
  const majorQuestionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    bankMeta.majors.forEach((m) => {
      const count = getFilteredQuestions({
        majors: [m.name],
        topics: dTopics.includes('All') ? undefined : dTopics,
        years: dYears.length > 0 ? dYears : undefined,
        examTypes: dExamType.length > 0 ? dExamType : undefined,
        difficulty: dDifficulty !== 'All' ? dDifficulty : undefined,
        statusFilter: dStatus,
        userId: user.telegramId,
        bankId
      }).length;
      counts[m.name] = count;
    });
    return counts;
  }, [bankMeta.majors, dTopics, dYears, dExamType, dDifficulty, dStatus, user.telegramId, bankId]);

  // Compute dynamic Topic Question Counts respecting active Status, Major, Year, Difficulty filters
  const topicQuestionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!topicSheetOpen) return counts;
    availableTopics.forEach((tName) => {
      const count = getFilteredQuestions({
        majors: dMajors.includes('All') ? undefined : dMajors,
        topics: [tName],
        years: dYears.length > 0 ? dYears : undefined,
        examTypes: dExamType.length > 0 ? dExamType : undefined,
        difficulty: dDifficulty !== 'All' ? dDifficulty : undefined,
        statusFilter: dStatus,
        userId: user.telegramId,
        bankId
      }).length;
      counts[tName] = count;
    });
    return counts;
  }, [topicSheetOpen, availableTopics, dMajors, dYears, dExamType, dDifficulty, dStatus, user.telegramId]);

  const toggleYear = (year: number | string) => {
    if (selectedYears.includes(year)) {
      setSelectedYears(selectedYears.filter((y) => y !== year));
    } else {
      setSelectedYears([...selectedYears, year]);
    }
  };

  const handleResetFilters = () => {
    setSelectedStatusFilter('ALL');
    setSelectedMajors(['All']);
    setSelectedTopics(['All']);
    setSelectedYears([]);
    setSelectedDifficulty('All');
    setQuestionCount(10);
    setErrorMsg(null);
  };

  const handleConfirmResetProgress = async () => {
    setIsResetting(true);
    setErrorMsg(null);
    setResetSuccessMsg(null);

    const res = await resetUserQuestionBankProgress(user.telegramId);
    setIsResetting(false);
    setShowResetModal(false);

    if (!res.success) {
      setErrorMsg(res.error || 'Failed to reset progress.');
    } else {
      setResetCount(res.resetCount);
      setSelectedStatusFilter('ALL');
      setResetSuccessMsg('Question bank progress successfully reset!');
      setTimeout(() => setResetSuccessMsg(null), 4000);
    }
  };

  const handleStartBlock = async () => {
    setErrorMsg(null);

    if (subscriptionLoading) {
      console.log('[QuestionBankView handleStartBlock] Prevented start: subscription check in progress.');
      return;
    }

    const canonicalUser = getCanonicalTelegramUser();
    const tgId = canonicalUser.telegramId;
    const activeUsername = canonicalUser.username;

    console.log('[Start Question Diagnostic - Click HandleStartBlock]', {
      tgId,
      username: activeUsername,
      isSubscribed,
      subscriptionLoading,
      sessionStatus: currentSession.subscriptionStatus,
      currentTime: new Date().toISOString()
    });

    if (!tgId) {
      setErrorMsg('Identity error: Unable to resolve canonical Telegram user ID.');
      return;
    }

    if (!isSubscribed) {
      console.warn('[Start Question Diagnostic - Blocked by Frontend Gate]', {
        reason: 'isSubscribed is false in QuestionBankView state',
        sessionStatus: currentSession.subscriptionStatus
      });
      onNavigate('subscription');
      return;
    }

    try {
      const newBlock = await startBlock(tgId, currentFilters, bankId);
      console.log('[Start Question Diagnostic - Block Started Successfully]', { blockId: newBlock.id });
      onNavigate('question_screen', { blockId: newBlock.id });
    } catch (err: any) {
      console.error('[Start Question Diagnostic - startBlock Exception]', err);
      setErrorMsg(err.message || 'Failed to start block.');
    }
  };

  const selectedMajorsLabel = selectedMajors.includes('All')
    ? 'All Majors'
    : selectedMajors.join(', ');

  const selectedTopicsLabel = selectedTopics.includes('All')
    ? 'All Topics'
    : selectedTopics.join(', ');

  const getEmptyStateMessage = (): string => {
    const statusLabel =
      selectedStatusFilter === 'COMPLETE'
        ? 'completed'
        : selectedStatusFilter === 'UNCOMPLETED'
        ? 'uncompleted'
        : selectedStatusFilter === 'UNUSED'
        ? 'unused'
        : '';

    const hasMajor = selectedMajors.length > 0 && !selectedMajors.includes('All');
    const hasTopic = selectedTopics.length > 0 && !selectedTopics.includes('All');

    let filterDesc = '';
    if (hasMajor && hasTopic) {
      filterDesc = `for the selected Major (${selectedMajorsLabel}) and Topic (${selectedTopicsLabel})`;
    } else if (hasMajor) {
      filterDesc = `for the selected Major (${selectedMajorsLabel})`;
    } else if (hasTopic) {
      filterDesc = `for the selected Topic (${selectedTopicsLabel})`;
    } else {
      filterDesc = 'for the selected filter criteria';
    }

    if (statusLabel) {
      return `No ${statusLabel} questions are available ${filterDesc}.`;
    }
    return `No questions match the selected filter criteria.`;
  };

  const mapMajors = useMemo(
    () => bankMeta.majors.map((m) => ({ name: m.name, count: majorQuestionCounts[m.name] ?? 0 })),
    [bankMeta.majors, majorQuestionCounts]
  );
  const poolSize = nonStatusMatchingQuestions.length;
  const startDisabled = matchingQuestions.length === 0 || subscriptionLoading;
  const startLabel = subscriptionLoading ? "Checking subscription..." : matchingQuestions.length === 0 ? "No questions available" : !isSubscribed ? "Subscribe to start" : "Start practice block";

  return (
    <div className="qb pb-40 md:pb-12">
      <PerfStyles />
      <style>{QB_CSS}</style>

      <div className="qb-top">
        <span className="qb-mono" style={{ color: 'var(--cy)' }}>{bankMeta.name}</span>
        <div className="qb-tl">
          <button className="qb-tbtn" onClick={handleResetFilters}>
            <RotateCcw size={13} /> Reset filters
          </button>
          <button
            className="qb-tbtn danger"
            onClick={() => setShowResetModal(true)}
            disabled={resetCount >= 3}
            title={resetCount >= 3 ? 'Reset limit reached. You have used all 3 available resets.' : 'Reset your question-bank progress'}
          >
            <RefreshCw size={13} /> Reset progress ({resetCount}/3)
          </button>
        </div>
      </div>

      {resetCount >= 3 && (
        <div className="qb-warn" style={{ marginTop: 10 }}>
          <AlertTriangle size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />
          Reset limit reached. You have used all 3 available resets.
        </div>
      )}

      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="qb-modal">
            <button onClick={() => setShowResetModal(false)} className="qb-x" aria-label="Close">
              <X size={18} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="qb-mi"><RefreshCw size={22} /></div>
              <div>
                <h3 className="qb-mh">Reset question-bank progress</h3>
                <span className="qb-mono" style={{ color: 'var(--rose)' }}>{resetCount} / 3 resets used</span>
              </div>
            </div>
            <div className="qb-mb">
              <p style={{ color: 'var(--ink)', fontWeight: 600, margin: 0 }}>Are you sure you want to reset your question-bank progress?</p>
              <p style={{ margin: '8px 0 0' }}>This will reset all completed, uncompleted, and used-question progress and return the question bank to its initial state.</p>
              <p style={{ margin: '8px 0 0', color: 'var(--gr)' }}>Your questions, account, subscription, and other data will not be deleted.</p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="qb-tbtn" style={{ minHeight: 46, padding: '0 18px' }} onClick={() => setShowResetModal(false)}>Cancel</button>
              <button className="qb-tbtn danger" style={{ minHeight: 46, padding: '0 18px', background: 'rgba(255,143,163,.14)' }} onClick={handleConfirmResetProgress} disabled={isResetting}>
                {isResetting ? 'Resetting...' : 'Confirm reset'}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetSuccessMsg && (
        <div className="qb-ok">
          <CheckCircle2 size={16} style={{ flex: 'none' }} />
          <span>{resetSuccessMsg}</span>
        </div>
      )}

      {/* Hero + 3D constellation of majors */}
      <section className="qb-hero">
        <div>
          <div className="qb-mono" style={{ color: 'var(--cy)' }}>Past years</div>
          <h1 className="qb-h1">Build your <em>block</em></h1>
          <p className="qb-sub">Choose what to practise. The count updates as you filter, then start when it looks right.</p>
        </div>
        <div>
          {bankMeta.majors.length > 0 ? (
            <MajorsMap
              majors={mapMajors}
              selected={selectedMajors.includes('All') ? [] : selectedMajors}
              onToggle={handleToggleMajor}
            />
          ) : null}
          <p className="qb-mono qb-nethint">Drag to rotate. Tap a bright point to select that major.</p>
        </div>
      </section>

      {bankMeta.totalQuestions === 0 && (
        <div className="qb-card" style={{ textAlign: 'center', marginTop: 18 }}>
          <div className="qb-mi" style={{ margin: '0 auto 10px', color: 'var(--cy)', borderColor: 'rgba(79,214,236,.3)', background: 'rgba(79,214,236,.08)' }}><BookOpen size={22} /></div>
          <h3 className="qb-mh">0 Questions Available</h3>
          <p style={{ color: 'var(--dim)', fontSize: 13, lineHeight: 1.5, margin: '6px auto 0', maxWidth: 420 }}>
            No questions have been imported yet. Please import a question bank from the Admin Question Bank Import section to get started.
          </p>
          {session.isAdmin && (
            <button className="qb-go" style={{ maxWidth: 280, margin: '16px auto 0' }} onClick={() => onNavigate('admin')}>
              <span>Go to Admin Question Import</span>
              <span className="a"><ChevronRight size={18} /></span>
            </button>
          )}
        </div>
      )}

      {matchingQuestions.length === 0 && bankMeta.totalQuestions > 0 && (
        <div className="qb-warn" style={{ marginTop: 18, display: 'flex', gap: 10 }}>
          <AlertTriangle size={18} style={{ flex: 'none', color: 'var(--am)' }} />
          <div>
            <div style={{ fontWeight: 600, color: 'var(--ink)' }}>Zero Matching Questions</div>
            <div>{getEmptyStateMessage()}</div>
          </div>
        </div>
      )}

      {subscriptionLoading && (
        <div className="qb-card qb-pulse" style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
          <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--cy)', flex: 'none' }} />
          <div>
            <div style={{ fontWeight: 600 }}>Checking Subscription Status...</div>
            <div style={{ color: 'var(--dim)', fontSize: 12.5 }}>Verifying your MOH Residency Pass with the subscription database...</div>
          </div>
        </div>
      )}

      {!subscriptionLoading && !isSubscribed && (
        <div className="qb-card qb-amber" style={{ marginTop: 18, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
          <div style={{ display: 'flex', gap: 12, minWidth: 0, flex: '1 1 260px' }}>
            <Lock size={20} style={{ color: 'var(--am)', flex: 'none', marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 600 }}>
                {session.subscriptionStatus === 'EXPIRED' ? 'Subscription Expired — Renewal Required' : 'Active Subscription Required'}
              </div>
              <div style={{ color: 'var(--dim)', fontSize: 12.5, lineHeight: 1.5, marginTop: 3 }}>
                {session.subscriptionStatus === 'EXPIRED'
                  ? 'Your MOH Residency Pass has expired. Please renew your subscription to resume creating and solving test blocks.'
                  : 'You can configure filter criteria, but an active MOH Residency Pass is required to start solving blocks.'}
              </div>
            </div>
          </div>
          <button className="qb-tbtn" style={{ borderColor: 'rgba(232,182,106,.5)', color: 'var(--am)', minHeight: 44 }} onClick={() => onNavigate('subscription')}>
            <CreditCard size={15} /> {session.subscriptionStatus === 'EXPIRED' ? 'Renew MOH Pass' : 'Get MOH Pass'}
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="qb-err">
          <AlertTriangle size={16} style={{ flex: 'none' }} />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="qb-grid">
        <div style={{ minWidth: 0 }}>
          {/* Status */}
          <section className="qb-sec">
            <div className="qb-sh"><h2>Status</h2><span className="qb-mono">Which questions</span></div>
            <div className="qb-tiles">
              {([
                ['ALL', 'All', 't-all', statusCounts.allCount],
                ['COMPLETE', 'Complete', 't-done', statusCounts.completeCount],
                ['UNCOMPLETED', 'Uncompleted', 't-inc', statusCounts.uncompletedCount],
                ['UNUSED', 'Unused', 't-new', statusCounts.unusedCount],
              ] as [QuestionStatusFilter, string, string, number][]).map(([val, label, cls, n]) => (
                <button key={val} className={`qb-tile ${cls}`} aria-pressed={selectedStatusFilter === val} onClick={() => setSelectedStatusFilter(val)}>
                  <span className="qb-mono">{label}</span>
                  <b><CountUp value={n} duration={700} /></b>
                </button>
              ))}
            </div>
          </section>

          {/* Majors */}
          <section className="qb-sec">
            <div className="qb-sh"><h2>Majors</h2><span className="qb-mono qb-trunc">{selectedMajorsLabel}</span></div>
            <div className="qb-chips">
              <button className="qb-chip" aria-pressed={selectedMajors.includes('All')} onClick={() => handleToggleMajor('All')}>
                <span>All majors</span>
              </button>
              {bankMeta.majors.map((m) => {
                const isSelected = selectedMajors.includes(m.name) && !selectedMajors.includes('All');
                return (
                  <button key={m.name} className="qb-chip" aria-pressed={isSelected} onClick={() => handleToggleMajor(m.name)}>
                    <span>{m.name}</span>
                    <i>{majorQuestionCounts[m.name] ?? 0}</i>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Topics */}
          <section className="qb-sec">
            <div className="qb-sh"><h2>Topics</h2><span className="qb-mono">{availableTopics.length} topics</span></div>
            <button type="button" className="qb-row" onClick={() => setTopicSheetOpen(true)}>
              <span style={{ minWidth: 0 }}>
                <b>{selectedTopics.includes('All') ? 'All topics' : `${selectedTopics.length} topic${selectedTopics.length === 1 ? '' : 's'} selected`}</b>
                <span className="s">{selectedTopics.includes('All') ? 'Tap to search and pick specific topics' : selectedTopics.join(', ')}</span>
              </span>
              <ChevronRight size={18} style={{ flex: 'none', color: 'var(--dim)' }} />
            </button>
            {!selectedTopics.includes('All') && (
              <div className="qb-selt">
                {selectedTopics.slice(0, 8).map((t) => (
                  <button key={t} className="qb-chip" onClick={() => handleToggleTopic(t)}>
                    <span className="qb-trunc" style={{ maxWidth: '12rem' }}>{t}</span><X size={12} />
                  </button>
                ))}
                {selectedTopics.length > 8 && <span className="qb-mono" style={{ alignSelf: 'center' }}>+{selectedTopics.length - 8} more</span>}
              </div>
            )}
          </section>

          <TopicPicker
            open={topicSheetOpen}
            onClose={() => setTopicSheetOpen(false)}
            topics={availableTopics}
            counts={topicQuestionCounts}
            selected={selectedTopics}
            onToggle={handleToggleTopic}
            onClear={() => setSelectedTopics(['All'])}
          />

          {/* Exam */}
          {((bankMeta.examTypesAvailable && bankMeta.examTypesAvailable.length > 0) || bankId !== 'usmle_bank') && (
            <section className="qb-sec">
              <div className="qb-sh"><h2>Exam</h2><span className="qb-mono">{selectedExamTypes.length === 0 ? 'All types' : selectedExamTypes.join(' + ')}</span></div>
              {bankMeta.examTypesAvailable && bankMeta.examTypesAvailable.length > 0 && (
                <div className="qb-seg">
                  <button aria-pressed={selectedExamTypes.length === 0} onClick={() => { setSelectedExamTypes([]); setSelectedYears([]); }}>All</button>
                  {bankMeta.examTypesAvailable.map((t) => {
                    const active = selectedExamTypes.includes(t);
                    return (
                      <button key={t} aria-pressed={active} onClick={() => {
                        setSelectedExamTypes(active ? selectedExamTypes.filter((x) => x !== t) : [...selectedExamTypes, t]);
                        setSelectedYears([]);
                      }}>
                        {t}
                      </button>
                    );
                  })}
                </div>
              )}
              {bankId !== 'usmle_bank' && (
                <div className="qb-chips" style={{ marginTop: 14 }}>
                  {yearOptions.map((yr) => (
                    <button key={yr} className="qb-chip" aria-pressed={selectedYears.includes(yr)} onClick={() => toggleYear(yr)}>
                      <span>{yr}</span>
                    </button>
                  ))}
                  {selectedExamTypes.length > 0 && yearOptions.length === 0 && (
                    <span style={{ fontSize: 12.5, color: 'var(--dim)' }}>No years yet under {selectedExamTypes.join(' + ')}.</span>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Difficulty */}
          <section className="qb-sec">
            <div className="qb-sh"><h2>Difficulty</h2><span className="qb-mono">Level</span></div>
            <div className="qb-seg">
              {['All', 'Easy', 'Medium', 'Hard'].map((diff) => (
                <button key={diff} aria-pressed={selectedDifficulty === diff} onClick={() => setSelectedDifficulty(diff)}>{diff}</button>
              ))}
            </div>
          </section>
        </div>

        {/* Your block (sticky on desktop; phones get the bottom bar below) */}
        <aside className="qb-aside">
          <div className="qb-block">
            <div className="qb-mono" style={{ color: 'var(--cy)' }}>Your block</div>
            <div className="qb-ring">
              <svg viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(207,239,248,.1)" strokeWidth="7" />
                <circle cx="60" cy="60" r="52" fill="none" stroke="#4FD6EC" strokeWidth="7" strokeLinecap="round" strokeDasharray="326.7"
                  strokeDashoffset={326.7 * (1 - (poolSize ? Math.min(1, matchingQuestions.length / poolSize) : 0))}
                  style={{ filter: 'drop-shadow(0 0 6px rgba(79,214,236,.7))', transition: 'stroke-dashoffset .8s cubic-bezier(.16,1,.3,1)' }} />
              </svg>
              <div className="c"><div><b><CountUp value={matchingQuestions.length} duration={600} /></b><span className="qb-mono">of {poolSize.toLocaleString()}</span></div></div>
            </div>
            <div className="qb-mono" style={{ marginTop: 14 }}>Block length</div>
            <div className="qb-len">
              {[5, 10, 15, 20].map((cnt) => (
                <button key={cnt} aria-pressed={questionCount === cnt} onClick={() => setQuestionCount(cnt)}>{cnt}</button>
              ))}
            </div>
            <ul className="qb-sum">
              <li><span>Status</span><span>{selectedStatusFilter === 'ALL' ? 'All questions' : selectedStatusFilter === 'COMPLETE' ? 'Complete' : selectedStatusFilter === 'UNCOMPLETED' ? 'Uncompleted' : 'Unused'}</span></li>
              <li><span>Majors</span><span>{selectedMajorsLabel}</span></li>
              <li><span>Topics</span><span>{selectedTopicsLabel}</span></li>
              <li><span>Exam</span><span>{selectedExamTypes.length === 0 ? 'All types' : selectedExamTypes.join(' + ')}</span></li>
              <li><span>Years</span><span>{selectedYears.length === 0 ? 'All years' : selectedYears.join(', ')}</span></li>
              <li><span>Difficulty</span><span>{selectedDifficulty}</span></li>
            </ul>
            {matchingQuestions.length === 0 && bankMeta.totalQuestions > 0 && (
              <div className="qb-warn">No questions match these filters. Remove a filter to continue.</div>
            )}
            <button className={`qb-go ${!isSubscribed && !subscriptionLoading ? 'sub-b' : ''}`} onClick={handleStartBlock} disabled={startDisabled}>
              <span>{startLabel}</span>
              <span className="a">{subscriptionLoading ? <RefreshCw size={18} className="animate-spin" /> : !isSubscribed ? <Lock size={17} /> : <Play size={17} />}</span>
            </button>
          </div>
        </aside>
      </div>

      {/* Phone bottom bar */}
      <div className="qb-bar">
        <div className="in">
          <div>
            <div className="n"><CountUp value={matchingQuestions.length} duration={500} /></div>
            <div className="qb-mono" style={{ fontSize: 9.5 }}>Questions match</div>
          </div>
          <button className={`qb-go ${!isSubscribed && !subscriptionLoading ? 'sub-b' : ''}`} onClick={handleStartBlock} disabled={startDisabled}>
            <span>{subscriptionLoading ? 'Checking...' : matchingQuestions.length === 0 ? 'No questions' : !isSubscribed ? 'Subscribe' : 'Start block'}</span>
            <span className="a">{!isSubscribed && !subscriptionLoading ? <Lock size={16} /> : <ChevronRight size={18} />}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
