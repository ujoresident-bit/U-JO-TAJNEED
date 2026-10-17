import React from 'react';
import { Stethoscope, ShieldCheck, User } from 'lucide-react';
import { resolveSession } from '../services/authService';

interface HeaderProps {
  currentView: string;
  onNavigate: (view: string) => void;
  onRefreshData?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ currentView, onNavigate }) => {
  const session = resolveSession();
  const user = session.user;

  const status =
    session.isAdmin ? { label: 'Admin', dot: 'bg-cyan-400' }
    : session.subscriptionStatus === 'ACTIVE' ? { label: 'Active', dot: 'bg-emerald-400' }
    : session.subscriptionStatus === 'EXPIRED' ? { label: 'Expired', dot: 'bg-rose-400' }
    : session.subscriptionStatus === 'PENDING' ? { label: 'Pending', dot: 'bg-amber-400' }
    : { label: 'Not subscribed', dot: 'bg-slate-500' };

  return (
    <header className="sticky top-0 z-40 bg-[#07090c]/85 backdrop-blur-md border-b border-white/[0.06]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-3">
        <button onClick={() => onNavigate('home')} className="flex items-center gap-2.5 focus:outline-none group">
          <div className="w-8 h-8 rounded-lg bg-cyan-400/10 border border-cyan-400/25 flex items-center justify-center">
            <Stethoscope className="w-4 h-4 text-cyan-300" />
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-slate-100 group-hover:text-white transition-colors">
            U JO <span className="text-cyan-300">TAJNEED</span>
          </span>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigate('subscription')}
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 border border-white/[0.08] hover:bg-white/[0.04] transition-colors"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </button>

          {session.isAdmin && (
            <button
              onClick={() => onNavigate('admin')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                currentView === 'admin'
                  ? 'bg-cyan-400/10 text-cyan-200 border-cyan-400/40'
                  : 'text-slate-300 border-white/[0.08] hover:bg-white/[0.04]'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span className="hidden md:inline">Admin</span>
            </button>
          )}

          <div className="flex items-center gap-2.5 pl-1">
            <p className="hidden md:block text-xs font-medium text-slate-300">
              {user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'User'}
            </p>
            <div className="w-8 h-8 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
              <User className="w-4 h-4 text-slate-300" />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
