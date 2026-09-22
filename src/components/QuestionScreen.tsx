import React, { useState, useEffect } from 'react';
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
  Sparkles,
  RotateCcw
} from 'lucide-react';
import { Block, Question, OptionKey, HighlightRange } from '../types';
import {
  getBlock,
  getQuestionById,
  saveAnswer,
  updateBlockIndex,
  saveAnnotation,
  endBlock,
  getQuestionStats
} from '../services/questionBankService';
import { ExplanationPanel } from './ExplanationPanel';
import { QuestionNavigator } from './QuestionNavigator';
import { EndBlockModal } from './EndBlockModal';
import { BlockSummaryView } from './BlockSummaryView';

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
  const [showNavigator, setShowNavigator] = useState<boolean>(false);
  const [showEndModal, setShowEndModal] = useState<boolean>(false);
  const [isCompletedView, setIsCompletedView] = useState<boolean>(false);

  // Local state for current question highlights & struck options
  const [highlights, setHighlights] = useState<HighlightRange[]>([]);
  const [struckOptions, setStruckOptions] = useState<OptionKey[]>([]);
  const [isHighlightMode, setIsHighlightMode] = useState<boolean>(false);
  const stemRef = React.useRef<HTMLDivElement>(null);

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

  // End Block Handlers
  const handleSaveAndExit = () => {
    endBlock(block.id, 'save');
    onNavigate('home');
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

  return (
    <div className="space-y-6 pb-16">
      {/* Top Controls & Navigation Bar */}
      <div className="sticky top-16 z-30 bg-slate-950/90 backdrop-blur-md py-3 border-b border-slate-800">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowEndModal(true)}
              className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors flex items-center gap-1.5 text-xs font-semibold"
              title="End Block"
            >
              <LogOut className="w-4 h-4 text-rose-400" />
              <span className="hidden sm:inline">End Block</span>
            </button>

            <button
              onClick={() => setShowNavigator(!showNavigator)}
              className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-400 border border-slate-800 transition-colors flex items-center gap-1.5 text-xs font-bold"
            >
              <Layers className="w-4 h-4" />
              <span>
                Q {currentIndex + 1} / {questions.length}
              </span>
            </button>
          </div>

          {/* Question Progress bar */}
          <div className="hidden md:flex flex-1 max-w-xs items-center gap-2">
            <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700">
              <div
                className="bg-cyan-500 h-full transition-all duration-300"
                style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
              />
            </div>
            <span className="text-[11px] font-bold text-slate-400">
              {Math.round(((currentIndex + 1) / questions.length) * 100)}%
            </span>
          </div>

          {/* Highlight Mode Toggle & Tools */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsHighlightMode(!isHighlightMode)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all shadow-md ${
                isHighlightMode
                  ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-amber-500/20 ring-2 ring-amber-400/40'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800'
              }`}
              title="Toggle persistent text highlighting mode"
            >
              <Highlighter className="w-3.5 h-3.5" />
              <span>Highlight Mode: {isHighlightMode ? 'ON' : 'OFF'}</span>
            </button>

            {highlights.length > 0 && (
              <button
                onClick={clearHighlights}
                className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800 text-xs font-semibold transition-all"
                title="Clear all highlights on this question"
              >
                Clear ({highlights.length})
              </button>
            )}
          </div>
        </div>

        {/* Collapsible Question Navigator Drawer */}
        {showNavigator && (
          <div className="mt-3">
            <QuestionNavigator
              block={block}
              questions={questions}
              currentIndex={currentIndex}
              onSelectIndex={handleSelectIndex}
              onClose={() => setShowNavigator(false)}
            />
          </div>
        )}
      </div>

      {/* Question Stem Card */}
      <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-6 shadow-xl space-y-4">
        {/* Header Metadata & Mode Info */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[11px] font-bold uppercase">
              {currentQuestion.major}
            </span>
            <span className="px-2.5 py-0.5 rounded-md bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[11px] font-bold">
              {currentQuestion.topic}
            </span>
            <span className="px-2.5 py-0.5 rounded-md bg-slate-800 text-slate-300 text-[11px] font-medium">
              {currentQuestion.year} Exam
            </span>
            <span
              className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold ${
                currentQuestion.difficulty === 'Hard'
                  ? 'bg-rose-500/10 text-rose-400'
                  : currentQuestion.difficulty === 'Medium'
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'bg-emerald-500/10 text-emerald-400'
              }`}
            >
              {currentQuestion.difficulty}
            </span>
          </div>

          {isHighlightMode && (
            <div className="text-[10px] text-amber-300 font-bold bg-amber-400/10 px-2 py-0.5 rounded-md border border-amber-400/30 flex items-center gap-1">
              <Highlighter className="w-3 h-3" />
              <span>Select stem text to auto-highlight</span>
            </div>
          )}
        </div>

        {/* Question Text Stem with Selection Capture */}
        <div
          ref={stemRef}
          onMouseUp={handleStemSelection}
          onTouchEnd={handleStemSelection}
          className={`text-sm md:text-base font-medium text-slate-100 leading-relaxed pt-1 select-text transition-all ${
            isHighlightMode ? 'cursor-text ring-1 ring-amber-400/20 rounded-xl p-2 bg-amber-400/5' : ''
          }`}
        >
          {renderHighlightedQuestionText(currentQuestion.question)}
        </div>
      </div>

      {/* Answer Options List (A, B, C, D) */}
      <div className="space-y-3">
        {(['A', 'B', 'C', 'D'] as OptionKey[]).map((optionKey) => {
          const optionText = currentQuestion.options[optionKey];
          const isSelected = currentAnswer?.selectedAnswer === optionKey;
          const isCorrect = optionKey === currentQuestion.correctAnswer;
          const isStruck = struckOptions.includes(optionKey);

          let cardStyle =
            'bg-slate-900/90 border-slate-800 text-slate-200 hover:border-slate-700 hover:bg-slate-900';

          if (isAnswered) {
            if (isCorrect) {
              cardStyle = 'bg-emerald-500/15 border-emerald-500/50 text-emerald-200 font-medium';
            } else if (isSelected) {
              cardStyle = 'bg-rose-500/15 border-rose-500/50 text-rose-200 font-medium';
            } else {
              cardStyle = 'bg-slate-950/60 border-slate-800/80 text-slate-500 opacity-60';
            }
          } else if (isStruck) {
            cardStyle = 'bg-slate-950/80 border-slate-900 text-slate-500 line-through opacity-50';
          }

          return (
            <div
              key={optionKey}
              onClick={() => handleSelectOption(optionKey)}
              className={`rounded-2xl border p-4 transition-all duration-150 cursor-pointer relative ${cardStyle}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1">
                  {/* Option Badge */}
                  <span
                    className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 transition-colors border ${
                      isAnswered && isCorrect
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                        : isAnswered && isSelected
                        ? 'bg-rose-500 text-slate-950 border-rose-400'
                        : 'bg-slate-800 text-slate-300 border-slate-700'
                    }`}
                  >
                    {optionKey}
                  </span>

                  <span className="text-xs sm:text-sm pt-0.5 leading-relaxed">{optionText}</span>
                </div>

                {/* Right Status / Action Controls */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Strike-through toggle button */}
                  {!isAnswered && (
                    <button
                      onClick={(e) => toggleStrikeOption(e, optionKey)}
                      className={`p-1.5 rounded-lg border text-xs transition-colors ${
                        isStruck
                          ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                          : 'bg-slate-800/60 text-slate-500 border-slate-800 hover:text-slate-300'
                      }`}
                      title={isStruck ? 'Remove strikeout' : 'Exclude option'}
                    >
                      <Strikethrough className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {isAnswered && isCorrect && (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  )}

                  {isAnswered && isSelected && !isCorrect && (
                    <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Formatted Explanation Panel (Revealed once answered) */}
      {isAnswered && (
        <ExplanationPanel
          question={currentQuestion}
          selectedAnswer={currentAnswer.selectedAnswer}
          stats={stats}
        />
      )}

      {/* Bottom Navigation Controls */}
      <div className="flex items-center justify-between gap-3 pt-4 border-t border-slate-800">
        <button
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className={`px-4 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all ${
            currentIndex === 0
              ? 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-200 border-slate-700'
          }`}
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Previous</span>
        </button>

        <div className="text-xs font-semibold text-slate-400">
          Question {currentIndex + 1} of {questions.length}
        </div>

        {currentIndex < questions.length - 1 ? (
          <button
            onClick={handleNext}
            className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-extrabold flex items-center gap-1.5 transition-all shadow-md shadow-cyan-500/20"
          >
            <span>Next</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={() => setShowEndModal(true)}
            className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold flex items-center gap-1.5 transition-all shadow-md shadow-emerald-500/20"
          >
            <span>Finish Block</span>
            <CheckCircle2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* End Block Confirmation Modal */}
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
