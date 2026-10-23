import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, CheckCircle2, Loader2 } from 'lucide-react';
import BrainScan from './BrainScan';
import { fetchDueReviews, recordReview, DueReviewItem, UserCardData } from '../services/reviewService';
import { getStoredQuestions } from '../services/questionBankService';
import { getFlashcards, syncFlashcardsFromSupabase } from '../services/flashcardService';
import { Flashcard, OptionKey, Question } from '../types';

interface ReviewViewProps {
  bankId: string;
  onNavigate: (view: string, params?: any) => void;
}

type ReviewEntry =
  | { kind: 'question'; id: string; stage: number; question: Question }
  | { kind: 'flashcard'; id: string; stage: number; card: Flashcard }
  | { kind: 'usercard'; id: string; stage: number; card: UserCardData };

const clampStage = (n: number) => Math.max(0, Math.min(2, Number(n) || 0));
const TIER_LABEL = ['1 day', '3 days', '7 days'];

// Daily spaced-repetition session: everything the student previously got
// wrong that is now due (1 day → 3 days → 7 days), questions and flashcards.
export const ReviewView: React.FC<ReviewViewProps> = ({ bankId, onNavigate }) => {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<ReviewEntry[]>([]);
  const [totalQueued, setTotalQueued] = useState(0);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<OptionKey | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [answeredThisCard, setAnsweredThisCard] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const [started, setStarted] = useState(false);
  const [outcomes, setOutcomes] = useState<[number, number, number]>([0, 0, 0]);
  const [lastMove, setLastMove] = useState<{ ok: boolean; tier: number } | null>(null);
  const [brainEvent, setBrainEvent] = useState<{ n: number; i: number; tier: number } | null>(null);
  const tiers = useMemo(() => entries.map((e) => e.stage), [entries]);

  useEffect(() => {
    (async () => {
      const { due, cards: userCards, totalQueued: queued } = await fetchDueReviews(bankId);
      const userCardsById = new Map(userCards.map((c) => [c.id, c]));
      setTotalQueued(queued);
      // Make sure local flashcard caches are fresh before mapping ids.
      await Promise.all([
        syncFlashcardsFromSupabase('flashcard').catch(() => {}),
        syncFlashcardsFromSupabase('most_common').catch(() => {})
      ]);
      const questionsById = new Map(getStoredQuestions().map((q) => [q.id, q]));
      const cardsById = new Map<string, Flashcard>();
      [...getFlashcards('flashcard'), ...getFlashcards('most_common')].forEach((c) => cardsById.set(c.id, c));

      const built: ReviewEntry[] = [];
      due.forEach((d: DueReviewItem) => {
        if (d.itemType === 'question') {
          const q = questionsById.get(d.itemId);
          if (q) built.push({ kind: 'question', id: d.itemId, stage: clampStage(d.stage), question: q });
        } else if (d.itemType === 'user_card') {
          const c = userCardsById.get(d.itemId);
          if (c) built.push({ kind: 'usercard', id: d.itemId, stage: clampStage(d.stage), card: c });
        } else {
          const c = cardsById.get(d.itemId);
          if (c) built.push({ kind: 'flashcard', id: d.itemId, stage: clampStage(d.stage), card: c });
        }
      });
      setEntries(built);
      setLoading(false);
    })();
  }, [bankId]);

  const current = entries[index];

  const registerOutcome = (ok: boolean) => {
    if (!current) return;
    const tier = ok ? Math.min(2, current.stage + 1) : 0;
    setOutcomes((o) => {
      const next: [number, number, number] = [o[0], o[1], o[2]];
      next[tier] += 1;
      return next;
    });
    setLastMove({ ok, tier });
    setBrainEvent((e) => ({ n: (e?.n || 0) + 1, i: index, tier }));
  };

  const advance = () => {
    if (index + 1 >= entries.length) {
      setFinished(true);
      return;
    }
    setIndex(index + 1);
    setPicked(null);
    setFlipped(false);
    setAnsweredThisCard(false);
    setLastMove(null);
  };

  const answerQuestion = (key: OptionKey) => {
    if (!current || current.kind !== 'question' || answeredThisCard) return;
    const ok = key === current.question.correctAnswer;
    setPicked(key);
    setAnsweredThisCard(true);
    if (ok) setCorrectCount((c) => c + 1);
    registerOutcome(ok);
    recordReview('question', current.id, ok, current.question.bankId || bankId);
  };

  const answerCard = (ok: boolean) => {
    if (!current || (current.kind !== 'flashcard' && current.kind !== 'usercard')) return;
    if (ok) setCorrectCount((c) => c + 1);
    registerOutcome(ok);
    recordReview(current.kind === 'usercard' ? 'user_card' : 'flashcard', current.id, ok, bankId);
    advance();
  };

  const later = Math.max(0, totalQueued - entries.length);
  const stageCounts = [0, 1, 2].map((t) => entries.filter((e) => e.stage === t).length);
  const inSession = started && !finished && entries.length > 0 && !loading;
  const active = inSession ? index : -1;
  const focusTier = inSession && current ? current.stage : -1;
  const progressPct = entries.length ? Math.round(((finished ? entries.length : index) / entries.length) * 100) : 0;

  const back = (
    <button className="rv-back" onClick={() => onNavigate('back')}>
      <ChevronLeft size={16} /> Back
    </button>
  );
  const arrow = <span className="a"><ChevronRight size={18} /></span>;

  if (loading) {
    return (
      <div className="rv">
        <style>{RV_CSS}</style>
        <div style={{ padding: '64px 0', textAlign: 'center', color: 'var(--dim)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Loader2 size={16} className="animate-spin" /> Loading your review...
        </div>
      </div>
    );
  }

  let main: React.ReactNode;
  if (entries.length === 0) {
    main = (
      <>
        <div className="rv-mono" style={{ color: 'var(--cy)' }}>Daily review</div>
        <h1 className="rv-h1">Nothing <em>due</em></h1>
        <p className="rv-sub">
          {totalQueued > 0
            ? `${totalQueued} item${totalQueued === 1 ? '' : 's'} are scheduled for later. Come back when they are due.`
            : 'Questions and flashcards you miss appear here automatically, after 1 day, then 3 days, then 7 days.'}
        </p>
        <button className="rv-go" onClick={() => onNavigate('back')}><span>Back to hub</span>{arrow}</button>
      </>
    );
  } else if (finished) {
    const pct = entries.length ? correctCount / entries.length : 0;
    main = (
      <div style={{ textAlign: 'center' }}>
        <div className="rv-mono" style={{ color: 'var(--cy)' }}>Review complete</div>
        <div className="rv-ringw">
          <svg viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(207,239,248,.1)" strokeWidth="7" />
            <circle cx="60" cy="60" r="52" fill="none" stroke="#6FE0B4" strokeWidth="7" strokeLinecap="round" strokeDasharray="326.7" strokeDashoffset={326.7 * (1 - pct)} style={{ filter: 'drop-shadow(0 0 6px rgba(111,224,180,.7))' }} />
          </svg>
          <div className="c"><div><b>{correctCount}</b><span className="rv-mono">of {entries.length}</span></div></div>
        </div>
        <p className="rv-sub" style={{ margin: '4px auto 0' }}>Missed items come back tomorrow. Correct ones move to a longer interval.</p>
        <div className="rv-moves">
          <div style={{ ['--t' as any]: '111,224,180' }}><span>Moved to 7 days</span><span>{outcomes[2]}</span></div>
          <div style={{ ['--t' as any]: '180,168,245' }}><span>Moved to 3 days</span><span>{outcomes[1]}</span></div>
          <div style={{ ['--t' as any]: '79,214,236' }}><span>Back tomorrow</span><span>{outcomes[0]}</span></div>
        </div>
        <button className="rv-go" onClick={() => onNavigate('back')}><span>Done</span>{arrow}</button>
      </div>
    );
  } else if (!started) {
    main = (
      <>
        <div className="rv-mono" style={{ color: 'var(--cy)' }}>Daily review</div>
        <h1 className="rv-h1">Bring it <em>back</em></h1>
        <p className="rv-sub">What you missed returns after 1 day, then 3, then 7. Get it right and it moves to the next interval.</p>
        <div className="rv-legend">
          {[0, 1, 2].map((t) => (
            <div key={t} className="rv-lg" style={{ ['--t' as any]: ['79,214,236', '180,168,245', '111,224,180'][t] }}>
              <span className="rv-mono"><span className="d" />{TIER_LABEL[t]}</span>
              <b>{stageCounts[t]}</b>
              <small>due today</small>
            </div>
          ))}
        </div>
        {later > 0 && <div className="rv-later"><span>Scheduled for later</span><b>{later} item{later === 1 ? '' : 's'}</b></div>}
        <button className="rv-go" onClick={() => setStarted(true)}><span>Start review · {entries.length} item{entries.length === 1 ? '' : 's'}</span>{arrow}</button>
      </>
    );
  } else if (current.kind === 'question') {
    main = (
      <>
        <div className="rv-top">{back}<span className="rv-mono">{index + 1} / {entries.length}</span></div>
        <div className="rv-bar"><i style={{ width: `${progressPct}%` }} /></div>
        <div className="rv-card" style={{ ['--t' as any]: ['79,214,236', '180,168,245', '111,224,180'][current.stage] }}>
          <div className="rv-tag"><i>Question</i><span className="rv-mono">Due after {TIER_LABEL[current.stage]}</span></div>
          <p className="rv-q">{current.question.question}</p>
          <div className="rv-opts">
            {(['A', 'B', 'C', 'D', 'E'] as OptionKey[])
              .filter((k) => Boolean(current.question.options[k]))
              .map((k) => {
                const isCorrect = k === current.question.correctAnswer;
                const isPicked = picked === k;
                const cls = answeredThisCard && isCorrect ? ' ok' : answeredThisCard && isPicked ? ' bad' : '';
                return (
                  <button key={k} className={`rv-opt${cls}`} onClick={() => answerQuestion(k)} disabled={answeredThisCard}>
                    <b>{k}</b><span>{current.question.options[k]}</span>
                  </button>
                );
              })}
          </div>
          {answeredThisCard && (
            <>
              {current.question.explanation && <div className="rv-exp">{current.question.explanation}</div>}
              {lastMove && (
                <div className="rv-move" style={{ ['--t' as any]: lastMove.ok ? '111,224,180' : '255,143,163' }}>
                  {lastMove.ok ? `Moves out to the ${[1, 3, 7][lastMove.tier]} day interval` : 'Stays close. Back tomorrow'}
                </div>
              )}
              <button className="rv-go" onClick={advance}><span>{index + 1 >= entries.length ? 'Finish' : 'Next'}</span>{arrow}</button>
            </>
          )}
        </div>
      </>
    );
  } else {
    main = (
      <>
        <div className="rv-top">{back}<span className="rv-mono">{index + 1} / {entries.length}</span></div>
        <div className="rv-bar"><i style={{ width: `${progressPct}%` }} /></div>
        <button className={`rv-flip${flipped ? ' back' : ''}`} onClick={() => setFlipped((f) => !f)}>
          <span>
            <span className="rv-mono" style={{ color: flipped ? 'var(--gr)' : 'var(--cy)' }}>
              {flipped ? 'Answer' : 'Question · tap to reveal'}
            </span>
            {current.kind === 'usercard' && (current.card.partTitle || current.card.page) && (
              <span className="rv-mono" style={{ display: 'block', marginTop: 6, textTransform: 'none', letterSpacing: '.04em' }}>
                {current.card.partTitle}{current.card.page ? ` · p.${current.card.page}` : ''}
              </span>
            )}
            <span className="t">
              {current.kind === 'usercard'
                ? (flipped ? current.card.back : current.card.front)
                : (flipped ? current.card.answer : current.card.question)}
            </span>
            {flipped && current.kind === 'usercard' && current.card.partId && (
              <span
                role="button"
                className="rv-open"
                onClick={(e) => { e.stopPropagation(); onNavigate('smart_first_aid', { partId: current.card.partId, page: current.card.page || 1 }); }}
              >
                Open in First Aid
              </span>
            )}
          </span>
        </button>
        {flipped ? (
          <div className="rv-rate">
            <button className="miss" onClick={() => answerCard(false)}><RotateCcw size={16} /> Missed it</button>
            <button className="got" onClick={() => answerCard(true)}><CheckCircle2 size={16} /> Got it</button>
          </div>
        ) : (
          <p className="rv-mono" style={{ textAlign: 'center', marginTop: 12 }}>Think of the answer first, then tap the card.</p>
        )}
      </>
    );
  }

  return (
    <div className="rv">
      <style>{RV_CSS}</style>
      <div className="rv-lay">
        <div className="rv-main">
          {(!inSession) && <div className="rv-top">{back}</div>}
          {main}
        </div>
        <BrainScan tiers={tiers} active={active} focusTier={focusTier} event={brainEvent} small={inSession} />
      </div>
    </div>
  );
};

const RV_CSS = `
.rv{--ink:#EAF1F7;--dim:#93A3B6;--ice:#CFEFF8;--cy:#4FD6EC;--am:#E8B66A;--gr:#6FE0B4;--rose:#FF8FA3;--serif:'Instrument Serif',Georgia,serif;--sans:'Geist',system-ui,sans-serif;--mono:'Geist Mono',ui-monospace,monospace;color:var(--ink);font-family:var(--sans);max-width:1120px;margin:0 auto;overflow-x:clip}
.rv *{box-sizing:border-box}
.rv button{font-family:inherit;cursor:pointer}
.rv button:focus-visible{outline:2px solid var(--cy);outline-offset:3px}
.rv-mono{font:500 10.5px var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--dim)}
.rv-lay{display:grid;grid-template-columns:minmax(0,1fr);gap:0}
.rv-main{min-width:0;padding-bottom:40px}
.rv-stage{position:relative;order:-1;height:300px;margin:0 -16px;-webkit-mask-image:radial-gradient(ellipse 72% 72% at 50% 50%,#000 58%,transparent 100%);mask-image:radial-gradient(ellipse 72% 72% at 50% 50%,#000 58%,transparent 100%)}
.rv-stage.small{height:190px}
.rv-stage canvas{width:100%;height:100%;display:block;touch-action:pan-y;cursor:grab}
@media(min-width:900px){.rv-lay{grid-template-columns:minmax(0,460px) minmax(0,1fr);gap:24px;align-items:start;padding-top:8px}
 .rv-stage,.rv-stage.small{order:0;position:sticky;top:76px;height:min(80vh,760px);margin:0 -40px 0 0}}
.rv-top{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:44px}
.rv-back{display:inline-flex;align-items:center;gap:6px;min-height:44px;background:none;border:0;color:var(--dim);font:500 12px var(--sans);padding:0}
.rv-h1{margin:8px 0 0;font:400 clamp(42px,11vw,68px)/.96 var(--serif);letter-spacing:-.015em;color:var(--ink)}
.rv-h1 em{color:var(--ice)}
.rv-sub{margin:10px 0 0;color:var(--dim);font-size:14px;line-height:1.5;max-width:40ch}
.rv-legend{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:18px}
.rv-lg{padding:14px;border-radius:20px;border:1px solid rgba(207,239,248,.09);background:linear-gradient(160deg,rgba(207,239,248,.05),rgba(207,239,248,.012))}
.rv-lg b{display:block;font:400 34px/1 var(--serif);margin-top:8px;font-variant-numeric:tabular-nums}
.rv-lg .d{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;background:rgb(var(--t));box-shadow:0 0 10px rgba(var(--t),.8)}
.rv-lg small{display:block;margin-top:6px;color:var(--dim);font-size:12px}
.rv-later{margin-top:12px;display:flex;justify-content:space-between;gap:12px;padding:14px 16px;border-radius:16px;border:1px dashed rgba(207,239,248,.16);color:var(--dim);font-size:13px}
.rv-later b{color:var(--ink);font-weight:500}
.rv-go{margin-top:18px;width:100%;min-height:58px;border:0;border-radius:16px;display:flex;align-items:center;justify-content:space-between;padding:0 10px 0 22px;font:600 15px var(--sans);color:#03131B;background:linear-gradient(180deg,#DDF4FB,#BFE6F2);box-shadow:0 14px 50px -14px rgba(79,214,236,.65);transition:transform .25s}
.rv-go:hover{transform:translateY(-2px)}
.rv-go .a{width:40px;height:40px;border-radius:12px;background:#03131B;color:var(--ice);display:grid;place-items:center;flex:none}
.rv-bar{height:3px;border-radius:3px;background:rgba(207,239,248,.1);overflow:hidden;margin-top:4px}
.rv-bar i{display:block;height:100%;background:var(--cy);box-shadow:0 0 10px var(--cy);transition:width .5s}
.rv-card{margin-top:14px;padding:22px;border-radius:26px;border:1px solid rgba(207,239,248,.1);background:linear-gradient(160deg,rgba(207,239,248,.06),rgba(207,239,248,.012))}
.rv-tag{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.rv-tag i{font-style:normal;padding:3px 9px;border-radius:999px;border:1px solid rgba(var(--t),.5);color:rgb(var(--t));font:500 10px var(--mono);letter-spacing:.12em;text-transform:uppercase}
.rv-q{margin:14px 0 0;font:400 25px/1.25 var(--serif);text-wrap:pretty;white-space:pre-wrap;overflow-wrap:anywhere}
.rv-opts{display:grid;gap:8px;margin-top:18px}
.rv-opt{display:flex;gap:12px;align-items:flex-start;text-align:left;width:100%;min-height:52px;padding:13px 16px;border-radius:16px;border:1px solid rgba(207,239,248,.12);background:rgba(207,239,248,.03);color:#D8E2EC;font:400 14px/1.4 var(--sans)}
.rv-opt b{font:500 12px var(--mono);color:var(--dim);padding-top:2px;flex:none}
.rv-opt span{min-width:0;overflow-wrap:anywhere}
.rv-opt:hover:not(:disabled){border-color:rgba(79,214,236,.45)}
.rv-opt.ok{border-color:rgba(111,224,180,.6);background:rgba(111,224,180,.1);color:#CFF5E6}
.rv-opt.bad{border-color:rgba(255,143,163,.6);background:rgba(255,143,163,.1);color:#FFD3DB}
.rv-exp{margin-top:14px;padding:14px;border-radius:14px;background:rgba(207,239,248,.05);color:#C5D2DF;font-size:13px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
.rv-move{margin-top:12px;padding:12px 14px;border-radius:14px;font-size:13px;border:1px solid rgba(var(--t),.35);background:rgba(var(--t),.08);color:rgb(var(--t))}
.rv-flip{width:100%;min-height:230px;display:grid;place-items:center;text-align:center;padding:26px 20px;border-radius:26px;border:1px solid rgba(207,239,248,.1);background:linear-gradient(160deg,rgba(207,239,248,.06),rgba(207,239,248,.012));color:var(--ink);margin-top:14px;transition:border-color .3s}
.rv-flip .t{display:block;font:400 28px/1.25 var(--serif);margin-top:12px;text-wrap:balance;white-space:pre-wrap;overflow-wrap:anywhere}
.rv-flip.back{border-color:rgba(111,224,180,.45)}.rv-flip.back .t{color:#CFF5E6}
.rv-open{display:inline-block;margin-top:14px;padding:8px 14px;border-radius:999px;border:1px solid rgba(207,239,248,.16);color:var(--cy);font:500 12px var(--sans)}
.rv-rate{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.rv-rate button{min-height:56px;border-radius:16px;font:600 14px var(--sans);display:flex;align-items:center;justify-content:center;gap:8px}
.rv-rate .miss{border:1px solid rgba(255,143,163,.45);background:rgba(255,143,163,.1);color:#FFC9D3}
.rv-rate .got{border:1px solid rgba(111,224,180,.45);background:rgba(111,224,180,.1);color:#C8F4E0}
.rv-ringw{position:relative;width:160px;height:160px;margin:14px auto 4px}
.rv-ringw svg{width:100%;height:100%;transform:rotate(-90deg)}
.rv-ringw .c{position:absolute;inset:0;display:grid;place-items:center}
.rv-ringw b{display:block;font:400 48px/1 var(--serif)}
.rv-moves{display:grid;gap:8px;margin-top:16px;text-align:left}
.rv-moves div{display:flex;justify-content:space-between;gap:12px;padding:13px 16px;border-radius:16px;border:1px solid rgba(207,239,248,.09);background:rgba(207,239,248,.03);font-size:13.5px}
.rv-moves span:last-child{font:500 13px var(--mono);color:rgb(var(--t))}
@media(prefers-reduced-motion:reduce){.rv *{animation:none!important;transition:none!important}}
`;
