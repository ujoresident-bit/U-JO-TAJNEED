import React, { useMemo, useState } from 'react';
import { ChevronRight, Flag } from 'lucide-react';
import { Block, Question, BlockAnswer } from '../types';
import { PerfStyles, Confetti, CountUp, tierFor, formatDuration } from './PerfKit';
import { ResultStrip, StripItem } from './ResultStrip';
import { startBlock } from '../services/questionBankService';

interface BlockSummaryViewProps {
  block: Block;
  questions: Question[];
  onReviewBlock: (filterMode?: 'incorrect' | 'all' | 'flagged', index?: number) => void;
  onNavigate: (view: string, params?: any) => void;
}

const MESSAGES: Record<string, string[]> = {
  excellent: ['Outstanding work. This is exam-ready performance.', 'You crushed this block. Keep this rhythm going.'],
  pass: ['Solid result. A little review on the misses and you are above the bar.', 'Good block. Your weak spots are now easy to see.'],
  warn: ['You are close. Review the explanations and retry in a day.', 'Progress is built from blocks like this one. Review and go again.'],
  low: ['This block shows exactly where to focus. Review each miss carefully.', 'Every miss you review now is a mark saved in the exam.']
};

export const BlockSummaryView: React.FC<BlockSummaryViewProps> = ({ block, questions, onReviewBlock, onNavigate }) => {
  const total = questions.length;
  const orderedIds = block.questionIds?.length ? block.questionIds : questions.map((q) => q.id);
  const qById = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const answeredList = Object.values(block.answers) as BlockAnswer[];
  const correctCount = answeredList.filter((a) => a.isCorrect).length;
  const incorrectCount = answeredList.filter((a) => !a.isCorrect).length;
  const unansweredCount = Math.max(0, total - answeredList.length);
  const scorePct = block.score ?? (total > 0 ? Math.round((correctCount / total) * 100) : 0);
  const tier = tierFor(scorePct);
  const message = useMemo(() => {
    const list = MESSAGES[tier.key];
    return list[(block.id?.length || 0) % list.length];
  }, [tier.key, block.id]);

  const seconds = block.timeSpentSeconds || 0;
  const flaggedCount = orderedIds.filter((id) => block.annotations?.[id]?.flagged).length;

  const items: StripItem[] = orderedIds.map((id) => {
    const a = block.answers[id];
    return { s: a ? (a.isCorrect ? 'ok' : 'bad') : null, f: Boolean(block.annotations?.[id]?.flagged) };
  });
  const narrow = typeof window !== 'undefined' && window.innerWidth < 560;
  const half = Math.ceil(items.length / 2);

  // Subjects count every question in the block; unanswered ones count as not correct, like the score does.
  const bySubject = useMemo(() => {
    const m = new Map<string, { total: number; correct: number }>();
    orderedIds.forEach((id) => {
      const q = qById.get(id);
      if (!q) return;
      const major = q.major || 'Other';
      const s = m.get(major) || { total: 0, correct: 0 };
      s.total += 1;
      if (block.answers[id]?.isCorrect) s.correct += 1;
      m.set(major, s);
    });
    return Array.from(m.entries())
      .map(([major, v]) => ({ major, ...v, pct: Math.round((v.correct / v.total) * 100) }))
      .sort((a, b) => a.pct - b.pct || b.total - a.total);
  }, [orderedIds, qById, block.answers]);

  const focus = bySubject.length > 0 && bySubject[0].pct < 100 ? bySubject[0] : null;
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState('');
  const startFocus = async () => {
    if (!focus) return;
    setStarting(true); setErr('');
    try {
      const nb = await startBlock(block.userId, { majors: [focus.major], bankId: block.bankId, questionCount: 10 }, block.bankId);
      onNavigate('question_screen', { blockId: nb.id });
    } catch (e: any) {
      setErr(e?.message || 'Could not start a block.');
      setStarting(false);
    }
  };

  const label = (i: number, it: StripItem) => `Q${i + 1} · ${it.s === 'ok' ? 'Correct' : it.s === 'bad' ? 'Incorrect' : 'Omitted'}${it.f ? ' · Flagged' : ''}`;
  const pick = (i: number) => onReviewBlock('all', i);

  return (
    <div className="bs-root">
      <PerfStyles />
      <style>{BS_CSS}</style>
      {scorePct >= 65 && <Confetti count={scorePct >= 80 ? 60 : 30} />}

      <div className="bs-hero">
        <div className="bs-ring">
          <svg viewBox="0 0 200 200" aria-hidden="true">
            <circle cx="100" cy="100" r="88" fill="none" stroke="rgba(207,239,248,.1)" strokeWidth="10" />
            <circle cx="100" cy="100" r="88" fill="none" stroke={tier.color} strokeWidth="10" strokeLinecap="round"
              strokeDasharray="552.9" strokeDashoffset={552.9 * (1 - Math.min(100, scorePct) / 100)}
              style={{ filter: `drop-shadow(0 0 8px ${tier.color})`, animation: 'bs-ring 1.4s cubic-bezier(.16,1,.3,1) both' }} />
          </svg>
          <div className="c"><div><b><CountUp value={scorePct} duration={1400} delay={200} /><sup>%</sup></b><span className="bs-mono" style={{ color: '#93A3B6' }}>{correctCount} of {total}</span></div></div>
        </div>
        <div>
          <div className="bs-mono" style={{ color: '#4FD6EC' }}>Block complete</div>
          <h1 style={{ ['--t' as any]: tier.color }}>{tier.label}</h1>
          <p>{message}</p>
        </div>
      </div>

      <section className="bs-sec">
        <div className="bs-sh"><h3>Every question</h3><span className="bs-mono">Tap one to review it</span></div>
        <div className="bs-map">
          {narrow ? (
            <>
              <ResultStrip items={items.slice(0, half)} nums height={70} flagColor="#E8B66A" onSelect={pick} label={(i) => label(i, items[i])} />
              <ResultStrip items={items.slice(half)} offset={half} nums height={70} flagColor="#E8B66A" onSelect={pick} label={(i) => label(i, items[i])} />
            </>
          ) : (
            <ResultStrip items={items} nums height={84} flagColor="#E8B66A" onSelect={pick} label={(i) => label(i, items[i])} />
          )}
          <div className="bs-legend bs-mono">
            <span><b style={{ background: '#6FE0B4' }} />Correct</span>
            <span><b style={{ background: '#FF8FA3' }} />Incorrect</span>
            <span><b style={{ border: '1px solid #93A3B6' }} />Omitted</span>
            <span><b style={{ background: '#E8B66A' }} />Flagged</span>
          </div>
        </div>
        <div className="bs-stats">
          <div className="g"><b>{correctCount}</b><span className="bs-mono">Correct</span></div>
          <div className="r"><b>{incorrectCount}</b><span className="bs-mono">Incorrect</span></div>
          <div><b>{unansweredCount}</b><span className="bs-mono">Omitted</span></div>
          <div className="a"><b>{flaggedCount}</b><span className="bs-mono">Flagged</span></div>
          <div><b>{seconds > 0 ? formatDuration(seconds) : '–'}</b><span className="bs-mono">Time</span></div>
        </div>
      </section>

      {bySubject.length > 0 && (
        <section className="bs-sec">
          <div className="bs-sh"><h3>By subject</h3><span className="bs-mono">Weakest first</span></div>
          <div className="bs-subj">
            {bySubject.map((s) => {
              const t = tierFor(s.pct);
              return (
                <div className="sr" key={s.major}>
                  <div className="nm">{s.major}<small>{s.correct} of {s.total} correct</small></div>
                  <div className="bar"><i style={{ width: `${s.pct}%`, background: t.color }} /></div>
                  <b style={{ color: t.color }}>{s.pct}%</b>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {focus && (
        <section className="bs-sec">
          <div className="bs-focus">
            <div>
              <div className="bs-mono" style={{ color: '#4FD6EC' }}>Focus next</div>
              <h4>{focus.major}</h4>
              <p>{focus.correct} of {focus.total} correct in this block. A short block here is the quickest gain.</p>
              {err && <p style={{ color: '#FF8FA3' }}>{err}</p>}
            </div>
            <button className="bs-pri" onClick={startFocus} disabled={starting}>
              <span>{starting ? 'Starting…' : 'Start 10 questions'}</span><span className="a"><ChevronRight className="w-4 h-4" /></span>
            </button>
          </div>
        </section>
      )}

      <div className="bs-foot">
        {incorrectCount > 0 && <button className="bs-btn" onClick={() => onReviewBlock('incorrect')}>Review incorrect ({incorrectCount})</button>}
        {flaggedCount > 0 && <button className="bs-btn fl" onClick={() => onReviewBlock('flagged')}><Flag className="w-4 h-4" />Review flagged ({flaggedCount})</button>}
        <button className="bs-btn" onClick={() => onReviewBlock('all')}>Review all questions</button>
        <button className="bs-btn wide" onClick={() => onNavigate('bank')}>New block</button>
        <button className="bs-btn txt wide" onClick={() => onNavigate('home')}>Back to home</button>
      </div>
    </div>
  );
};

const BS_CSS = `
.bs-root{max-width:1040px;margin:0 auto;padding-bottom:48px;color:#EAF1F7;font-family:'Geist','Inter',system-ui,sans-serif}
.bs-mono{font:500 10.5px 'Geist Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase}
.bs-hero{display:grid;gap:26px;align-items:center;padding:8px 0 4px}
@media(min-width:860px){.bs-hero{grid-template-columns:260px minmax(0,1fr);gap:48px}}
.bs-ring{position:relative;width:min(240px,70vw);aspect-ratio:1;margin:0 auto}
.bs-ring svg{width:100%;height:100%;transform:rotate(-90deg)}
.bs-ring .c{position:absolute;inset:0;display:grid;place-items:center;text-align:center}
.bs-ring .c b{display:block;font:400 74px/1 'Instrument Serif',Georgia,serif;font-variant-numeric:tabular-nums}
.bs-ring .c b sup{font-size:30px;vertical-align:top;margin-left:2px;color:#93A3B6}
@keyframes bs-ring{from{stroke-dashoffset:552.9}}
.bs-hero h1{margin:8px 0 0;font:400 clamp(34px,5vw,56px)/1.04 'Instrument Serif',Georgia,serif;color:var(--t,#EAF1F7);text-wrap:balance}
.bs-hero p{margin:14px 0 0;color:#A9B8C8;font-size:16px;line-height:1.6;max-width:52ch}
.bs-sec{margin-top:36px}
.bs-sh{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:12px}
.bs-sh h3{margin:0;font:400 28px/1 'Instrument Serif',Georgia,serif}.bs-sh .bs-mono{color:#93A3B6}
.bs-map{padding:18px 14px 12px;border-radius:22px;border:1px solid rgba(207,239,248,.12);background:#0c141a}
.bs-legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:6px;padding:0 6px;color:#93A3B6}
.bs-legend span{display:inline-flex;align-items:center;gap:7px}.bs-legend b{width:9px;height:9px;border-radius:50%;display:inline-block}
.bs-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:14px}
@media(min-width:760px){.bs-stats{grid-template-columns:repeat(5,1fr)}}
.bs-stats>div{padding:14px;border-radius:18px;border:1px solid rgba(207,239,248,.12);background:rgba(207,239,248,.03)}
.bs-stats b{display:block;font:400 38px/1 'Instrument Serif',Georgia,serif;font-variant-numeric:tabular-nums}
.bs-stats .bs-mono{display:block;margin-top:8px;color:#93A3B6;font-size:9.5px}
.bs-stats .g b{color:#6FE0B4}.bs-stats .r b{color:#FF8FA3}.bs-stats .a b{color:#E8B66A}
.bs-subj{display:grid;gap:12px}
.bs-subj .sr{display:grid;grid-template-columns:minmax(0,150px) minmax(0,1fr) 54px;align-items:center;gap:14px;font-size:15px}
@media(max-width:560px){.bs-subj .sr{grid-template-columns:minmax(0,1fr) 54px;row-gap:6px}.bs-subj .sr .bar{grid-column:1/-1;order:3}}
.bs-subj .nm{min-width:0}.bs-subj .nm small{display:block;font:500 10px 'Geist Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:#93A3B6;margin-top:3px}
.bs-subj .bar{height:6px;border-radius:6px;background:rgba(207,239,248,.08);overflow:hidden}.bs-subj .bar i{display:block;height:100%;border-radius:6px;transform-origin:left;animation:pf-fill .9s cubic-bezier(.2,.8,.2,1) .4s both}
.bs-subj b{font:500 13px 'Geist Mono',monospace;text-align:right;font-variant-numeric:tabular-nums}
.bs-focus{display:flex;gap:18px;flex-wrap:wrap;align-items:center;justify-content:space-between;padding:20px;border-radius:24px;border:1px solid rgba(79,214,236,.3);background:linear-gradient(160deg,rgba(79,214,236,.09),rgba(207,239,248,.02))}
.bs-focus h4{margin:6px 0 0;font:400 30px/1.1 'Instrument Serif',Georgia,serif}.bs-focus p{margin:6px 0 0;color:#93A3B6;font-size:14px}
.bs-pri{min-height:54px;min-width:200px;border-radius:16px;border:0;color:#03131B;background:linear-gradient(180deg,#DDF4FB,#BFE6F2);box-shadow:0 10px 36px -14px rgba(79,214,236,.7);display:flex;align-items:center;justify-content:space-between;gap:14px;padding:0 8px 0 22px;font:600 15px 'Geist','Inter',sans-serif;cursor:pointer}
.bs-pri:disabled{opacity:.6;cursor:default}
.bs-pri .a{width:38px;height:38px;border-radius:12px;background:#03131B;color:#CFEFF8;display:grid;place-items:center}
.bs-foot{display:grid;gap:10px;margin-top:22px}
@media(min-width:760px){.bs-foot{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}.bs-foot .wide{grid-column:1/-1}}
.bs-btn{min-height:54px;border-radius:16px;border:1px solid rgba(207,239,248,.12);background:rgba(207,239,248,.05);color:#EAF1F7;font:600 15px 'Geist','Inter',sans-serif;display:flex;align-items:center;justify-content:center;gap:10px;padding:0 18px;cursor:pointer}
.bs-btn.fl{color:#FF8FA3;border-color:rgba(255,143,163,.4);background:rgba(255,143,163,.06)}
.bs-btn.txt{border:0;background:none;color:#93A3B6;font-weight:500;font-size:14px;min-height:44px}
.bs-root button:focus-visible{outline:2px solid #4FD6EC;outline-offset:3px}
@media(prefers-reduced-motion:reduce){.bs-ring svg circle,.bs-subj .bar i{animation:none!important}}
`;
