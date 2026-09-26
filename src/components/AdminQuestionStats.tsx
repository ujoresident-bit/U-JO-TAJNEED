import React, { useState } from 'react';
import { Database, Calendar, Tag, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { getQuestionBankStatsOverview } from '../services/questionBankService';

const BANKS = [
  { id: 'human_medicine', label: 'Human Medicine' },
  { id: 'dentistry', label: 'Dentistry' },
  { id: 'qbank_basic', label: 'QBANK BASIC' }
];

export const AdminQuestionStats: React.FC = () => {
  const [selectedBank, setSelectedBank] = useState<string>('human_medicine');
  const stats = getQuestionBankStatsOverview(selectedBank);

  return (
    <div className="space-y-6 text-xs">
      {/* Bank Selector — every count below is scoped to exactly one bank,
          never combined, since Human Medicine, Dentistry, and QBANK BASIC
          are entirely separate content pools. */}
      <div className="flex items-center gap-2 p-1 rounded-2xl bg-slate-950 border border-slate-800 w-fit">
        {BANKS.map((bank) => (
          <button
            key={bank.id}
            onClick={() => setSelectedBank(bank.id)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              selectedBank === bank.id
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {bank.label}
          </button>
        ))}
      </div>

      {/* Top Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-1 shadow-lg">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase">Total Questions</span>
            <Database className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-3xl font-black text-slate-100">{stats.total}</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-1 shadow-lg">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase">Classified Questions</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-black text-emerald-400">{stats.classifiedCount}</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-1 shadow-lg">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase">Needs Review / Missing Meta</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className={`text-3xl font-black ${stats.needsReviewCount > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
            {stats.needsReviewCount}
          </div>
        </div>
      </div>

      {/* Year Breakdown Grid — hidden entirely for QBANK BASIC, which is
          Major-only and not year-restricted at all. */}
      {selectedBank !== 'qbank_basic' && (
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 shadow-lg">
          <div className="font-bold text-slate-200 flex items-center gap-2 border-b border-slate-800 pb-2">
            <Calendar className="w-4 h-4 text-purple-400" />
            <span>Exam Year Distribution (2015 – 2025)</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {Object.entries(stats.yearCounts).map(([yr, count]) => (
              <div
                key={yr}
                className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between"
              >
                <span className="font-bold text-slate-300">{yr}</span>
                <span className={`font-mono font-black ${count > 0 ? 'text-cyan-400' : 'text-slate-600'}`}>
                  {count} Qs
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Major Distribution Breakdown */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 shadow-lg">
        <div className="font-bold text-slate-200 flex items-center gap-2 border-b border-slate-800 pb-2">
          <Tag className="w-4 h-4 text-cyan-400" />
          <span>Major Specialty Distribution</span>
        </div>

        {Object.keys(stats.majorCounts).length === 0 ? (
          <p className="text-slate-500 text-center py-6">No questions in this bank yet.</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(stats.majorCounts).map(([major, count]) => {
              const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
              return (
                <div key={major} className="space-y-1">
                  <div className="flex justify-between font-semibold text-slate-300">
                    <span>{major}</span>
                    <span className="text-slate-400 font-mono">
                      {count} ({pct}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                    <div
                      className="bg-cyan-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
