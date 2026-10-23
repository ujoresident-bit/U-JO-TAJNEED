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
import { SyncCheck } from './components/SyncCheck';
import { MostCommonView } from './components/MostCommonView';
import { VideosView } from './components/VideosView';
import { QBankBasicView } from './components/QBankBasicView';
import { ReviewView } from './components/ReviewView';
import { SmartFirstAidView } from './components/SmartFirstAidView';
import { initTelegramSdk } from './services/telegram';
import { getCurrentUser, checkAccountActiveStatus } from './services/authService';
import { syncQuestionsWithSupabase, syncBlocksFromSupabase, pushUnsyncedBlocks } from './services/questionBankService';
import { syncFlashcardsFromSupabase } from './services/flashcardService';
import { syncSubscriptionFromSupabase } from './services/subscriptionService';
import { claimSession, checkSession, SESSION_REPLACED_EVENT } from './services/sessionService';

export default function App() {
  const [currentView, setCurrentView] = useState<string>('home');
  const [viewParams, setViewParams] = useState<any>({});
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [isAccountInactive, setIsAccountInactive] = useState<boolean>(false);
  // Students use one device at a time: when another device takes over, this one is locked.
  const [replaced, setReplaced] = useState<boolean>(false);
  const [takingOver, setTakingOver] = useState<boolean>(false);
  const replacedRef = useRef<boolean>(false);
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
    syncFlashcardsFromSupabase().catch(() => {});

    // Become the active device first, then pull the account's latest blocks, so
    // this device starts from exactly what the previous device left.
    claimSession()
      .then(() => syncBlocksFromSupabase())
      .then(() => pushUnsyncedBlocks())
      .catch(() => {});

    const lock = () => { replacedRef.current = true; setReplaced(true); };
    window.addEventListener(SESSION_REPLACED_EVENT, lock);

    // While the app is on screen: confirm this is still the active device and
    // pull only what changed (cheap). Also runs the moment the app comes back.
    let busy = false;
    const tick = async () => {
      if (busy || document.visibilityState !== 'visible' || replacedRef.current) return;
      busy = true;
      try {
        const active = await checkSession();
        if (!active) { lock(); return; }
        await syncBlocksFromSupabase(undefined, undefined, false);
        await pushUnsyncedBlocks();
      } catch { /* never interrupt the app */ } finally { busy = false; }
    };
    const iv = setInterval(tick, 15000);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(SESSION_REPLACED_EVENT, lock);
    };
  }, []);

  const takeOver = async () => {
    setTakingOver(true);
    try {
      await claimSession();
      await syncBlocksFromSupabase();
      await pushUnsyncedBlocks();
    } catch { /* ignore */ }
    replacedRef.current = false;
    setReplaced(false);
    setTakingOver(false);
    setRefreshKey((k) => k + 1);
  };

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
      const prev = historyRef.current.pop();
      goTo(prev ? prev.view : 'home', prev ? prev.params : {});
      return;
    }
    const cur = currentRef.current;
    if (view === 'home') {
      historyRef.current = [];
    } else if (
      (cur.view !== view || JSON.stringify(cur.params) !== JSON.stringify(params)) &&
      // A finished/abandoned question block is not a place to come "back" to,
      // except when the student detours to First Aid mid-block.
      !(cur.view === 'question_screen' && view !== 'smart_first_aid')
    ) {
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

  if (replaced) {
    return (
      <div className="min-h-screen bg-[#07090c] text-slate-100 flex items-center justify-center p-4" dir="rtl">
        <div className="max-w-md w-full rounded-3xl p-7 text-center space-y-4" style={{ border: '1px solid rgba(79,214,236,.25)', background: 'linear-gradient(160deg,rgba(79,214,236,.08),rgba(207,239,248,.02))', boxShadow: '0 30px 80px -40px rgba(79,214,236,.45)' }}>
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto" style={{ background: 'rgba(79,214,236,.1)', border: '1px solid rgba(79,214,236,.3)' }}>
            <ShieldAlert className="w-8 h-8 text-cyan-300" />
          </div>
          <h2 className="text-lg font-bold text-white">تم تسجيل الدخول من جهاز آخر</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            حسابك يعمل على جهاز واحد فقط في نفس الوقت. إذا أردت المتابعة من هذا الجهاز، سيتوقف الجهاز الآخر تلقائياً، ويبقى تقدمك محفوظاً.
          </p>
          <button
            onClick={takeOver}
            disabled={takingOver}
            className="w-full min-h-[52px] rounded-2xl font-bold text-sm disabled:opacity-60"
            style={{ background: 'linear-gradient(180deg,#DDF4FB,#BFE6F2)', color: '#03131B' }}
          >
            {takingOver ? 'جاري التفعيل...' : 'استخدام هذا الجهاز'}
          </button>
        </div>
      </div>
    );
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
          {currentView === 'smart_first_aid' && <SmartFirstAidView onNavigate={handleNavigate} initialPartId={viewParams.partId} initialPage={viewParams.page} />}
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

          {currentView === 'sync_check' && <SyncCheck onNavigate={handleNavigate} />}
          {currentView === 'admin' && (
            <AdminDashboard onNavigate={handleNavigate} onRefreshData={handleRefreshData} />
          )}
          </div>
        </main>
      </div>
    </ContentProtection>
  );
}
