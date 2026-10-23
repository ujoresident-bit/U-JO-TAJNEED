import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { recordReview } from '../services/reviewService';
import { loadFirstAidParts, bestPartForQuestion, LinkablePart } from '../services/firstAidLinkService';
import {
  ArrowLeft,
  Layers,
  Highlighter,
  Strikethrough,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Flag,
  FlaskConical,
  Dna,
  Keyboard
} from 'lucide-react';
import { Block, Question, OptionKey, HighlightRange } from '../types';
import {
  getBlock,
  getQuestionById,
  saveAnswer,
  updateBlockIndex,
  saveAnnotation,
  setQuestionFlag,
  endBlock,
  getQuestionStats
} from '../services/questionBankService';
import { ExplanationPanel } from './ExplanationPanel';
import { ExamHelix, HelixState } from './ExamHelix';
import { ExamLabsDrawer } from './ExamLabsDrawer';
import { EndBlockModal } from './EndBlockModal';
import { FeedbackButton } from './FeedbackButton';
import { QuestionVideos } from './QuestionVideos';
import { BlockSummaryView } from './BlockSummaryView';

const FS_STEPS = [0.9, 1, 1.15, 1.3];
const lsGet = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const fmtT = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;

interface QuestionScreenProps {
  blockId: string;
  onNavigate: (view: string, params?: any) => void;
  reviewMode?: 'incorrect' | 'all';
}

