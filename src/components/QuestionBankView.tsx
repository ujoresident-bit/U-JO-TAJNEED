import React, { useState, useMemo, useEffect } from 'react';
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
              className="w-full pl-10 pr-9 py-3 rounded-xl bg-white/[0.05] border border-white/[0.08] focus:border-purple-400/60 focus:bg-white/[0.07] outline-none text-sm text-slate-100 placeholder:text-slate-600 transition-colors"
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
                <button key={t} onClick={() => onToggle(t)} className="pf-pop inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-500/20 border border-purple-400/40 text-[11px] font-semibold text-purple-200 hover:bg-purple-500/30">
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
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-colors ${isAll ? 'bg-purple-500/15 border border-purple-400/40' : 'hover:bg-white/[0.05] border border-transparent'}`}
            >
              <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${isAll ? 'bg-purple-400 border-purple-300' : 'border-white/20'}`}>
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
                  className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-colors border ${on ? 'bg-purple-500/15 border-purple-400/40' : 'border-transparent hover:bg-white/[0.05]'}`}
                >
                  <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${on ? 'bg-purple-400 border-purple-300' : 'border-white/20'}`}>
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
            className="flex-1 py-3 rounded-xl bg-purple-500 hover:bg-purple-400 text-slate-950 text-xs font-black uppercase tracking-wider shadow-lg shadow-purple-500/25 active:scale-[.98] transition-all"
          >
            {isAll ? 'Done' : `Done · ${selCount} selected`}
          </button>
        </div>
      </div>
    </div>
  );
};

