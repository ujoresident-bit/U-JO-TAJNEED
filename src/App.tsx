import React, { useState, useEffect, useRef } from 'react';
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
import { CinematicIntro } from './components/CinematicIntro';
import { SpecialtyHub } from './components/SpecialtyHub';
import { MostCommonView } from './components/MostCommonView';
import { VideosView } from './components/VideosView';
import { QBankBasicView } from './components/QBankBasicView';
import { ReviewView } from './components/ReviewView';
import { SmartFirstAidView } from './components/SmartFirstAidView';
import { CosmicBackground } from './components/CosmicBackground';
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
  // Non-skippable, plays fully on every fresh page load — no
  // sessionStorage persistence, matching the exact behavior established
  // for U JO Resident's own intro.
  const [showIntro, setShowIntro] = useState<boolean>(true);

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

  // Navigation history so every "Back" returns to the previous page.
  const historyRef = useRef<{ view: string; params: any }[]>([]);
  const currentRef = useRef<{ view: string; params: any }>({ view: 'home', params: {} });

  const goTo = (view: string, params: any) => {
    currentRef.current = { view, params };
    setCurrentView(view);
    setViewParams(params);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNavigate = (view: string, params: any = {}) => {
    if (view === 'back') {
      // Skip finished/in-progress question screens when going back.
      let prev = historyRef.current.pop();
      while (prev && prev.view === 'question_screen') prev = historyRef.current.pop();
      goTo(prev ? prev.view : 'home', prev ? prev.params : {});
      return;
    }
    const cur = currentRef.current;
    if (view === 'home') {
      historyRef.current = [];
    } else if (cur.view !== view || JSON.stringify(cur.params) !== JSON.stringify(params)) {
      historyRef.current.push(cur);
      if (historyRef.current.length > 50) historyRef.current.shift();
    }
    goTo(view, params);
    try { window.history.pushState({ ujo: true }, ''); } catch {}
  };

  // Phone/browser back button and Telegram's native back button.
  useEffect(() => {
    try { window.history.replaceState({ ujo: true }, ''); window.history.pushState({ ujo: true }, ''); } catch {}
    const onPop = () => {
      if (currentRef.current.view === 'home' && historyRef.current.length === 0) {
        try { window.history.pushState({ ujo: true }, ''); } catch {}
        return;
      }
      handleNavigate('back');
      try { window.history.pushState({ ujo: true }, ''); } catch {}
    };
    window.addEventListener('popstate', onPop);
    const wa: any = (window as any).Telegram?.WebApp;
    const onTgBack = () => handleNavigate('back');
    try { wa?.BackButton?.onClick?.(onTgBack); } catch {}
    return () => {
      window.removeEventListener('popstate', onPop);
      try { wa?.BackButton?.offClick?.(onTgBack); } catch {}
    };
  }, []);

  useEffect(() => {
    const wa: any = (window as any).Telegram?.WebApp;
    try {
      if (currentView === 'home') wa?.BackButton?.hide?.();
      else wa?.BackButton?.show?.();
    } catch {}
  }, [currentView]);

  const handleRefreshData = () => {
    setRefreshKey((prev) => prev + 1);
  };

  if (showIntro) {
    return <CinematicIntro onComplete={() => setShowIntro(false)} />;
  }

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
      <div key={refreshKey} className="min-h-screen bg-[#07090c] text-slate-100 font-sans antialiased selection:bg-cyan-500/30 selection:text-cyan-200">
        {currentView === 'home' && <CosmicBackground />}

        {/* Persistent App Shell Header */}
        <Header
          currentView={currentView}
          onNavigate={handleNavigate}
          onRefreshData={handleRefreshData}
        />

        {/* Main View Container */}
        <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
          <div key={currentView} className="page-transition">
          {currentView === 'home' && <HomeView onNavigate={handleNavigate} />}

          {currentView === 'bank' && <QuestionBankView onNavigate={handleNavigate} bankId={viewParams.bankId} />}
          {currentView === 'specialty_hub' && (
            <SpecialtyHub
              onNavigate={handleNavigate}
              bankId={viewParams.bankId || 'human_medicine'}
              bankLabel={viewParams.bankId === 'dentistry' ? 'Dentistry' : 'Human Medicine'}
            />
          )}
          {currentView === 'most_common' && <MostCommonView onNavigate={handleNavigate} />}
          {currentView === 'videos' && <VideosView onNavigate={handleNavigate} bankId={viewParams.bankId || 'human_medicine'} />}
          {currentView === 'qbank_basic' && <QBankBasicView onNavigate={handleNavigate} bankId={viewParams.bankId || 'human_medicine'} />}
          {currentView === 'smart_first_aid' && <SmartFirstAidView onNavigate={handleNavigate} />}
          {currentView === 'review' && <ReviewView bankId={viewParams.bankId || 'human_medicine'} onNavigate={handleNavigate} />}

          {currentView === 'question_screen' && (
            <QuestionScreen
              blockId={viewParams.blockId}
              reviewMode={viewParams.reviewMode}
              onNavigate={handleNavigate}
            />
          )}

          {currentView === 'subscription' && (
            <SubscriptionView onNavigate={handleNavigate} onRefreshData={handleRefreshData} bankId={viewParams.bankId} />
          )}

          {currentView === 'progress' && <ProgressView onNavigate={handleNavigate} />}

          {currentView === 'flashcards' && <FlashcardsView onNavigate={handleNavigate} />}

          {currentView === 'admin' && (
            <AdminDashboard onNavigate={handleNavigate} onRefreshData={handleRefreshData} />
          )}
          </div>
        </main>
      </div>
    </ContentProtection>
  );
}
