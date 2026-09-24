import React from 'react';
import { BookOpen, Layers, Sparkles, Clapperboard, ChevronLeft } from 'lucide-react';

interface SpecialtyHubProps {
  bankId: string;
  bankLabel: string;
  onNavigate: (view: string, params?: any) => void;
}

// Landing hub shown after choosing a specialty (currently Human Medicine),
// before diving into any specific content type. Reuses existing pages
// (Past Years → the existing question bank filter screen, Flashcards →
// the existing flip-card view) and links to the two new content types
// (Most Common, Videos) added alongside them.
export const SpecialtyHub: React.FC<SpecialtyHubProps> = ({ bankId, bankLabel, onNavigate }) => {
  const cards = [
    {
      key: 'past_years',
      title: 'Past Years',
      description: 'Practice by exam year, TAJNEED, or MADANI question sets.',
      icon: BookOpen,
      accent: 'cyan',
      onClick: () => onNavigate('bank', { bankId })
    },
    {
      key: 'flashcards',
      title: 'Flashcards',
      description: 'Flip through quick-recall cards at your own pace.',
      icon: Layers,
      accent: 'emerald',
      onClick: () => onNavigate('flashcards', { bankId })
    },
    {
      key: 'most_common',
      title: 'Most Common',
      description: 'Fill-in-the-blank style review of the highest-yield facts.',
      icon: Sparkles,
      accent: 'amber',
      onClick: () => onNavigate('most_common', { bankId })
    },
    {
      key: 'videos',
      title: 'Videos',
      description: 'Browse the video library for this specialty.',
      icon: Clapperboard,
      accent: 'purple',
      onClick: () => onNavigate('videos', { bankId })
    }
  ];

  const accentClasses: Record<string, { border: string; iconBg: string; iconText: string; glow: string }> = {
    cyan: { border: 'border-cyan-500', iconBg: 'bg-cyan-500/10', iconText: 'text-cyan-400', glow: 'bg-cyan-500' },
    emerald: { border: 'border-emerald-500', iconBg: 'bg-emerald-500/10', iconText: 'text-emerald-400', glow: 'bg-emerald-500' },
    amber: { border: 'border-amber-500', iconBg: 'bg-amber-500/10', iconText: 'text-amber-400', glow: 'bg-amber-500' },
    purple: { border: 'border-purple-500', iconBg: 'bg-purple-500/10', iconText: 'text-purple-400', glow: 'bg-purple-500' }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <button
        onClick={() => onNavigate('home')}
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        <span>Back to Home</span>
      </button>

      <div className="space-y-1">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-100">{bankLabel}</h1>
        <p className="text-xs text-slate-400">Choose what you'd like to study.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {cards.map((card) => {
          const accent = accentClasses[card.accent];
          const Icon = card.icon;
          return (
            <button
              key={card.key}
              onClick={card.onClick}
              className={`glass-panel relative overflow-hidden text-left p-6 border-t-4 ${accent.border} space-y-4 transition-all hover:-translate-y-0.5 active:scale-[0.98]`}
            >
              <div className={`absolute top-0 right-0 w-32 h-32 ${accent.glow} opacity-10 blur-[70px] -mr-10 -mt-10 pointer-events-none`} />
              <div className={`w-12 h-12 rounded-xl ${accent.iconBg} ${accent.iconText} flex items-center justify-center`}>
                <Icon className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-100">{card.title}</h2>
                <p className="text-xs text-slate-400 mt-1">{card.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