export const QuestionScreen: React.FC<QuestionScreenProps> = ({
  blockId,
  onNavigate,
  reviewMode
}) => {
  const [block, setBlock] = useState<Block | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [showDna, setShowDna] = useState<boolean>(() => lsGet('ujo_dna') !== '0');
  const [fsIdx, setFsIdx] = useState<number>(() => { const n = parseInt(lsGet('ujo_fs') || '1', 10); return n >= 0 && n < FS_STEPS.length ? n : 1; });
  const [showTimer, setShowTimer] = useState<boolean>(() => lsGet('ujo_timer') !== '0');
  const [labsOpen, setLabsOpen] = useState<boolean>(false);
  const [helpOpen, setHelpOpen] = useState<boolean>(false);
  const [blockSec, setBlockSec] = useState<number>(0);
  const [qSec, setQSec] = useState<number>(0);
  const [showEndModal, setShowEndModal] = useState<boolean>(false);
  const [isCompletedView, setIsCompletedView] = useState<boolean>(false);

  // Local state for current question highlights & struck options
  const [highlights, setHighlights] = useState<HighlightRange[]>([]);
  const [struckOptions, setStruckOptions] = useState<OptionKey[]>([]);
  const [isHighlightMode, setIsHighlightMode] = useState<boolean>(false);
  const stemRef = React.useRef<HTMLDivElement>(null);

  // Human Medicine: the First Aid part that best matches this question's topic.
  const [faPart, setFaPart] = useState<LinkablePart | null>(null);
  useEffect(() => {
    const q = questions[currentIndex];
    if (!q || q.bankId !== 'human_medicine') { setFaPart(null); return; }
    let cancelled = false;
    loadFirstAidParts().then((parts) => {
      if (!cancelled) setFaPart(bestPartForQuestion(q, parts));
    });
    return () => { cancelled = true; };
  }, [questions, currentIndex]);

  useEffect(() => {
    const loadedBlock = getBlock(blockId);
    if (loadedBlock) {
      setBlock(loadedBlock);

      // Load questions
      const qList: Question[] = [];
      loadedBlock.questionIds.forEach((id) => {
        const q = getQuestionById(id);
        if (q) qList.push(q);
      });
      setQuestions(qList);

      if (loadedBlock.status === 'COMPLETED' && !reviewMode) {
        setIsCompletedView(true);
      } else {
        setCurrentIndex(loadedBlock.currentIndex || 0);
      }
    }
  }, [blockId, reviewMode]);

  // Sync annotations when currentIndex changes
  useEffect(() => {
    if (block && questions[currentIndex]) {
      const qId = questions[currentIndex].id;
      const ann = block.annotations[qId];
      if (ann) {
        setHighlights(ann.highlightData || []);
        setStruckOptions(ann.struckOptions || []);
      } else {
        setHighlights([]);
        setStruckOptions([]);
      }
    }
  }, [currentIndex, block, questions]);

  // Selection handler when Highlight Mode is ON
  const handleStemSelection = () => {
    if (!isHighlightMode || !block || !questions[currentIndex]) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString().trim();
    if (selectedText.length >= 2) {
      // Avoid duplicate highlights of exact same string
      if (highlights.some((h) => h.text === selectedText)) return;

      const newHighlight: HighlightRange = {
        id: `hl_${Date.now()}`,
        text: selectedText
      };

      const updatedHighlights = [...highlights, newHighlight];
      setHighlights(updatedHighlights);
      const updatedBlock = saveAnnotation(block.id, questions[currentIndex].id, updatedHighlights, struckOptions);
      setBlock({ ...updatedBlock });

      selection.removeAllRanges();
    }
  };

  const handleRemoveHighlight = (e: React.MouseEvent, hlId: string) => {
    e.stopPropagation();
    if (!block || !questions[currentIndex]) return;

    const updatedHighlights = highlights.filter((h) => h.id !== hlId);
    setHighlights(updatedHighlights);
    const updatedBlock = saveAnnotation(block.id, questions[currentIndex].id, updatedHighlights, struckOptions);
    setBlock({ ...updatedBlock });
  };

  const clearHighlights = () => {
    if (!block || !questions[currentIndex]) return;
    setHighlights([]);
    const updatedBlock = saveAnnotation(block.id, questions[currentIndex].id, [], struckOptions);
    setBlock({ ...updatedBlock });
  };

  // Timers (session time on this block, and time on the current question)
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      setBlockSec((v) => v + 1);
      setQSec((v) => v + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { setQSec(0); }, [currentIndex]);

  // Keyboard shortcuts: the latest handler lives in a ref so the listener is bound once.
  const keyRef = useRef<(e: KeyboardEvent) => void>();
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current?.(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const changeFs = (d: number) => {
    const n = Math.max(0, Math.min(FS_STEPS.length - 1, fsIdx + d));
    setFsIdx(n); lsSet('ujo_fs', String(n));
  };
  const toggleTimer = () => { const v = !showTimer; setShowTimer(v); lsSet('ujo_timer', v ? '1' : '0'); };
  const toggleDna = () => { const v = !showDna; setShowDna(v); lsSet('ujo_dna', v ? '1' : '0'); };

  if (!block || questions.length === 0) {
    return (
      <div className="py-20 text-center space-y-4">
        <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs text-slate-400">Loading question block...</p>
      </div>
    );
  }

  if (isCompletedView) {
    return (
      <BlockSummaryView
        block={block}
        questions={questions}
        onReviewBlock={(mode) => {
          setIsCompletedView(false);
          setCurrentIndex(0);
        }}
        onNavigate={onNavigate}
      />
    );
  }

  const currentQuestion = questions[currentIndex];
  const qId = currentQuestion.id;
  const currentAnswer = block.answers[qId];
  const isAnswered = Boolean(currentAnswer);
  const stats = getQuestionStats(qId);

  // Answering action
  const handleSelectOption = (optionKey: OptionKey) => {
    if (isAnswered) return; // Locked once answered
    const updatedBlock = saveAnswer(block.id, qId, optionKey);
    setBlock({ ...updatedBlock });
    // Spaced repetition: wrong answers get scheduled for review.
    recordReview('question', qId, optionKey === currentQuestion.correctAnswer, currentQuestion.bankId || 'human_medicine');
  };

  // Navigation handlers
  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);
      const updated = updateBlockIndex(block.id, nextIdx);
      setBlock({ ...updated });
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      const prevIdx = currentIndex - 1;
      setCurrentIndex(prevIdx);
      const updated = updateBlockIndex(block.id, prevIdx);
      setBlock({ ...updated });
    }
  };

  const handleSelectIndex = (idx: number) => {
    setCurrentIndex(idx);
    const updated = updateBlockIndex(block.id, idx);
    setBlock({ ...updated });
  };

  // Strike-through option handler
  const toggleStrikeOption = (e: React.MouseEvent, optionKey: OptionKey) => {
    e.stopPropagation();
    let updatedStruck: OptionKey[];
    if (struckOptions.includes(optionKey)) {
      updatedStruck = struckOptions.filter((o) => o !== optionKey);
    } else {
      updatedStruck = [...struckOptions, optionKey];
    }
    setStruckOptions(updatedStruck);
    const updatedBlock = saveAnnotation(block.id, qId, highlights, updatedStruck);
    setBlock({ ...updatedBlock });
  };

  // Flag for review
  const isFlagged = Boolean(block.annotations[qId]?.flagged);
  const toggleFlag = () => {
    const updated = setQuestionFlag(block.id, qId, !isFlagged);
    setBlock({ ...updated });
  };

  keyRef.current = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { setLabsOpen(false); setHelpOpen(false); (document.activeElement as HTMLElement | null)?.blur?.(); return; }
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey || showEndModal || isCompletedView) return;
    const k = e.key.toLowerCase();
    if (/^[a-d]$/.test(k) || /^[1-4]$/.test(k)) {
      const opt = (/^[a-d]$/.test(k) ? k.toUpperCase() : 'ABCD'[Number(k) - 1]) as OptionKey;
      handleSelectOption(opt);
    } else if (k === 'arrowright') handleNext();
    else if (k === 'arrowleft') handlePrev();
    else if (k === 'h') setIsHighlightMode((v) => !v);
    else if (k === 'f') toggleFlag();
    else if (k === 'l') setLabsOpen((v) => !v);
    else if (k === '?' || k === '/') setHelpOpen((v) => !v);
  };

  const helixStates: HelixState[] = questions.map((q) => {
    const a = block.answers[q.id];
    return a ? (a.isCorrect ? 'ok' : 'bad') : null;
  });
  const helixFlags = questions.map((q) => Boolean(block.annotations[q.id]?.flagged));

  // End Block Handlers
  const handleSaveAndExit = () => {
    endBlock(block.id, 'save');
    onNavigate('back');
  };

  const handleFinishBlock = () => {
    const finished = endBlock(block.id, 'finish');
    setBlock({ ...finished });
    setIsCompletedView(true);
    setShowEndModal(false);
  };

  // Render question stem with highlighted snippets
  const renderHighlightedQuestionText = (stem: string) => {
    if (highlights.length === 0) return stem;

    let result: React.ReactNode[] = [stem];

    highlights.forEach((hl) => {
      const newResult: React.ReactNode[] = [];
      result.forEach((chunk) => {
        if (typeof chunk === 'string') {
          const parts = chunk.split(hl.text);
          parts.forEach((part, idx) => {
            newResult.push(part);
            if (idx < parts.length - 1) {
              newResult.push(
                <mark
                  key={`${hl.id}_${idx}`}
                  onClick={(e) => handleRemoveHighlight(e, hl.id)}
                  title="Click to remove highlight"
                  className="bg-amber-300/30 text-amber-100 font-semibold border-b-2 border-amber-400 px-1 py-0.5 rounded cursor-pointer hover:bg-rose-500/30 hover:border-rose-400 transition-colors inline"
                >
                  {hl.text}
                </mark>
              );
            }
          });
        } else {
          newResult.push(chunk);
        }
      });
      result = newResult;
    });

    return result;
  };

  const answeredCount = Object.keys(block.answers).length;


  const pct = ((currentIndex + 1) / questions.length) * 100;
  const optKeys = ['A', 'B', 'C', 'D'] as OptionKey[];
  const diffCls = currentQuestion.difficulty === 'Hard' ? '#FF8FA3' : currentQuestion.difficulty === 'Medium' ? '#E8B66A' : '#6FE0B4';

  return (
    <div className="ex-root" style={{ ['--fs' as any]: FS_STEPS[fsIdx] }}>
      <style>{EX_CSS}</style>

      <div className={`ex-lay ${showDna ? '' : 'nodna'}`}>
        {showDna && (
          <aside className="ex-dna" aria-label="Question navigator">
            <ExamHelix
              total={questions.length}
              current={currentIndex}
              states={helixStates}
              flags={helixFlags}
              onSelect={handleSelectIndex}
            />
          </aside>
        )}

        <div className="ex-main">
          {/* Header */}
          <div className="ex-hd">
            <button className="ex-ghost" onClick={() => setShowEndModal(true)} title="End block">
              <LogOut className="w-[15px] h-[15px]" /><span className="lb">End block</span>
            </button>
            <button className={`ex-timer ${showTimer ? '' : 'off'}`} onClick={toggleTimer} title="Click to hide or show the timer" aria-label="Timer">
              {showTimer ? (<><span>{fmtT(blockSec)}</span><i>·</i><span>Q {fmtT(qSec)}</span></>) : <span>Timer</span>}
            </button>
            <div className="ex-tools">
              <span className="ex-fs" role="group" aria-label="Text size">
                <button onClick={() => changeFs(-1)} aria-label="Smaller text" disabled={fsIdx === 0}>A<small>−</small></button>
                <button onClick={() => changeFs(1)} aria-label="Larger text" disabled={fsIdx === FS_STEPS.length - 1}>A<small>+</small></button>
              </span>
              <button className="ex-ghost ex-flag" aria-pressed={isFlagged} onClick={toggleFlag} title="Flag for review (F)">
                <Flag className="w-[15px] h-[15px]" /><span className="lb keep">{isFlagged ? 'Flagged' : 'Flag'}</span>
              </button>
              <button className="ex-ghost ex-labbtn" aria-pressed={labsOpen} onClick={() => setLabsOpen((v) => !v)} title="Lab values (L)">
                <FlaskConical className="w-[15px] h-[15px]" /><span className="lb">Labs</span>
              </button>
              <button className="ex-ghost ex-dnabtn" aria-pressed={showDna} onClick={toggleDna} title="Show or hide the question helix">
                <Dna className="w-[15px] h-[15px]" /><span className="lb">{showDna ? 'Hide DNA' : 'Show DNA'}</span>
              </button>
              <button className={`ex-ghost ${isHighlightMode ? 'on' : ''}`} aria-pressed={isHighlightMode} onClick={() => setIsHighlightMode((v) => !v)} title="Highlight (H)">
                <Highlighter className="w-[15px] h-[15px]" /><span className="lb keep">Highlight</span>
              </button>
              {highlights.length > 0 && (
                <button className="ex-ghost" onClick={clearHighlights} title="Clear highlights on this question">
                  <span className="lb keep">Clear ({highlights.length})</span>
                </button>
              )}
              <button className="ex-ghost" onClick={() => setHelpOpen((v) => !v)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts" style={{ padding: '0 12px' }}>
                <Keyboard className="w-[15px] h-[15px]" />
              </button>
            </div>
          </div>
          <div className="ex-prog"><i style={{ width: `${pct}%` }} /></div>

          {/* Question */}
          <div className="ex-meta">
            <span>{currentQuestion.major}</span>
            <span style={{ ['--d' as any]: '#B4A8F5' }}>{currentQuestion.topic}</span>
            <span style={{ ['--d' as any]: '#E8B66A' }}>{currentQuestion.year} Exam</span>
            <span style={{ ['--d' as any]: diffCls }}>{currentQuestion.difficulty}</span>
            <span className="ml-auto !p-0 !before:hidden"><FeedbackButton kind="question" itemId={currentQuestion.id} /></span>
          </div>

          <div
            ref={stemRef}
            onMouseUp={handleStemSelection}
            onTouchEnd={handleStemSelection}
            className={`ex-stem ${isHighlightMode ? 'hl' : ''}`}
          >
            {renderHighlightedQuestionText(currentQuestion.question)}
          </div>

          <div className="ex-opts">
            {optKeys.map((optionKey) => {
              const isSelected = currentAnswer?.selectedAnswer === optionKey;
              const isCorrect = optionKey === currentQuestion.correctAnswer;
              const isStruck = struckOptions.includes(optionKey);
              const cls = isAnswered
                ? isCorrect ? 'right' : isSelected ? 'wrong' : 'dim'
                : isStruck ? 'struck' : '';
              return (
                <div
                  key={optionKey}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectOption(optionKey)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectOption(optionKey); } }}
                  className={`ex-opt ${cls}`}
                >
                  <span className="ex-badge">{optionKey}</span>
                  <span className="ex-ot">{currentQuestion.options[optionKey]}</span>
                  {!isAnswered && (
                    <button
                      onClick={(e) => toggleStrikeOption(e, optionKey)}
                      className={`ex-strike ${isStruck ? 'on' : ''}`}
                      title={isStruck ? 'Remove strikeout' : 'Exclude option'}
                      aria-label={isStruck ? 'Remove strikeout' : 'Exclude option'}
                    >
                      <Strikethrough className="w-4 h-4" />
                    </button>
                  )}
                  {isAnswered && isCorrect && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
                  {isAnswered && isSelected && !isCorrect && <XCircle className="w-5 h-5 text-rose-400 shrink-0" />}
                </div>
              );
            })}
          </div>

          {isAnswered && (
            <div className="mt-6">
              <ExplanationPanel question={currentQuestion} selectedAnswer={currentAnswer.selectedAnswer} stats={stats} />
            </div>
          )}
          {isAnswered && <QuestionVideos questionId={currentQuestion.id} />}
          {isAnswered && faPart && (
            <button
              onClick={() => onNavigate('smart_first_aid', { partId: faPart.id })}
              className="mt-4 w-full px-4 py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/15 text-cyan-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <Layers className="w-4 h-4" />
              <span>Read about this in First Aid · {faPart.title}</span>
            </button>
          )}

          {/* Bottom navigation */}
          <div className="ex-nav">
            <div className="in">
              <button className="pv" onClick={handlePrev} disabled={currentIndex === 0} aria-label="Previous question">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="mid">
                <b>{currentIndex + 1}</b>
                <div className="ex-mono">of {questions.length} · {answeredCount} answered</div>
              </div>
              {currentIndex < questions.length - 1 ? (
                <button className="nx" onClick={handleNext}>
                  <span>Next</span><span className="a"><ChevronRight className="w-4 h-4" /></span>
                </button>
              ) : (
                <button className="nx fin" onClick={() => setShowEndModal(true)}>
                  <span>Finish block</span><span className="a"><CheckCircle2 className="w-4 h-4" /></span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {typeof document !== 'undefined' && createPortal(
        <div className="ex-root ex-portal" style={{ ['--fs' as any]: FS_STEPS[fsIdx] }}>
          <style>{EX_CSS}</style>
          {helpOpen && (
            <>
              <div className="ex-popclose" onClick={() => setHelpOpen(false)} />
              <div className="ex-pop" role="dialog" aria-label="Keyboard shortcuts">
                <div className="ex-mono" style={{ color: '#4FD6EC', marginBottom: 10 }}>Keyboard</div>
                <div className="kl"><kbd>A</kbd><kbd>B</kbd><kbd>C</kbd><kbd>D</kbd><span>Choose answer</span></div>
                <div className="kl"><kbd>←</kbd><kbd>→</kbd><span>Previous / next</span></div>
                <div className="kl"><kbd>H</kbd><span>Highlight mode</span></div>
                <div className="kl"><kbd>F</kbd><span>Flag question</span></div>
                <div className="kl"><kbd>L</kbd><span>Lab values</span></div>
                <div className="kl"><kbd>Esc</kbd><span>Close panels</span></div>
              </div>
            </>
          )}
          <ExamLabsDrawer open={labsOpen} onClose={() => setLabsOpen(false)} />
        </div>,
        document.body
      )}

      {showEndModal && (
        <EndBlockModal
          onSaveAndExit={handleSaveAndExit}
          onFinishBlock={handleFinishBlock}
          onCancel={() => setShowEndModal(false)}
          answeredCount={answeredCount}
          totalQuestions={questions.length}
        />
      )}
    </div>
  );
};

