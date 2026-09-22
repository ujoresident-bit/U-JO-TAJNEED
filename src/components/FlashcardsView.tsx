import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Layers,
  HelpCircle,
  CheckCircle2
} from 'lucide-react';
import { getFlashcards, syncFlashcardsFromSupabase } from '../services/flashcardService';
import { Flashcard } from '../types';

interface FlashcardsViewProps {
  onNavigate: (view: string) => void;
}

export const FlashcardsView: React.FC<FlashcardsViewProps> = ({ onNavigate }) => {
  const [flashcards, setFlashcards] = useState<Flashcard[]>(getFlashcards());
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);

  useEffect(() => {
    syncFlashcardsFromSupabase().then((syncedCards) => {
      if (syncedCards && syncedCards.length > 0) {
        setFlashcards(syncedCards);
      }
    }).catch(() => {});
  }, []);

  const handleNext = () => {
    if (currentIndex < flashcards.length - 1) {
      setIsFlipped(false);
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setIsFlipped(false);
      setCurrentIndex((prev) => prev - 1);
    }
  };

  const handleRestart = () => {
    setIsFlipped(false);
    setCurrentIndex(0);
  };

  const currentCard = flashcards[currentIndex];

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => onNavigate('home')}
          className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-slate-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Home</span>
        </button>

        {flashcards.length > 0 && (
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-[#00F2FF] text-xs font-bold">
            <Layers className="w-3.5 h-3.5" />
            <span>
              Card {currentIndex + 1} of {flashcards.length}
            </span>
          </div>
        )}
      </div>

      {/* Main Container */}
      {flashcards.length === 0 ? (
        <div className="glass-panel border-cyan-500/30 p-10 text-center space-y-4 my-8">
          <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-[#00F2FF] flex items-center justify-center mx-auto shadow-lg shadow-cyan-500/10">
            <Layers className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-bold text-slate-100">No flashcards available yet.</h2>
            <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
              Medical flashcards will appear here once created by the administrator. Check back soon for revision cards.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6 flex flex-col items-center">
          {/* Interactive 3D Flip Card */}
          <div
            onClick={() => setIsFlipped(!isFlipped)}
            className="relative w-full max-w-2xl h-80 sm:h-96 cursor-pointer select-none [perspective:1000px]"
          >
            <div
              className={`relative w-full h-full duration-500 [transform-style:preserve-3d] transition-transform ${
                isFlipped ? '[transform:rotateY(180deg)]' : ''
              }`}
            >
              {/* Front Side - Question */}
              <div className="absolute inset-0 w-full h-full rounded-2xl glass-panel p-6 sm:p-8 flex flex-col justify-between border-cyan-500/30 shadow-2xl [backface-visibility:hidden]">
                <div className="flex items-center justify-between border-b border-white/5 pb-3">
                  <div className="flex items-center gap-2 text-cyan-400">
                    <HelpCircle className="w-4 h-4 text-[#00F2FF]" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-200">
                      Question
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500">
                    Click card to flip
                  </span>
                </div>

                <div className="my-auto text-center px-2 sm:px-6">
                  <p className="text-base sm:text-xl font-medium text-slate-100 leading-relaxed whitespace-pre-wrap">
                    {currentCard.question}
                  </p>
                </div>

                <div className="border-t border-white/5 pt-3 text-center">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">
                    Front Side
                  </span>
                </div>
              </div>

              {/* Back Side - Answer */}
              <div className="absolute inset-0 w-full h-full rounded-2xl glass-panel p-6 sm:p-8 flex flex-col justify-between border-emerald-500/40 bg-slate-900/95 shadow-2xl [backface-visibility:hidden] [transform:rotateY(180deg)]">
                <div className="flex items-center justify-between border-b border-white/5 pb-3">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                      Answer
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500">
                    Click card to flip back
                  </span>
                </div>

                <div className="my-auto text-center px-2 sm:px-6">
                  <p className="text-base sm:text-xl font-semibold text-emerald-100 leading-relaxed whitespace-pre-wrap">
                    {currentCard.answer}
                  </p>
                </div>

                <div className="border-t border-white/5 pt-3 text-center">
                  <span className="text-[10px] text-emerald-500/80 uppercase font-bold tracking-widest">
                    Back Side
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Navigation Bar */}
          <div className="flex items-center gap-3 w-full max-w-2xl justify-between pt-2">
            <button
              onClick={handlePrev}
              disabled={currentIndex === 0}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                currentIndex === 0
                  ? 'bg-slate-900 text-slate-600 border border-slate-800 cursor-not-allowed'
                  : 'glass-panel text-slate-200 hover:bg-white/10 hover:text-white cursor-pointer'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Previous</span>
            </button>

            <button
              onClick={handleRestart}
              className="px-3.5 py-2.5 rounded-xl glass-panel text-slate-400 hover:text-slate-200 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
              title="Restart from Card 1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Restart</span>
            </button>

            <button
              onClick={handleNext}
              disabled={currentIndex === flashcards.length - 1}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                currentIndex === flashcards.length - 1
                  ? 'bg-slate-900 text-slate-600 border border-slate-800 cursor-not-allowed'
                  : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20 cursor-pointer'
              }`}
            >
              <span>Next</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
