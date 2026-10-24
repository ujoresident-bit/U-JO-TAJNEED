import React from 'react';
import { Check, Flag } from 'lucide-react';
import { ResultStrip, StripItem } from './ResultStrip';

interface EndBlockModalProps {
  onSaveAndExit: () => void;
  onFinishBlock: () => void;
  onCancel: () => void;
  answeredCount: number;
  totalQuestions: number;
  items: StripItem[];
  flaggedCount: number;
  onReviewFlagged: () => void;
}

export const EndBlockModal: React.FC<EndBlockModalProps> = ({
  onSaveAndExit, onFinishBlock, onCancel, answeredCount, totalQuestions, items, flaggedCount, onReviewFlagged
}) => {
  const unanswered = Math.max(0, totalQuestions - answeredCount);
  const allDone = unanswered === 0;

  React.useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onCancel]);

  return (
    <div className="eb-back" onClick={onCancel}>
      <style>{EB_CSS}</style>
      <div className="eb-sheet" role="dialog" aria-modal="true" aria-label="End this block" onClick={(e) => e.stopPropagation()}>
        <div className="eb-mono" style={{ color: '#4FD6EC' }}>Block · {totalQuestions} questions</div>
        <h2>{allDone ? 'Finish this block?' : 'End this block?'}</h2>
        <p className="eb-sub">
          {allDone ? 'Every question has an answer. Finish to see your score.' : 'You can save it and come back later, or finish now to see your score.'}
        </p>

        <div style={{ margin: '20px -6px 0' }}><ResultStrip items={items} height={64} flagColor="#FF8FA3" /></div>
        <div className="eb-legend eb-mono">
          <span><b style={{ background: '#6FE0B4' }} />Answered</span>
          <span><b style={{ border: '1px solid #93A3B6' }} />Open</span>
          <span><b style={{ background: '#FF8FA3' }} />Flagged</span>
        </div>

        <div className="eb-nums">
          <div className="g"><b>{answeredCount}</b><span className="eb-mono">Answered</span></div>
          <div className="a"><b>{unanswered}</b><span className="eb-mono">Unanswered</span></div>
          <div className="r"><b>{flaggedCount}</b><span className="eb-mono">Flagged</span></div>
        </div>

        {!allDone && (
          <div className="eb-note">
            {unanswered} {unanswered === 1 ? 'question has' : 'questions have'} no answer. {unanswered === 1 ? 'It counts' : 'They count'} as incorrect if you finish now.
          </div>
        )}

        <div className="eb-acts">
          <button className="eb-pri" onClick={onFinishBlock}>
            <span>Finish block</span><span className="a"><Check className="w-4 h-4" /></span>
          </button>
          {flaggedCount > 0 && (
            <button className="eb-btn fl" onClick={onReviewFlagged}><Flag className="w-4 h-4" />Review flagged ({flaggedCount})</button>
          )}
          <button className="eb-btn" onClick={onSaveAndExit}>Save and exit</button>
          <button className="eb-btn txt" onClick={onCancel} autoFocus>Continue answering</button>
        </div>
      </div>
    </div>
  );
};

const EB_CSS = `
.eb-back{position:fixed;inset:0;z-index:90;background:rgba(3,6,9,.78);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;font-family:'Geist','Inter',system-ui,sans-serif;color:#EAF1F7}
.eb-mono{font:500 10.5px 'Geist Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase}
.eb-sheet{width:min(520px,100%);max-height:100%;overflow:auto;padding:26px;border-radius:28px;border:1px solid rgba(207,239,248,.16);background:linear-gradient(180deg,#10181f,#0a1015);box-shadow:0 40px 100px -30px #000,0 0 80px -50px #4FD6EC}
.eb-sheet h2{margin:8px 0 0;font:400 clamp(34px,6vw,44px)/1 'Instrument Serif',Georgia,serif}
.eb-sub{margin:10px 0 0;color:#93A3B6;font-size:14.5px;line-height:1.55}
.eb-legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:6px;color:#93A3B6}
.eb-legend span{display:inline-flex;align-items:center;gap:7px}.eb-legend b{width:9px;height:9px;border-radius:50%;display:inline-block}
.eb-nums{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:20px}
.eb-nums>div{padding:14px;border-radius:18px;border:1px solid rgba(207,239,248,.12);background:rgba(207,239,248,.03)}
.eb-nums b{display:block;font:400 38px/1 'Instrument Serif',Georgia,serif;font-variant-numeric:tabular-nums}
.eb-nums .eb-mono{display:block;margin-top:8px;color:#93A3B6;font-size:9.5px}
.eb-nums .g b{color:#6FE0B4}.eb-nums .a b{color:#E8B66A}.eb-nums .r b{color:#FF8FA3}
.eb-note{margin-top:14px;padding:12px 14px;border-radius:14px;background:rgba(232,182,106,.08);border:1px solid rgba(232,182,106,.3);color:#F2D9A8;font-size:13px;line-height:1.5}
.eb-acts{display:grid;gap:10px;margin-top:20px}
.eb-btn{min-height:54px;border-radius:16px;border:1px solid rgba(207,239,248,.12);background:rgba(207,239,248,.05);color:#EAF1F7;font:600 15px 'Geist','Inter',sans-serif;display:flex;align-items:center;justify-content:center;gap:10px;padding:0 18px;cursor:pointer}
.eb-btn.fl{color:#FF8FA3;border-color:rgba(255,143,163,.4);background:rgba(255,143,163,.06)}
.eb-btn.txt{border:0;background:none;color:#93A3B6;font-weight:500;font-size:14px;min-height:44px}
.eb-pri{min-height:54px;border-radius:16px;border:0;color:#03131B;background:linear-gradient(180deg,#DDF4FB,#BFE6F2);box-shadow:0 10px 36px -14px rgba(79,214,236,.7);display:flex;align-items:center;justify-content:space-between;padding:0 8px 0 22px;font:600 15px 'Geist','Inter',sans-serif;cursor:pointer}
.eb-pri .a{width:38px;height:38px;border-radius:12px;background:#03131B;color:#CFEFF8;display:grid;place-items:center}
.eb-sheet button:focus-visible{outline:2px solid #4FD6EC;outline-offset:3px}
`;
