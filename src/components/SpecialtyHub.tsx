import React, { useEffect, useState } from 'react';
import { BookOpen, Layers, Sparkles, Clapperboard, GraduationCap, Brain, ChevronLeft, ChevronRight, Repeat } from 'lucide-react';
import { fetchDueReviews } from '../services/reviewService';

interface SpecialtyHubProps {
  bankId: string;
  bankLabel: string;
  onNavigate: (view: string, params?: any) => void;
}

type Tint = 'cyan' | 'emerald' | 'amber' | 'violet';

const TINTS: Record<Tint, string> = {
  cyan: 'bg-cyan-400/10 text-cyan-300 border-cyan-400/20',
  emerald: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20',
  amber: 'bg-amber-400/10 text-amber-300 border-amber-400/20',
  violet: 'bg-violet-400/10 text-violet-300 border-violet-400/20'
};

// Landing hub shown after choosing a specialty. Questions first, then
// the study tools, then media and the book.
export const SpecialtyHub: React.FC<SpecialtyHubProps> = ({ bankId, bankLabel, onNavigate }) => {
  const [dueCount, setDueCount] = useState<number | null>(null);
  useEffect(() => {
    fetchDueReviews(bankId).then((r) => setDueCount(r.due.length)).catch(() => {});
  }, [bankId]);

  const groups: { title: string; items: { key: string; title: string; description: string; icon: any; tint: Tint; badge?: string; onClick: () => void }[] }[] = [
    {
      title: 'Practice',
      items: [
        { key: 'past_years', title: 'Past Years', description: 'TAJNEED and MADANI sets, filtered by year.', icon: BookOpen, tint: 'cyan', onClick: () => onNavigate('bank', { bankId }) },
        { key: 'qbank_basic', title: 'QBANK BASIC', description: 'Pharmacology, Microbiology, Immunology and Anatomy.', icon: GraduationCap, tint: 'emerald', onClick: () => onNavigate('qbank_basic', { bankId }) }
      ]
    },
    {
      title: 'Revise',
      items: [
        {
          key: 'review', title: 'Review',
          description: dueCount === null
            ? 'Missed items return after 1, 3, then 7 days.'
            : dueCount > 0 ? `${dueCount} item${dueCount === 1 ? '' : 's'} due today.` : 'Nothing due today.',
          icon: Repeat, tint: 'amber',
          badge: dueCount && dueCount > 0 ? String(dueCount) : undefined,
          onClick: () => onNavigate('review', { bankId })
        },
        { key: 'flashcards', title: 'Flashcards', description: 'Flip through quick-recall cards.', icon: Layers, tint: 'cyan', onClick: () => onNavigate('flashcards', { bankId }) },
        { key: 'most_common', title: 'Most Common', description: 'Fill-in-the-blank review of high-yield facts.', icon: Sparkles, tint: 'amber', onClick: () => onNavigate('most_common', { bankId }) }
      ]
    },
    {
      title: 'Learn',
      items: [
        { key: 'smart_first_aid', title: 'Smart First Aid Step1', description: 'Read by part with quizzes, summaries, highlights and bookmarks.', icon: Brain, tint: 'violet', onClick: () => onNavigate('smart_first_aid', { bankId }) },
        { key: 'videos', title: 'Videos', description: 'Browse the video library.', icon: Clapperboard, tint: 'violet', onClick: () => onNavigate('videos', { bankId }) }
      ]
    }
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-16">
      <div className="space-y-4">
        <button
          onClick={() => onNavigate('back')}
          className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight text-white">{bankLabel}</h1>
          <p className="text-sm text-slate-400">Pick what you want to study today.</p>
        </div>
      </div>

      {groups.map((g) => (
        <section key={g.title} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{g.title}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {g.items.map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.key}
                  onClick={card.onClick}
                  className="glass-panel ujo-card-hover text-left p-5 flex items-center gap-4"
                >
                  <div className={`w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 ${TINTS[card.tint]}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[15px] font-semibold text-slate-100">{card.title}</h3>
                      {card.badge && (
                        <span className="px-1.5 py-0.5 rounded-md bg-amber-400 text-[#2a1d02] text-[10px] font-bold leading-none">{card.badge}</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{card.description}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};
