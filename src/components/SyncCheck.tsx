import React, { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { getCurrentUser } from '../services/authService';
import { getAllStoredBlocks } from '../services/questionBankService';

interface Props { onNavigate: (view: string, params?: any) => void }

// Admin-only diagnostic: shows which identity this device uses, how many blocks
// it holds, what the account (server) holds, and uploads local blocks with the
// server's real error messages so a failed sync is visible instead of silent.
export const SyncCheck: React.FC<Props> = ({ onNavigate }) => {
  const user = getCurrentUser();
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const log = (s: string) => setLines((l) => [...l, s]);
  const headers = { 'x-telegram-user-id': user.telegramId || '', 'x-telegram-username': user.username || '' };
  const inTelegram = typeof window !== 'undefined' && Boolean((window as any).Telegram?.WebApp?.initData);

  const summarize = (blocks: any[]) => {
    const by: Record<string, number> = {};
    let answers = 0;
    blocks.forEach((b) => { by[b.status] = (by[b.status] || 0) + 1; answers += Object.keys(b.answers || {}).length; });
    return `${blocks.length} blocks (${Object.entries(by).map(([k, v]) => `${k}:${v}`).join(', ') || '-'}), ${answers} answers`;
  };

  const check = async () => {
    setBusy(true); setLines([]);
    const mine = getAllStoredBlocks().filter((b) => b.userId === user.telegramId);
    log(`Device identity: ${user.telegramId} (${user.username}) | Telegram: ${inTelegram ? 'yes' : 'NO (browser)'}`);
    log(`On this device: ${summarize(mine)}`);
    const others = getAllStoredBlocks().length - mine.length;
    if (others > 0) log(`Blocks here that belong to another identity: ${others}`);
    try {
      const res = await fetch('/api/blocks', { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) log(`Account (server) read FAILED: HTTP ${res.status} ${data?.error || ''}`);
      else log(`In your account: ${summarize(data.blocks || [])}${data.note ? ' | ' + data.note : ''}`);
    } catch (e: any) { log(`Account read failed: ${e?.message || e}`); }
    setBusy(false);
  };

  const upload = async () => {
    setBusy(true);
    const mine = getAllStoredBlocks().filter((b) => b.userId === user.telegramId);
    log(`Uploading ${mine.length} local blocks...`);
    let ok = 0, fail = 0, firstErr = '';
    for (const block of mine) {
      try {
        const res = await fetch('/api/blocks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ block })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.synced) ok++;
        else { fail++; if (!firstErr) firstErr = `HTTP ${res.status} ${data?.error || data?.note || ''}`; }
      } catch (e: any) { fail++; if (!firstErr) firstErr = String(e?.message || e); }
    }
    log(`Upload done: ${ok} accepted, ${fail} rejected${firstErr ? ' | first error: ' + firstErr : ''}`);
    setBusy(false);
  };

  return (
    <div className="max-w-xl mx-auto space-y-4 pb-16">
      <button onClick={() => onNavigate('back')} className="flex items-center gap-1.5 min-h-[44px] text-xs font-medium text-slate-400 hover:text-slate-200">
        <ChevronLeft className="w-4 h-4" /><span>Back</span>
      </button>
      <h1 className="text-2xl font-semibold text-white">Sync check</h1>
      <p className="text-sm text-slate-400">Run this on the laptop first, then on the phone, and compare the lines.</p>
      <div className="flex gap-2">
        <button disabled={busy} onClick={check} className="flex-1 min-h-[48px] rounded-xl bg-[#CFEFF8] text-[#03131B] font-semibold text-sm disabled:opacity-50">Check</button>
        <button disabled={busy} onClick={upload} className="flex-1 min-h-[48px] rounded-xl border border-cyan-400/40 text-cyan-200 font-semibold text-sm disabled:opacity-50">Upload local blocks</button>
      </div>
      <pre className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-slate-200 bg-white/5 border border-white/10 rounded-xl p-4 min-h-[120px]">{lines.join('\n') || 'Press Check.'}</pre>
    </div>
  );
};
