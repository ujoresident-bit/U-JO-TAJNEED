import React, { useEffect, useState } from 'react';
import { Flag, X, Send, CheckCircle2, Loader2 } from 'lucide-react';
import { reportQuestionIssue } from '../services/questionBankService';
import { reportFlashcardIssue } from '../services/flashcardService';

export type FeedbackKind = 'question' | 'flashcard' | 'most_common';

interface FeedbackButtonProps {
  kind: FeedbackKind;
  itemId: string;
  // 'chip' = small pill used inside card headers; 'full' = wider button.
  variant?: 'chip' | 'full';
  className?: string;
}

const REASONS: { id: string; label: string }[] = [
  { id: 'wrong_answer', label: 'Wrong answer' },
  { id: 'unclear', label: 'Unclear / incomplete' },
  { id: 'typo', label: 'Typo' },
  { id: 'explanation', label: 'Explanation issue' },
  { id: 'other', label: 'Other' }
];

const KIND_LABEL: Record<FeedbackKind, string> = {
  question: 'question',
  flashcard: 'flashcard',
  most_common: 'Most Common card'
};

// One reusable "report a problem" control. It works the same on the exam
// screen (all banks, including QBank Basic), Flashcards and Most Common.
// Reports reach the admin both as a Telegram message and in the admin
// dashboard "Feedback" tab, where one click opens the item for editing.
export const FeedbackButton: React.FC<FeedbackButtonProps> = ({
  kind,
  itemId,
  variant = 'chip',
  className = ''
}) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A different question/card means a fresh report.
  useEffect(() => {
    setOpen(false);
    setReason('');
    setMessage('');
    setSent(false);
    setError(null);
  }, [itemId, kind]);

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const submit = async () => {
    if (!reason && !message.trim()) {
      setError('Please choose a reason or write a note.');
      return;
    }
    setSending(true);
    setError(null);
    const reasonLabel = REASONS.find((r) => r.id === reason)?.label;
    const text = [reasonLabel ? `[${reasonLabel}]` : '', message.trim()].filter(Boolean).join(' ');
    try {
      if (kind === 'question') await reportQuestionIssue(itemId, text);
      else await reportFlashcardIssue(itemId, text);
      setSent(true);
      setTimeout(() => {
        setOpen(false);
      }, 1400);
    } catch (e: any) {
      setError(e?.message || 'Could not send. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const triggerClass =
    variant === 'full'
      ? 'px-4 py-2.5 rounded-xl text-xs font-semibold'
      : 'px-2.5 py-1 rounded-lg text-[11px] font-semibold';

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={`${triggerClass} inline-flex items-center gap-1.5 border transition-colors ${
          sent
            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
            : 'bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-amber-300 border-slate-800'
        } ${className}`}
        title={`Report a problem with this ${KIND_LABEL[kind]}`}
      >
        {sent ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Flag className="w-3.5 h-3.5" />}
        <span>{sent ? 'Reported' : 'Feedback'}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/70 p-3"
          onClick={close}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Flag className="w-4 h-4 text-amber-400" />
                <span>Report a problem with this {KIND_LABEL[kind]}</span>
              </h3>
              <button
                type="button"
                onClick={close}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {sent ? (
              <div className="py-6 text-center space-y-2">
                <CheckCircle2 className="w-9 h-9 text-emerald-400 mx-auto" />
                <p className="text-sm text-emerald-300 font-semibold">Thank you — sent to the admin.</p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {REASONS.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setReason(reason === r.id ? '' : r.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        reason === r.id
                          ? 'bg-amber-500 text-slate-950 border-amber-400'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-600'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>

                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, 900))}
                  rows={4}
                  placeholder="Tell the admin what is wrong (optional if you picked a reason)…"
                  className="w-full rounded-xl bg-slate-950 border border-slate-700 focus:border-amber-500 outline-none p-3 text-sm text-slate-100 placeholder-slate-600 resize-none"
                />

                {error && <p className="text-xs text-rose-400">{error}</p>}

                <button
                  type="button"
                  onClick={submit}
                  disabled={sending}
                  className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  <span>{sending ? 'Sending…' : 'Send to admin'}</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};
