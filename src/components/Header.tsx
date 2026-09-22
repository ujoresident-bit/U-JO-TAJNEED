import React from 'react';
import {
  Stethoscope,
  ShieldCheck,
  User
} from 'lucide-react';
import { resolveSession } from '../services/authService';

interface HeaderProps {
  currentView: string;
  onNavigate: (view: string) => void;
  onRefreshData?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ currentView, onNavigate }) => {
  const session = resolveSession();
  const user = session.user;

  return (
    <header className="sticky top-0 z-40 bg-[#050506]/80 backdrop-blur-md border-b border-white/10 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        {/* Brand & Logo */}
        <button
          onClick={() => onNavigate('home')}
          className="flex items-center gap-3 text-left focus:outline-none group"
        >
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 group-hover:neon-border transition-all">
            <Stethoscope className="w-5 h-5 text-[#00F2FF]" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-lg tracking-tight uppercase neon-text group-hover:opacity-90 transition-opacity">
                U JO Resident
              </span>
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              MOH Residency Question Bank
            </p>
          </div>
        </button>

        {/* Right Action Bar */}
        <div className="flex items-center gap-3">
          {/* Active Subscriber Pill */}
          <button
            onClick={() => onNavigate('subscription')}
            className="hidden sm:flex items-center gap-2.5 bg-white/5 border border-white/10 px-3.5 py-1.5 rounded-full hover:bg-white/10 transition-all"
          >
            <div className={`w-2 h-2 rounded-full ${
              session.subscriptionStatus === 'ACTIVE'
                ? 'bg-emerald-400 animate-pulse'
                : session.subscriptionStatus === 'PENDING'
                ? 'bg-amber-400'
                : 'bg-rose-400'
            }`} />
            <span className="text-xs font-medium uppercase tracking-wider text-slate-300">
              {session.isAdmin
                ? 'Admin Pass'
                : session.subscriptionStatus === 'ACTIVE'
                ? 'Active Subscriber'
                : session.subscriptionStatus === 'EXPIRED'
                ? 'Pass Expired'
                : session.subscriptionStatus === 'PENDING'
                ? 'Pending Review'
                : 'Unsubscribed'}
            </span>
          </button>

          {/* Admin Link if Admin Allowlist */}
          {session.isAdmin && (
            <button
              onClick={() => onNavigate('admin')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                currentView === 'admin'
                  ? 'bg-cyan-500/20 text-cyan-300 border-[#00F2FF] shadow-sm shadow-cyan-500/20'
                  : 'glass-panel text-slate-300 hover:text-slate-100'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-[#00F2FF]" />
              <span className="hidden md:inline">Admin</span>
            </button>
          )}

          {/* User Profile Info */}
          <div className="flex items-center gap-3">
            <div className="text-right hidden md:block">
              <p className="text-xs font-bold text-slate-200">
                {user.firstName ? `${user.firstName} ${user.lastName}` : 'Dr. Saif Al-Deen'}
              </p>
              <p className="text-[10px] text-slate-500">MOH Candidate</p>
            </div>
            <div className="w-9 h-9 rounded-full border-2 border-slate-700 bg-slate-800 flex items-center justify-center overflow-hidden">
              <User className="w-4 h-4 text-slate-300" />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

