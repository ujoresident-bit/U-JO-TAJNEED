import React, { useState, useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Header } from './components/Header';
import { HomeView } from './components/HomeView';
import { QuestionBankView } from './components/QuestionBankView';
import { QuestionScreen } from './components/QuestionScreen';
import { SubscriptionView } from './components/SubscriptionView';
import { ProgressView } from './components/ProgressView';
import { AdminDashboard } from './components/AdminDashboard';
import { FlashcardsView } from './components/FlashcardsView';
import { ContentProtection } from './components/ContentProtection';
import { initTelegramSdk } from './services/telegram';
import { getCurrentUser, checkAccountActiveStatus } from './services/authService';
import { syncQuestionsWithSupabase, syncBlocksFromSupabase } from './services/questionBankService';
import { syncFlashcardsFromSupabase } from './services/flashcardService';
import { syncSubscriptionFromSupabase } from './services/subscriptionService';

export default function App() {
  const [currentView, setCurrentView] = useState<string>('home');
  const [viewParams, setViewParams] = useState<any>({});
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [isAccountInactive, setIsAccountInactive] = useState<boolean>(false);

  useEffect(() => {
    initTelegramSdk();
    const user = getCurrentUser();
    checkAccountActiveStatus(user).then((res) => {
      if (!res.active) {
        setIsAccountInactive(true);
      }
    });

    // Background non-blocking sync with Supabase for subscription, questions, blocks & flashcards
    syncSubscriptionFromSupabase().then(() => {
      setRefreshKey((prev) => prev + 1);
    }).catch(() => {});
    syncQuestionsWithSupabase().catch(() => {});
    syncBlocksFromSupabase().catch(() => {});
    syncFlashcardsFromSupabase().catch(() => {});
  }, []);

  const handleNavigate = (view: string, params: any = {}) => {
    setCurrentView(view);
    setViewParams(params);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRefreshData = () => {
    setRefreshKey((prev) => prev + 1);
  };

  if (isAccountInactive) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4" dir="rtl">
        <div className="max-w-md w-full bg-slate-900 border border-rose-500/30 rounded-2xl p-6 text-center space-y-4 shadow-2xl">
          <div className="w-16 h-16 bg-rose-500/10 text-rose-400 rounded-full flex items-center justify-center mx-auto border border-rose-500/20">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-slate-100">🚫 تم تعطيل حسابك من قبل الإدارة</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            يرجى التواصل مع الإدارة.
          </p>
          <button
            onClick={() => {
              const user = getCurrentUser();
              checkAccountActiveStatus(user).then((res) => {
                if (res.active) {
                  setIsAccountInactive(false);
                  window.location.reload();
                } else {
                  alert('لا يزال الحساب معطلاً.');
                }
              });
            }}
            className="w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all shadow-md shadow-cyan-500/20"
          >
            إعادة التحقق من تفعيل الحساب
          </button>
        </div>
      </div>
    );
  }

  return (
    <ContentProtection currentView={currentView}>
      <div key={refreshKey} className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-cyan-500/30 selection:text-cyan-200">
        {/* Persistent App Shell Header */}
        <Header
          currentView={currentView}
          onNavigate={handleNavigate}
          onRefreshData={handleRefreshData}
        />

        {/* Main View Container */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          {currentView === 'home' && <HomeView onNavigate={handleNavigate} />}

          {currentView === 'bank' && <QuestionBankView onNavigate={handleNavigate} />}

          {currentView === 'question_screen' && (
            <QuestionScreen
              blockId={viewParams.blockId}
              reviewMode={viewParams.reviewMode}
              onNavigate={handleNavigate}
            />
          )}

          {currentView === 'subscription' && (
            <SubscriptionView onNavigate={handleNavigate} onRefreshData={handleRefreshData} />
          )}

          {currentView === 'progress' && <ProgressView onNavigate={handleNavigate} />}

          {currentView === 'flashcards' && <FlashcardsView onNavigate={handleNavigate} />}

          {currentView === 'admin' && (
            <AdminDashboard onNavigate={handleNavigate} onRefreshData={handleRefreshData} />
          )}
        </main>
      </div>
    </ContentProtection>
  );
}
