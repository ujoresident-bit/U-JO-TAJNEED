import React, { useEffect, useState } from 'react';

interface ContentProtectionProps {
  currentView?: string;
  children?: React.ReactNode;
}

export const ContentProtection: React.FC<ContentProtectionProps> = ({ children }) => {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isObscured, setIsObscured] = useState<boolean>(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 1800);
    return () => clearTimeout(timer);
  };

  // Helper to check if event target is an input / form element or explicitly allowed area
  const isFormOrAllowedElement = (target: EventTarget | null): boolean => {
    if (!target || !(target instanceof HTMLElement)) return false;

    const tagName = target.tagName.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      return true;
    }
    if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') {
      return true;
    }
    if (target.closest('input, textarea, select, [contenteditable="true"], .allow-select, .allow-select *')) {
      return true;
    }
    return false;
  };

  useEffect(() => {
    let lastToastTime = 0;
    const triggerToast = (msg: string) => {
      const now = Date.now();
      if (now - lastToastTime > 2000) {
        lastToastTime = now;
        showToast(msg);
      }
    };

    // 1. Context Menu
    const handleContextMenu = (e: MouseEvent) => {
      if (!isFormOrAllowedElement(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        triggerToast('نسخ المحتوى غير مسموح به.');
      }
    };

    // 2. Copy / Cut / Paste
    const handleCopyCutPaste = (e: ClipboardEvent) => {
      if (!isFormOrAllowedElement(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        triggerToast('نسخ المحتوى غير مسموح به.');
      }
    };

    // 3. Shortcuts (Ctrl+C, Ctrl+X, Ctrl+U, Ctrl+S, Ctrl+P, DevTools F12, Ctrl+Shift+I/J/C)
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Global extraction shortcuts (block even inside form elements where appropriate)
      if (
        e.key === 'F12' ||
        (isCtrlOrCmd && e.shiftKey && (key === 'i' || key === 'j' || key === 'c' || key === 'I' || key === 'J' || key === 'C')) ||
        (isCtrlOrCmd && (key === 'u' || key === 's' || key === 'p'))
      ) {
        e.preventDefault();
        e.stopPropagation();
        triggerToast('هذا الاختصار غير متاح لمحتوى المنصة المحمي.');
        return;
      }

      // Copy / Cut shortcuts outside form elements
      if (isCtrlOrCmd && (key === 'c' || key === 'x')) {
        if (!isFormOrAllowedElement(e.target)) {
          e.preventDefault();
          e.stopPropagation();
          triggerToast('نسخ المحتوى غير مسموح به.');
        }
      }
    };

    // 4. Image Drag Protection
    const handleDragStart = (e: DragEvent) => {
      if (e.target instanceof HTMLImageElement) {
        if (!isFormOrAllowedElement(e.target) && !e.target.classList.contains('allow-drag')) {
          e.preventDefault();
        }
      }
    };

    // 5. Obscure when tab becomes hidden
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setIsObscured(true);
      } else {
        setIsObscured(false);
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('copy', handleCopyCutPaste);
    document.addEventListener('cut', handleCopyCutPaste);
    document.addEventListener('paste', handleCopyCutPaste);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('copy', handleCopyCutPaste);
      document.removeEventListener('cut', handleCopyCutPaste);
      document.removeEventListener('paste', handleCopyCutPaste);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('dragstart', handleDragStart);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return (
    <div className="protected-content relative min-h-screen">
      {/* Tab switch / hidden visibility blur screen */}
      {isObscured && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-xl z-[9999] flex items-center justify-center text-slate-300 font-bold p-6 text-center select-none" dir="rtl">
          <div className="space-y-2">
            <div className="text-2xl">🩺 U JO Resident</div>
            <p className="text-sm text-slate-400">المحتوى محمي لمستخدم المنصة. يرجى العودة للتبويب لعرض المحتوى.</p>
          </div>
        </div>
      )}

      {/* Non-intrusive notification toast */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-[10000] bg-slate-900/90 text-amber-300 border border-amber-500/40 px-4 py-2 rounded-xl text-xs font-semibold shadow-2xl backdrop-blur-md animate-fade-in pointer-events-none flex items-center gap-2" dir="rtl">
          <span>🔒</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {children}
    </div>
  );
};
