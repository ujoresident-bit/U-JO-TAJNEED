import React from 'react';
import { Save, CheckCircle2, X, AlertTriangle } from 'lucide-react';

interface EndBlockModalProps {
  onSaveAndExit: () => void;
  onFinishBlock: () => void;
  onCancel: () => void;
  answeredCount: number;
  totalQuestions: number;
}

export const EndBlockModal: React.FC<EndBlockModalProps> = ({
  onSaveAndExit,
  onFinishBlock,
  onCancel,
  answeredCount,
  totalQuestions
}) => {
  const unansweredCount = totalQuestions - answeredCount;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl animate-in fade-in zoom-in duration-150">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            <h3 className="text-base font-bold text-slate-100">End Practice Block</h3>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <p className="text-xs text-slate-300 leading-relaxed">
            Choose how you would like to handle your progress for this block:
          </p>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-400">Answered:</span>{' '}
              <span className="font-bold text-emerald-400">{answeredCount}</span>
            </div>
            <div>
              <span className="text-slate-400">Unanswered:</span>{' '}
              <span className="font-bold text-amber-400">{unansweredCount}</span>
            </div>
          </div>
        </div>

        <div className="space-y-2 pt-2">
          {/* Save & Exit */}
          <button
            onClick={onSaveAndExit}
            className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md"
          >
            <Save className="w-4 h-4 text-cyan-400" />
            <span>Save & Exit (Resume Later)</span>
          </button>

          {/* Finish Block */}
          <button
            onClick={onFinishBlock}
            className="w-full py-3 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-extrabold flex items-center justify-center gap-2 transition-all shadow-lg shadow-cyan-500/20"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Finish Block & Submit Score</span>
          </button>

          {/* Cancel */}
          <button
            onClick={onCancel}
            className="w-full py-2.5 px-4 rounded-xl bg-transparent hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs font-semibold transition-all"
          >
            Continue Answering
          </button>
        </div>
      </div>
    </div>
  );
};