const EX_CSS = `
.ex-root{--cy:#4FD6EC;--ice:#CFEFF8;--dim:#93A3B6;--ink:#EAF1F7;--rose:#FF8FA3;--vi:#B4A8F5;--am:#E8B66A;--gr:#6FE0B4;--serif:'Instrument Serif',Georgia,serif;--mono:'Geist Mono',ui-monospace,monospace;--sans:'Geist','Inter',system-ui,sans-serif;color:var(--ink);font-family:var(--sans)}
.ex-root:not(.ex-portal){padding-bottom:24px}
@media(min-width:1200px){.ex-root:not(.ex-portal){margin-inline:calc(50% - 50vw + 24px)}.ex-root:not(.ex-portal) .ex-lay{max-width:1560px;margin-inline:auto}}
.ex-mono{font:500 10.5px var(--mono);letter-spacing:.14em;text-transform:uppercase}
.ex-serif{font-family:var(--serif);font-weight:400}
.ex-lay{display:grid;grid-template-columns:minmax(0,1fr)}
@media(min-width:1000px){.ex-lay{grid-template-columns:120px minmax(0,1fr);gap:26px}.ex-lay.nodna{grid-template-columns:minmax(0,1fr)}}
.ex-main{min-width:0}
.ex-dna{position:relative;height:84px;margin:0 -4px 6px;-webkit-mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent);mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)}
.ex-helix-cv{width:100%;height:100%;display:block;cursor:pointer;touch-action:pan-x}
@media(min-width:1000px){.ex-dna{position:sticky;top:76px;height:min(80vh,820px);margin:0;-webkit-mask-image:linear-gradient(180deg,transparent,#000 9%,#000 91%,transparent);mask-image:linear-gradient(180deg,transparent,#000 9%,#000 91%,transparent)}.ex-helix-cv{touch-action:pan-y}}
.ex-hd{display:flex;flex-wrap:wrap;align-items:center;gap:10px;row-gap:8px;min-height:46px}
.ex-tools{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-left:auto}
.ex-ghost{display:inline-flex;align-items:center;gap:7px;min-height:42px;padding:0 14px;border-radius:999px;border:1px solid rgba(207,239,248,.14);background:rgba(207,239,248,.04);color:var(--dim);font:500 12px var(--sans);cursor:pointer}
.ex-ghost:hover{color:var(--ink)}
.ex-ghost[aria-pressed=true].ex-dnabtn{border-color:rgba(79,214,236,.5);color:var(--cy)}
.ex-ghost[aria-pressed=true].ex-flag{border-color:rgba(255,143,163,.6);color:var(--rose);background:rgba(255,143,163,.08)}
.ex-ghost[aria-pressed=true].ex-labbtn{border-color:rgba(180,168,245,.6);color:var(--vi)}
.ex-ghost.on{background:var(--am);border-color:var(--am);color:#1a1204;box-shadow:0 0 24px -4px rgba(232,182,106,.7)}
@media(max-width:620px){.ex-ghost .lb:not(.keep){display:none}.ex-ghost{padding:0 13px}}
.ex-timer{display:inline-flex;align-items:center;gap:8px;min-height:42px;padding:0 6px;background:none;border:0;color:var(--dim);font:500 12px var(--mono);letter-spacing:.06em;font-variant-numeric:tabular-nums;cursor:pointer}
.ex-timer i{font-style:normal;opacity:.5}.ex-timer.off{font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.6}
.ex-fs{display:inline-flex;border-radius:999px;border:1px solid rgba(207,239,248,.14);background:rgba(207,239,248,.04);overflow:hidden}
.ex-fs button{min-height:42px;min-width:44px;padding:0 10px;border:0;background:none;color:var(--dim);font:500 14px var(--serif);cursor:pointer}
.ex-fs button:hover:not(:disabled){color:var(--ink)}.ex-fs button:disabled{opacity:.35;cursor:default}.ex-fs small{font:500 11px var(--mono);margin-left:1px}
.ex-prog{height:2px;border-radius:2px;background:rgba(207,239,248,.1);overflow:hidden;margin:6px 0 0}.ex-prog i{display:block;height:100%;background:var(--cy);box-shadow:0 0 10px var(--cy);transition:width .5s}
.ex-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin-top:22px;font:500 10.5px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}
.ex-meta>span{display:inline-flex;align-items:center;gap:7px}
.ex-meta>span::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--d,var(--cy))}
.ex-meta>span.ml-auto::before{display:none}
.ex-stem{margin:10px 0 0;font-family:var(--serif);font-weight:400;font-size:calc(clamp(21px,2.05vw,32px)*var(--fs));line-height:1.42;color:#F4F8FB;user-select:text;-webkit-user-select:text}
.ex-stem.hl{cursor:text}
.ex-stem.hl::selection,.ex-stem.hl *::selection{background:var(--am);color:#120c02}
.ex-stem mark{background:var(--am);color:#120c02;font-weight:400;padding:0 .12em;border-radius:4px;cursor:pointer}
.ex-stem mark:hover{background:var(--rose)}
.ex-opts{display:grid;gap:10px;margin-top:26px}
.ex-opt{position:relative;display:flex;align-items:center;gap:14px;min-height:56px;padding:12px 14px;border-radius:18px;border:1px solid rgba(207,239,248,.12);background:rgba(207,239,248,.025);color:#DCE6EF;font-family:var(--sans);font-size:calc(clamp(15px,1.15vw,17px)*var(--fs));line-height:1.4;transition:border-color .25s,background .25s;cursor:pointer}
.ex-opt:hover{border-color:rgba(79,214,236,.4)}
.ex-opt:focus-visible{outline:2px solid var(--cy);outline-offset:3px}
.ex-badge{flex:none;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;border:1px solid rgba(207,239,248,.2);font:500 12px var(--mono);color:var(--dim)}
.ex-ot{flex:1;min-width:0}
.ex-strike{flex:none;width:36px;height:36px;border-radius:12px;display:grid;place-items:center;border:1px solid rgba(207,239,248,.1);background:none;color:var(--dim);cursor:pointer}
.ex-strike.on{color:var(--am);border-color:rgba(232,182,106,.5)}
.ex-opt.struck{opacity:.45}.ex-opt.struck .ex-ot{text-decoration:line-through}
.ex-opt.right{cursor:default;border-color:rgba(111,224,180,.5);background:rgba(111,224,180,.08)}.ex-opt.right .ex-badge{background:var(--gr);border-color:var(--gr);color:#03131B}
.ex-opt.wrong{cursor:default;border-color:rgba(255,143,163,.5);background:rgba(255,143,163,.08)}.ex-opt.wrong .ex-badge{background:var(--rose);border-color:var(--rose);color:#1d070c}
.ex-opt.dim{cursor:default;opacity:.55}
.ex-nav{position:sticky;bottom:0;z-index:20;margin-top:18px;padding:22px 0 calc(10px + env(safe-area-inset-bottom,0px));background:linear-gradient(180deg,rgba(2,6,23,0),rgba(2,6,23,.94) 45%)}
.ex-nav .in{display:flex;align-items:center;gap:10px;padding:8px;border-radius:22px;border:1px solid rgba(207,239,248,.13);background:#0c141a;box-shadow:0 20px 60px -24px rgba(79,214,236,.4)}
.ex-nav .pv{width:54px;height:54px;border-radius:16px;border:1px solid rgba(207,239,248,.14);background:none;color:var(--ink);display:grid;place-items:center;flex:none;cursor:pointer}
.ex-nav .pv:disabled{opacity:.3;cursor:default}
.ex-nav .mid{flex:1;text-align:center;min-width:0}.ex-nav .mid b{font:400 24px/1 var(--serif)}.ex-nav .mid .ex-mono{font-size:9.5px;color:var(--dim);margin-top:4px}
.ex-nav .nx{height:54px;padding:0 10px 0 22px;border:0;border-radius:16px;display:flex;align-items:center;gap:14px;font:600 15px var(--sans);color:#03131B;background:linear-gradient(180deg,#DDF4FB,#BFE6F2);box-shadow:0 10px 36px -14px rgba(79,214,236,.7);flex:none;cursor:pointer}
.ex-nav .nx.fin{background:linear-gradient(180deg,#C9F5E1,#8FE3BE)}
.ex-nav .nx .a{width:36px;height:36px;border-radius:11px;background:#03131B;color:var(--ice);display:grid;place-items:center}
.ex-popclose{position:fixed;inset:0;z-index:59}
.ex-pop{position:fixed;z-index:60;top:72px;right:max(16px,env(safe-area-inset-right,0px));width:260px;padding:16px;border-radius:20px;border:1px solid rgba(207,239,248,.14);background:#0c141a;box-shadow:0 30px 80px -30px #000}
.ex-pop .kl{display:flex;align-items:center;gap:6px;margin-top:9px;font-size:13px;color:#C9D6E2}.ex-pop .kl span{margin-left:auto;color:var(--dim)}
.ex-pop kbd{font:500 11px var(--mono);min-width:24px;height:24px;padding:0 6px;border-radius:7px;border:1px solid rgba(207,239,248,.2);background:rgba(207,239,248,.05);display:inline-grid;place-items:center;color:var(--ice)}
.ex-scrim{position:fixed;inset:0;background:rgba(3,6,9,.6);z-index:70;opacity:0;pointer-events:none;transition:opacity .3s}.ex-scrim.on{opacity:1;pointer-events:auto}
@media(min-width:621px){.ex-scrim{background:transparent}}
.ex-drawer{position:fixed;z-index:80;right:0;top:0;bottom:0;width:min(400px,100%);padding:18px max(18px,env(safe-area-inset-right,0px)) 18px 20px;border-left:1px solid rgba(207,239,248,.12);background:linear-gradient(180deg,#10161d,#0a0e13);transform:translateX(105%);transition:transform .45s cubic-bezier(.16,1,.3,1);display:flex;flex-direction:column;gap:12px;box-shadow:-30px 0 80px -40px #000;visibility:hidden;color:var(--ink);font-family:var(--sans)}
.ex-drawer.on{transform:none;visibility:visible}
@media(max-width:620px){.ex-drawer{top:auto;left:0;width:100%;max-height:82vh;border-left:0;border-top:1px solid rgba(207,239,248,.12);border-radius:26px 26px 0 0;transform:translateY(105%)}.ex-drawer.on{transform:none}}
.ex-x{width:42px;height:42px;border-radius:12px;border:1px solid rgba(207,239,248,.14);background:none;color:var(--dim);display:grid;place-items:center;cursor:pointer}
.ex-sample{padding:10px 12px;border-radius:12px;border:1px dashed rgba(232,182,106,.45);color:#F2D9A8;font-size:12px;line-height:1.5}
.ex-sin{width:100%;height:48px;border-radius:14px;border:1px solid rgba(207,239,248,.16);background:rgba(207,239,248,.04);color:var(--ink);font:400 15px var(--sans);padding:0 16px}
.ex-sin:focus{outline:2px solid var(--cy)}
.ex-labs{overflow:auto;display:grid;gap:4px;align-content:start;padding-right:4px}
.ex-labs h4{margin:14px 0 4px;font:500 10.5px var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--cy)}
.ex-lr{display:flex;align-items:baseline;gap:10px;padding:10px 12px;margin-bottom:4px;border-radius:12px;background:rgba(207,239,248,.03);font-size:14px}
.ex-lr b{font-weight:500;color:#DCE6EF;flex:1;min-width:0}.ex-lr span{font:500 12.5px var(--mono);color:var(--ice);font-variant-numeric:tabular-nums;text-align:right}.ex-lr small{font:500 11px var(--mono);color:var(--dim);min-width:48px}
@media(prefers-reduced-motion:reduce){.ex-drawer{transition:none}}
`;
