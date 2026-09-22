import React from 'react';
import { BookOpen, CheckCircle2, XCircle, BarChart2, Info } from 'lucide-react';
import { Question, QuestionStats, OptionKey } from '../types';

interface ExplanationPanelProps {
  question: Question;
  selectedAnswer: OptionKey | null;
  stats: QuestionStats;
}

export const ExplanationPanel: React.FC<ExplanationPanelProps> = ({
  question,
  selectedAnswer,
  stats
}) => {
  const isCorrect = selectedAnswer === question.correctAnswer;

  // Simple clean markdown section splitter
  const renderFormattedExplanation = (text: string) => {
    const sections = text.split(/(?=##\s)/g);

    return sections.map((sec, idx) => {
      const lines = sec.trim().split('\n');
      const firstLine = lines[0];

      if (firstLine.startsWith('## ')) {
        const title = firstLine.replace('## ', '');
        const contentLines = lines.slice(1);

        return (
          <div key={idx} className="space-y-2 pt-2 border-t border-slate-800/80 first:border-none first:pt-0">
            <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-cyan-400" />
              <span>{title}</span>
            </h4>
            <div className="space-y-1.5 text-xs text-slate-300 leading-relaxed">
              {contentLines.map((line, lIdx) => {
                const trimmed = line.trim();
                if (!trimmed) return null;
                if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
                  const bulletText = trimmed.substring(2);
                  return (
                    <div key={lIdx} className="flex items-start gap-2 pl-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-500/60 mt-1.5 shrink-0" />
                      <span>{renderBoldText(bulletText)}</span>
                    </div>
                  );
                }
                return <p key={lIdx}>{renderBoldText(trimmed)}</p>;
              })}
            </div>
          </div>
        );
      }

      return (
        <div key={idx} className="text-xs text-slate-300 leading-relaxed space-y-1">
          {lines.map((line, lIdx) => (
            <p key={lIdx}>{renderBoldText(line)}</p>
          ))}
        </div>
      );
    });
  };

  const renderBoldText = (str: string) => {
    const parts = str.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={i} className="font-bold text-slate-100">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return part;
    });
  };

  return (
    <div className="rounded-2xl bg-slate-900/95 border border-slate-800 p-5 md:p-6 space-y-5 shadow-xl">
      {/* Result Status Banner */}
      <div
        className={`p-4 rounded-xl border flex items-center gap-3 ${
          isCorrect
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
        }`}
      >
        {isCorrect ? (
          <CheckCircle2 className="w-6 h-6 shrink-0" />
        ) : (
          <XCircle className="w-6 h-6 shrink-0" />
        )}

        <div>
          <div className="font-extrabold text-sm">
            {isCorrect ? 'Correct Answer!' : 'Incorrect Answer'}
          </div>
          <div className="text-xs opacity-90">
            {isCorrect
              ? `Option ${question.correctAnswer} is the correct choice.`
              : `Your selection: ${selectedAnswer || 'None'}. Correct answer: ${question.correctAnswer}`}
          </div>
        </div>
      </div>

      {/* Aggregate Community Answer Statistics */}
      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-400 font-semibold border-b border-slate-800/80 pb-2">
          <span className="flex items-center gap-1.5 text-slate-300">
            <BarChart2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>Aggregate Answer Statistics</span>
          </span>
          <span className="text-[11px] text-slate-400">{stats.totalAttempts.toLocaleString()} examinees</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(['A', 'B', 'C', 'D'] as OptionKey[]).map((optKey) => {
            const pct = stats.distribution[optKey] || 0;
            const isCorrectOption = optKey === question.correctAnswer;
            const isUserOption = optKey === selectedAnswer;

            return (
              <div
                key={optKey}
                className={`p-2.5 rounded-lg border text-xs space-y-1 ${
                  isCorrectOption
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                    : isUserOption
                    ? 'bg-rose-500/10 border-rose-500/40 text-rose-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                <div className="flex justify-between items-center font-bold">
                  <span>Option {optKey}</span>
                  <span className="text-slate-100">{pct}%</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      isCorrectOption ? 'bg-emerald-400' : isUserOption ? 'bg-rose-400' : 'bg-slate-600'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Formatted Explanation */}
      <div className="space-y-4">{renderFormattedExplanation(question.explanation)}</div>

      {/* Option Explanations Section for Incorrect Choices */}
      {question.optionExplanations &&
        Object.keys(question.optionExplanations).some(
          (k) => k !== question.correctAnswer && Boolean(question.optionExplanations?.[k as OptionKey])
        ) && (
          <div className="pt-4 border-t border-slate-800 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-amber-400" />
              <span>Why the other options are incorrect</span>
            </h4>

            <div className="space-y-2.5">
              {(['A', 'B', 'C', 'D'] as OptionKey[])
                .filter((k) => k !== question.correctAnswer && Boolean(question.optionExplanations?.[k]))
                .map((k) => (
                  <div
                    key={k}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-lg bg-slate-800 text-slate-300 font-bold flex items-center justify-center shrink-0 text-[11px]">
                        {k}
                      </span>
                      <span className="font-semibold text-slate-200">
                        {question.options[k]}
                      </span>
                    </div>
                    <p className="text-slate-400 pl-7 text-[11px] leading-relaxed">
                      {question.optionExplanations![k]}
                    </p>
                  </div>
                ))}
            </div>
          </div>
        )}
    </div>
  );
};