export const QuestionBankView: React.FC<QuestionBankViewProps> = ({ onNavigate, bankId = 'moh_bank' }) => {
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
  const [selectedExamType, setSelectedExamType] = useState<string | null>(null);
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
  }, [user.telegramId, resetCount]);

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

  // Non-status filter object for calculating status card totals
  const nonStatusFilters: BlockFilters = useMemo(
    () => ({
      majors: selectedMajors.includes('All') ? undefined : selectedMajors,
      topics: selectedTopics.includes('All') ? undefined : selectedTopics,
      years: selectedYears.length > 0 ? selectedYears : undefined,
      examType: selectedExamType || undefined,
      difficulty: selectedDifficulty !== 'All' ? selectedDifficulty : undefined,
      bankId,
    }),
    [selectedMajors, selectedTopics, selectedYears, selectedExamType, selectedDifficulty, bankId]
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
      major: selectedMajors.length === 1 && selectedMajors[0] !== 'All' ? selectedMajors[0] : undefined,
      majors: selectedMajors.includes('All') ? undefined : selectedMajors,
      topic: selectedTopics.length === 1 && selectedTopics[0] !== 'All' ? selectedTopics[0] : undefined,
      topics: selectedTopics.includes('All') ? undefined : selectedTopics,
      years: selectedYears.length > 0 ? selectedYears : undefined,
      examType: selectedExamType || undefined,
      difficulty: selectedDifficulty !== 'All' ? selectedDifficulty : undefined,
      questionCount,
      statusFilter: selectedStatusFilter,
      userId: user.telegramId,
      bankId
    }),
    [selectedMajors, selectedTopics, selectedYears, selectedExamType, selectedDifficulty, questionCount, selectedStatusFilter, user.telegramId, bankId]
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
        topics: selectedTopics.includes('All') ? undefined : selectedTopics,
        years: selectedYears.length > 0 ? selectedYears : undefined,
        examType: selectedExamType || undefined,
        difficulty: selectedDifficulty !== 'All' ? selectedDifficulty : undefined,
        statusFilter: selectedStatusFilter,
        userId: user.telegramId,
        bankId
      }).length;
      counts[m.name] = count;
    });
    return counts;
  }, [bankMeta.majors, selectedTopics, selectedYears, selectedExamType, selectedDifficulty, selectedStatusFilter, user.telegramId, bankId]);

  // Compute dynamic Topic Question Counts respecting active Status, Major, Year, Difficulty filters
  const topicQuestionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    availableTopics.forEach((tName) => {
      const count = getFilteredQuestions({
        majors: selectedMajors.includes('All') ? undefined : selectedMajors,
        topics: [tName],
        years: selectedYears.length > 0 ? selectedYears : undefined,
        examType: selectedExamType || undefined,
        difficulty: selectedDifficulty !== 'All' ? selectedDifficulty : undefined,
        statusFilter: selectedStatusFilter,
        userId: user.telegramId,
        bankId
      }).length;
      counts[tName] = count;
    });
    return counts;
  }, [availableTopics, selectedMajors, selectedYears, selectedExamType, selectedDifficulty, selectedStatusFilter, user.telegramId]);

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

  return (
    <div className="space-y-6 pb-12">
      <PerfStyles />
      {/* Header Banner */}
      <div className="pf-rise glass-panel p-6 relative overflow-hidden" style={{ background: 'radial-gradient(520px 200px at 0% 0%, rgba(34,211,238,.10), transparent 70%), var(--surface)' }}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-[#00F2FF] text-[10px] font-semibold uppercase tracking-wider">
              <BookOpen className="w-3.5 h-3.5" />
              <span>{bankMeta.name}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-100">
              Create Question Block
            </h1>
            <p className="text-xs text-slate-400 max-w-xl">
              Configure exam filters by question status, specialty major, topic, exam year, or difficulty level to assemble your practice block.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap self-start md:self-auto">
            <button
              onClick={handleResetFilters}
              className="px-3.5 py-2 rounded-xl glass-panel text-slate-300 text-xs font-semibold border border-white/10 hover:bg-white/5 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              <span>Reset Filters</span>
            </button>

            <button
              onClick={() => setShowResetModal(true)}
              disabled={resetCount >= 3}
              title={
                resetCount >= 3
                  ? 'Reset limit reached. You have used all 3 available resets.'
                  : 'Reset your question-bank progress'
              }
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition-all cursor-pointer ${
                resetCount >= 3
                  ? 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed opacity-60'
                  : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/30'
              }`}
            >
              <RefreshCw className="w-3.5 h-3.5 text-rose-400" />
              <span>Reset Progress ({resetCount}/3)</span>
            </button>
          </div>
        </div>

        {resetCount >= 3 && (
          <div className="mt-3 text-[11px] text-amber-400 font-medium flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-lg max-w-fit">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>Reset limit reached. You have used all 3 available resets.</span>
          </div>
        )}
      </div>

      {/* Confirmation Modal for Reset Progress */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel border-rose-500/30 p-6 max-w-md w-full space-y-4 shadow-2xl relative">
            <button
              onClick={() => setShowResetModal(false)}
              className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30">
                <RefreshCw className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">
                  Reset Question-Bank Progress
                </h3>
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                  {resetCount} / 3 Resets Used
                </span>
              </div>
            </div>

            <div className="space-y-3 text-xs text-slate-300 leading-relaxed bg-black/40 p-4 rounded-xl border border-white/10">
              <p className="font-semibold text-slate-100">
                Are you sure you want to reset your question-bank progress?
              </p>
              <p className="text-slate-400">
                This will reset all completed, uncompleted, and used-question progress and return the question bank to its initial state.
              </p>
              <p className="text-emerald-400 font-medium">
                Your questions, account, subscription, and other data will not be deleted.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowResetModal(false)}
                className="px-4 py-2.5 rounded-xl glass-panel text-slate-300 font-semibold text-xs border border-white/10 hover:bg-white/5 transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmResetProgress}
                disabled={isResetting}
                className="px-5 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-slate-950 font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-rose-500/20 cursor-pointer disabled:opacity-50"
              >
                {isResetting ? 'Resetting...' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Banner */}
      {resetSuccessMsg && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span className="font-semibold">{resetSuccessMsg}</span>
        </div>
      )}

      {/* Interactive Question Status Counters Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* All Questions */}
        <button
          type="button"
          onClick={() => setSelectedStatusFilter('ALL')}
          style={{ animationDelay: '0.08s' }}
          className={`pf-rise pf-lift p-4 rounded-2xl text-left cursor-pointer relative overflow-hidden border ${
            selectedStatusFilter === 'ALL'
              ? 'bg-cyan-500/20 border-cyan-400 ring-2 ring-cyan-400/50 shadow-lg shadow-cyan-500/20'
              : 'glass-panel border-cyan-500/20 opacity-75 hover:opacity-100 hover:border-cyan-500/50'
          }`}
        >
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
              All Questions
              {selectedStatusFilter === 'ALL' && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-cyan-400 text-slate-950">
                  Active
                </span>
              )}
            </span>
            <BookOpen className="w-4 h-4 text-[#00F2FF]" />
          </div>
          <div className="text-2xl font-black text-[#00F2FF]">
            <CountUp value={statusCounts.allCount} duration={900} />
          </div>
          <div className="text-[10px] text-slate-400 font-medium mt-1">
            All matching current filters
          </div>
        </button>

        {/* Complete Questions */}
        <button
          type="button"
          onClick={() => setSelectedStatusFilter('COMPLETE')}
          style={{ animationDelay: '0.15s' }}
          className={`pf-rise pf-lift p-4 rounded-2xl text-left cursor-pointer relative overflow-hidden border ${
            selectedStatusFilter === 'COMPLETE'
              ? 'bg-emerald-500/20 border-emerald-400 ring-2 ring-emerald-400/50 shadow-lg shadow-emerald-500/20'
              : 'glass-panel border-emerald-500/20 opacity-75 hover:opacity-100 hover:border-emerald-500/50'
          }`}
        >
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
              Complete
              {selectedStatusFilter === 'COMPLETE' && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-emerald-400 text-slate-950">
                  Active
                </span>
              )}
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400">
            <CountUp value={statusCounts.completeCount} duration={900} />
          </div>
          <div className="text-[10px] text-slate-400 font-medium mt-1">
            Questions answered in bank
          </div>
        </button>

        {/* Uncompleted Questions */}
        <button
          type="button"
          onClick={() => setSelectedStatusFilter('UNCOMPLETED')}
          style={{ animationDelay: '0.22s' }}
          className={`pf-rise pf-lift p-4 rounded-2xl text-left cursor-pointer relative overflow-hidden border ${
            selectedStatusFilter === 'UNCOMPLETED'
              ? 'bg-amber-500/20 border-amber-400 ring-2 ring-amber-400/50 shadow-lg shadow-amber-500/20'
              : 'glass-panel border-amber-500/20 opacity-75 hover:opacity-100 hover:border-amber-500/50'
          }`}
        >
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
              Uncompleted
              {selectedStatusFilter === 'UNCOMPLETED' && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-400 text-slate-950">
                  Active
                </span>
              )}
            </span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-400">
            <CountUp value={statusCounts.uncompletedCount} duration={900} />
          </div>
          <div className="text-[10px] text-slate-400 font-medium mt-1">
            Encountered but unanswered
          </div>
        </button>

        {/* Unused Questions */}
        <button
          type="button"
          onClick={() => setSelectedStatusFilter('UNUSED')}
          style={{ animationDelay: '0.29s' }}
          className={`pf-rise pf-lift p-4 rounded-2xl text-left cursor-pointer relative overflow-hidden border ${
            selectedStatusFilter === 'UNUSED'
              ? 'bg-purple-500/20 border-purple-400 ring-2 ring-purple-400/50 shadow-lg shadow-purple-500/20'
              : 'glass-panel border-purple-500/20 opacity-75 hover:opacity-100 hover:border-purple-500/50'
          }`}
        >
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
              Unused
              {selectedStatusFilter === 'UNUSED' && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-purple-400 text-slate-950">
                  Active
                </span>
              )}
            </span>
            <HelpCircle className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-black text-purple-400">
            <CountUp value={statusCounts.unusedCount} duration={900} />
          </div>
          <div className="text-[10px] text-slate-400 font-medium mt-1">
            Never started or encountered
          </div>
        </button>
      </div>

      {/* Empty State Banner if 0 Questions in Database */}
      {bankMeta.totalQuestions === 0 && (
        <div className="glass-panel border-cyan-500/30 p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-[#00F2FF] flex items-center justify-center mx-auto shadow-lg shadow-cyan-500/10">
            <BookOpen className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-100">0 Questions Available</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
              No questions have been imported yet. Please import a question bank from the Admin Question Bank Import section to get started.
            </p>
          </div>
          {session.isAdmin && (
            <div className="pt-2">
              <button
                onClick={() => onNavigate('admin')}
                className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs inline-flex items-center gap-2 transition-all shadow-md shadow-cyan-500/20 cursor-pointer"
              >
                <span>Go to Admin Question Import</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Zero matching questions notification for active filter set */}
      {matchingQuestions.length === 0 && bankMeta.totalQuestions > 0 && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-3 animate-fade-in">
          <AlertTriangle className="w-5 h-5 shrink-0 text-amber-400" />
          <div className="space-y-0.5">
            <div className="font-bold text-slate-100">Zero Matching Questions</div>
            <div className="text-slate-300">{getEmptyStateMessage()}</div>
          </div>
        </div>
      )}

      {/* Subscription Checking Indicator */}
      {subscriptionLoading && (
        <div className="glass-panel border-cyan-500/30 p-5 shadow-lg flex items-center justify-between gap-4 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
              <RefreshCw className="w-6 h-6 animate-spin text-[#00F2FF]" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                Checking Subscription Status...
              </h3>
              <p className="text-xs text-slate-400">
                Verifying your MOH Residency Pass with the subscription database...
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Subscription Lock Notice (Only if checking is finished and unsubscribed) */}
      {!subscriptionLoading && !isSubscribed && (
        <div className="glass-panel border-amber-500/30 p-5 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30">
              <Lock className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>
                  {session.subscriptionStatus === 'EXPIRED'
                    ? 'Subscription Expired — Renewal Required'
                    : 'Active Subscription Required'}
                </span>
                <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 text-[10px] font-bold uppercase rounded border border-amber-500/40">
                  {session.subscriptionStatus === 'EXPIRED' ? 'Expired' : 'Locked'}
                </span>
              </h3>
              <p className="text-xs text-slate-400 max-w-lg">
                {session.subscriptionStatus === 'EXPIRED'
                  ? 'Your MOH Residency Pass has expired. Please renew your subscription to resume creating and solving test blocks.'
                  : 'You can configure filter criteria, but an active MOH Residency Pass is required to start solving blocks.'}
              </p>
            </div>
          </div>

          <button
            onClick={() => onNavigate('subscription')}
            className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-amber-500/20 shrink-0 cursor-pointer"
          >
            <CreditCard className="w-4 h-4" />
            <span>{session.subscriptionStatus === 'EXPIRED' ? 'Renew MOH Pass' : 'Get MOH Pass'}</span>
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Filter Options Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Filter Selectors */}
        <div className="lg:col-span-2 space-y-6">
          {/* Major Filter */}
          <div className="pf-rise glass-panel p-5 space-y-3" style={{ animationDelay: '.05s' }}>
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#00F2FF]" />
                <span>Specialty Major (Multi-Select)</span>
              </label>
              <span className="text-xs text-slate-400 font-medium truncate max-w-[200px]">
                {selectedMajorsLabel}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleToggleMajor('All')}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1.5 pf-lift ${
                  selectedMajors.includes('All')
                    ? 'neon-bg font-black'
                    : 'glass-panel text-slate-300 border-white/10 hover:bg-white/5'
                }`}
              >
                {selectedMajors.includes('All') && <Check className="w-3.5 h-3.5" />}
                <span>All Majors</span>
              </button>

              {bankMeta.majors.map((m) => {
                const isSelected = selectedMajors.includes(m.name) && !selectedMajors.includes('All');
                const mCount = majorQuestionCounts[m.name] ?? 0;
                return (
                  <button
                    key={m.name}
                    onClick={() => handleToggleMajor(m.name)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer pf-lift ${
                      isSelected
                        ? 'neon-bg font-black'
                        : 'glass-panel text-slate-300 border-white/10 hover:bg-white/5'
                    }`}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5" />}
                    <span>{m.name}</span>
                    <span className="text-[10px] opacity-80">({mCount})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Topic Filter: a single button that opens a searchable picker */}
          <div className="pf-rise glass-panel p-5 space-y-3" style={{ animationDelay: '.1s' }}>
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Filter className="w-4 h-4 text-purple-400" />
                <span>Sub-Topic (Multi-Select)</span>
              </label>
              <span className="text-[11px] text-slate-500 tabular-nums">{availableTopics.length} topics</span>
            </div>

            <button
              type="button"
              onClick={() => setTopicSheetOpen(true)}
              className="pf-lift w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white/[0.04] border border-white/[0.09] hover:border-purple-400/50 hover:bg-purple-500/[0.06] text-left cursor-pointer"
            >
              <span className="w-9 h-9 rounded-lg bg-purple-500/15 border border-purple-400/25 text-purple-300 flex items-center justify-center shrink-0">
                <Search className="w-4 h-4" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-slate-100">
                  {selectedTopics.includes('All') ? 'All topics' : `${selectedTopics.length} topic${selectedTopics.length === 1 ? '' : 's'} selected`}
                </span>
                <span className="block text-[11px] text-slate-500 truncate">
                  {selectedTopics.includes('All') ? 'Tap to search and pick specific topics' : selectedTopics.join(', ')}
                </span>
              </span>
              <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
            </button>

            {!selectedTopics.includes('All') && (
              <div className="flex flex-wrap gap-1.5">
                {selectedTopics.slice(0, 8).map((t) => (
                  <button
                    key={t}
                    onClick={() => handleToggleTopic(t)}
                    className="pf-pop inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-500/15 border border-purple-400/35 text-[11px] font-semibold text-purple-200 hover:bg-purple-500/25 cursor-pointer"
                  >
                    <span className="max-w-[11rem] truncate">{t}</span><X className="w-3 h-3" />
                  </button>
                ))}
                {selectedTopics.length > 8 && <span className="text-[11px] text-slate-500 self-center">+{selectedTopics.length - 8} more</span>}
              </div>
            )}
          </div>

          <TopicPicker
            open={topicSheetOpen}
            onClose={() => setTopicSheetOpen(false)}
            topics={availableTopics}
            counts={topicQuestionCounts}
            selected={selectedTopics}
            onToggle={handleToggleTopic}
            onClear={() => setSelectedTopics(['All'])}
          />

          {/* Exam Type (TAJNEED / MADANI) — separate from the years list */}
          {bankMeta.examTypesAvailable && bankMeta.examTypesAvailable.length > 0 && (
          <div className="pf-rise glass-panel p-5 space-y-3" style={{ animationDelay: '.15s' }}>
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                <span>Exam Type</span>
              </label>
              <span className="text-xs text-slate-400 font-medium">{selectedExamType || 'All Types'}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {bankMeta.examTypesAvailable.map((t) => {
                const active = selectedExamType === t;
                return (
                  <button
                    key={t}
                    onClick={() => { setSelectedExamType(active ? null : t); setSelectedYears([]); }}
                    className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-1 cursor-pointer ${
                      active
                        ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md shadow-cyan-500/20'
                        : 'glass-panel text-slate-300 border-white/10 hover:bg-white/5'
                    }`}
                  >
                    {active && <Check className="w-3 h-3 text-slate-950" />}
                    <span>{t}</span>
                  </button>
                );
              })}
            </div>
          </div>
          )}

          {/* Exam Year Multi-Select — years that belong to the chosen type */}
          {bankId !== 'usmle_bank' && (
          <div className="pf-rise glass-panel p-5 space-y-3" style={{ animationDelay: '.2s' }}>
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-400" />
                <span>Exam Years (Multi-Select)</span>
              </label>
              <span className="text-xs text-slate-400 font-medium">
                {selectedYears.length === 0 ? 'All Years' : `${selectedYears.length} Selected`}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {(selectedExamType && bankMeta.yearsByType ? bankMeta.yearsByType[selectedExamType] || [] : bankMeta.yearsAvailable).map((yr) => {
                const isSelected = selectedYears.includes(yr);
                return (
                  <button
                    key={yr}
                    onClick={() => toggleYear(yr)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1 cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-black shadow-md shadow-emerald-500/20'
                        : 'glass-panel text-slate-300 border-white/10 hover:bg-white/5'
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3 text-slate-950" />}
                    <span>{yr}</span>
                  </button>
                );
              })}
              {selectedExamType && bankMeta.yearsByType && (bankMeta.yearsByType[selectedExamType] || []).length === 0 && (
                <span className="text-xs text-slate-500">No years yet under {selectedExamType}.</span>
              )}
            </div>
          </div>
          )}

          {/* Difficulty Filter */}
          <div className="pf-rise glass-panel p-5 space-y-3" style={{ animationDelay: '.25s' }}>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Layers className="w-4 h-4 text-amber-400" />
              <span>Difficulty Level</span>
            </label>

            <div className="grid grid-cols-4 gap-2">
              {['All', 'Easy', 'Medium', 'Hard'].map((diff) => (
                <button
                  key={diff}
                  onClick={() => setSelectedDifficulty(diff)}
                  className={`py-2 px-3 rounded-xl text-xs font-semibold border text-center transition-all cursor-pointer ${
                    selectedDifficulty === diff
                      ? 'bg-amber-500 text-slate-950 border-amber-400 font-black shadow-md shadow-amber-500/20'
                      : 'glass-panel text-slate-300 border-white/10 hover:bg-white/5'
                  }`}
                >
                  {diff}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Block Summary & Action */}
        <div className="space-y-6">
          <div className="pf-rise glass-panel p-6 space-y-5 sticky top-20 shadow-xl" style={{ animationDelay: '.2s' }}>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300 pb-2 border-b border-white/10">
              Block Configuration
            </h3>

            {/* Questions Matching Summary */}
            <div className="p-4 rounded-xl bg-black/40 border border-white/10 space-y-2">
              <div className="text-[10px] uppercase font-bold text-slate-400">Matching Questions</div>
              <div className="text-3xl font-black text-[#00F2FF] flex items-baseline gap-2">
                <span><CountUp value={matchingQuestions.length} duration={600} /></span>
                <span className="text-xs font-normal text-slate-400">Questions</span>
              </div>
            </div>

            {/* Question Count Selector */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">Block Length (Questions)</label>
              <div className="grid grid-cols-4 gap-2">
                {[5, 10, 15, 20].map((cnt) => (
                  <button
                    key={cnt}
                    onClick={() => setQuestionCount(cnt)}
                    className={`py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      questionCount === cnt
                        ? 'neon-bg font-black'
                        : 'glass-panel text-slate-300 border-white/10 hover:bg-white/5'
                    }`}
                  >
                    {cnt} Qs
                  </button>
                ))}
              </div>
            </div>

            {/* Filter Summary List */}
            <div className="space-y-2 pt-2 text-xs text-slate-400 border-t border-white/10">
              <div className="flex justify-between gap-2">
                <span className="shrink-0">Status:</span>
                <span className="font-semibold text-slate-200 text-right uppercase tracking-wider">
                  {selectedStatusFilter === 'ALL'
                    ? 'All Questions'
                    : selectedStatusFilter === 'COMPLETE'
                    ? 'Complete Questions'
                    : selectedStatusFilter === 'UNCOMPLETED'
                    ? 'Uncompleted Questions'
                    : 'Unused Questions'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="shrink-0">Major:</span>
                <span className="font-semibold text-slate-200 truncate text-right">{selectedMajorsLabel}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="shrink-0">Topic:</span>
                <span className="font-semibold text-slate-200 truncate text-right">{selectedTopicsLabel}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="shrink-0">Type:</span>
                <span className="font-semibold text-slate-200 text-right">{selectedExamType || 'All'}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="shrink-0">Years:</span>
                <span className="font-semibold text-slate-200 truncate text-right">
                  {selectedYears.length === 0 ? 'All' : selectedYears.join(', ')}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="shrink-0">Difficulty:</span>
                <span className="font-semibold text-slate-200 text-right">{selectedDifficulty}</span>
              </div>
            </div>

            {/* Primary Action Button */}
            <button
              onClick={handleStartBlock}
              disabled={matchingQuestions.length === 0 || subscriptionLoading}
              className={`w-full py-3.5 px-4 rounded-xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg cursor-pointer ${
                matchingQuestions.length === 0 || subscriptionLoading
                  ? 'bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed'
                  : !isSubscribed
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20'
                  : 'neon-bg pf-shimmer'
              }`}
            >
              {subscriptionLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
                  <span>Checking Subscription...</span>
                </>
              ) : matchingQuestions.length === 0 ? (
                <span>No Questions Available</span>
              ) : !isSubscribed ? (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Subscribe to Start Block</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-slate-950" />
                  <span>Start Practice Block</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
