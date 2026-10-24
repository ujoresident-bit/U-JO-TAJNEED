import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Repeat } from 'lucide-react';
import { resolveSession } from '../services/authService';
import { getSubscriptionStatus } from '../services/subscriptionService';
import { getBankPerformance } from '../services/performanceService';
import { startBlock } from '../services/questionBankService';
import { fetchDueReviews } from '../services/reviewService';
import { useBlocksSynced } from './useBlocksSynced';
import { PerfNetwork } from './PerfNetwork';
import { AnimCanvas, HoursBars, SparkLine, drawClock, drawHeat, drawRadar, drawTrend, hourLabel } from './PerfCharts';
import { PV_CSS } from './perfStyles';

interface ProgressViewProps {
  onNavigate: (view: string, params?: any) => void;
}

const BANKS = [
  { id: 'human_medicine', label: 'Human Medicine' },
  { id: 'dentistry', label: 'Dentistry' }
];

const GREEN = '#6FE0B4', AMBER = '#E8B66A', ROSE = '#FF8FA3', DIM = '#93A3B6';
const toneColor = (pct: number) => (pct >= 70 ? GREEN : pct >= 50 ? AMBER : ROSE);
const toneRgb = (pct: number) => (pct >= 70 ? '111,224,180' : pct >= 50 ? '232,182,106' : '255,143,163');

const LEVELS = [
  { name: 'Intern', min: 0 },
  { name: 'Resident', min: 50 },
  { name: 'Specialist', min: 200 },
  { name: 'Consultant', min: 500 },
  { name: 'Professor', min: 1000 }
];

const TIERS = ['Bronze', 'Silver', 'Gold', 'Ice'];
const IC: Record<string, string> = {
  v: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  c: '<circle cx="12" cy="12" r="3"/><circle cx="5" cy="7" r="2"/><circle cx="19" cy="7" r="2"/><circle cx="12" cy="20" r="2"/><path d="M10 11L6 8M14 11l4-3M12 15v3"/>',
  m: '<path d="M7 3c0 6 10 6 10 12s-10 6-10 6M17 3c0 6-10 6-10 12s10 6 10 6M8 8h8M8 16h8"/>',
  s: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  r: '<path d="M3 12a9 9 0 0115-6l3-2v6h-6l2.5-2.5A6 6 0 106 12"/>',
  h: '<path d="M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  b: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0zM17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3"/>',
  f: '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
  k: '<path d="M3 20l6-12 4 7 3-4 5 9z"/>'
};

interface Ach { i: string; n: string; d: string; v: number; t: number[]; u?: string }

/** 30-day double helix. Each rung is a day: colour = accuracy, hollow = no study. */
const DayHelix: React.FC<{ days: { key: string; label: string; total: number; correct: number }[]; sel: number; onPick: (i: number) => void }> = ({ days, sel, onPick }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const pts = useRef<{ x: number; y: number; k: number }[]>([]);
  const draw = () => {
    const cv = ref.current; if (!cv) return;
    const d = Math.min(window.devicePixelRatio || 1, 2), b = cv.getBoundingClientRect(), W = b.width, H = b.height;
    if (!W) return;
    cv.width = W * d; cv.height = H * d;
    const x = cv.getContext('2d'); if (!x) return;
    x.setTransform(d, 0, 0, d, 0, 0);
    const col = (dd: { total: number; correct: number }) => (dd.total ? toneRgb(Math.round((dd.correct / dd.total) * 100)) : null);
    const N = days.length, pad = 12, gap = (W - pad * 2) / (N - 1), R = H * 0.3, rad = Math.max(4, Math.min(9, gap * 0.36)), sp = 0.9;
    const ph = (k: number) => k / 6 * 6.283 + sp;
    for (let pass = 0; pass < 2; pass++) {
      for (let sd = 0; sd < 2; sd++) {
        let pv: { x: number; y: number; z: number } | null = null;
        for (let a = 0; a <= W; a += 3) {
          const q = ph((a - pad) / gap), c = Math.cos(q), z = Math.sin(q) * (sd ? -1 : 1), y = H / 2 + R * c * (sd ? -1 : 1);
          if (pv && ((z + pv.z) / 2 >= 0) === (pass === 1)) {
            const zz = (z + 1) / 2;
            x.strokeStyle = `rgba(${sd ? '180,168,245' : '79,214,236'},${0.16 + 0.6 * zz})`; x.lineWidth = 1 + 1.6 * zz; x.lineCap = 'round';
            x.beginPath(); x.moveTo(pv.x, pv.y); x.lineTo(a, y); x.stroke();
          }
          pv = { x: a, y, z };
        }
      }
      if (pass === 0) for (let k = 0; k < N; k++) {
        const ax = pad + k * gap, c2 = Math.cos(ph(k)), cc = col(days[k]);
        x.strokeStyle = `rgba(${cc || '207,239,248'},${cc ? 0.55 : 0.16})`; x.lineWidth = 1.3;
        x.beginPath(); x.moveTo(ax, H / 2 - R * c2); x.lineTo(ax, H / 2 + R * c2); x.stroke();
      }
    }
    const out: { x: number; y: number; k: number }[] = [];
    for (let k = 0; k < N; k++) {
      const ax = pad + k * gap, cc = col(days[k]), s = sel === k;
      out.push({ x: ax, y: H / 2, k });
      x.fillStyle = cc ? `rgba(${cc},.22)` : 'rgba(11,16,22,.97)'; x.beginPath(); x.arc(ax, H / 2, rad + (s ? 2.5 : 0), 0, 7); x.fill();
      x.lineWidth = s ? 2 : 1.2; x.strokeStyle = s ? '#CFEFF8' : `rgba(${cc || '207,239,248'},${cc ? 0.95 : 0.35})`; x.stroke();
      if (cc) { x.fillStyle = `rgba(${cc},1)`; x.beginPath(); x.arc(ax, H / 2, rad * 0.42, 0, 7); x.fill(); }
    }
    pts.current = out;
  };
  useEffect(() => {
    draw();
    const cv = ref.current; if (!cv) return;
    const ro = new ResizeObserver(draw); ro.observe(cv);
    return () => ro.disconnect();
  });
  const click = (e: React.MouseEvent) => {
    const cv = ref.current; if (!cv) return;
    const b = cv.getBoundingClientRect(), px = e.clientX - b.left, py = e.clientY - b.top;
    let best = -1, bd = 24;
    pts.current.forEach((p) => { const dd = Math.hypot(p.x - px, p.y - py); if (dd < bd) { bd = dd; best = p.k; } });
    if (best >= 0) onPick(best);
  };
  return <canvas ref={ref} onClick={click} role="img" aria-label="Last 30 days of study" style={{ width: '100%', height: 84, display: 'block', cursor: 'pointer' }} />;
};

export const ProgressView: React.FC<ProgressViewProps> = ({ onNavigate }) => {
  const syncTick = useBlocksSynced();
  const session = resolveSession();
  const user = session.user;

  // Same visibility rule as the home page: a subscriber only sees their own bank.
  const visibleBanks = useMemo(() => {
    const active = BANKS.filter((b) => getSubscriptionStatus(user.telegramId, b.id).status === 'ACTIVE');
    return session.isAdmin || active.length === 0 ? BANKS : active;
  }, [user.telegramId, session.isAdmin]);

  const [bankId, setBankId] = useState(visibleBanks[0].id);
  const [dueCount, setDueCount] = useState(0);
  const [starting, setStarting] = useState(false);
  const [sel, setSel] = useState(-1);
  const [dsel, setDsel] = useState(29);
  const [ringOn, setRingOn] = useState(false);

  // All numbers come from the student's own blocks (synced from Supabase into the app).
  const perf = useMemo(() => getBankPerformance(user.telegramId, bankId), [user.telegramId, bankId, syncTick]);
  const hasData = perf.total > 0;
  const bankLabel = BANKS.find((b) => b.id === bankId)?.label || '';

  useEffect(() => {
    fetchDueReviews(bankId).then((r) => setDueCount(r.due.length)).catch(() => setDueCount(0));
  }, [bankId]);

  useEffect(() => { setSel(-1); setDsel(29); }, [bankId]);
  useEffect(() => { const t = requestAnimationFrame(() => requestAnimationFrame(() => setRingOn(true))); return () => cancelAnimationFrame(t); }, []);

  const subjects = perf.subjects;
  const netSubjects = useMemo(
    () => subjects.map((s) => ({ name: s.major, acc: s.total > 0 ? s.pct : null, seen: s.seen || 0 })),
    [subjects]
  );

  // default selection: the weakest subject the student has answered, otherwise the first one
  const defaultSel = useMemo(() => {
    const w = perf.weakest ? subjects.findIndex((s) => s.major === perf.weakest!.major) : -1;
    return w >= 0 ? w : 0;
  }, [perf.weakest, subjects]);
  const cur = sel >= 0 && sel < subjects.length ? sel : defaultSel;
  const cs = subjects[cur];

  const practice = async (major?: string) => {
    setStarting(true);
    try {
      const block = await startBlock(
        user.telegramId,
        { bankId, majors: major ? [major] : [], statusFilter: 'ALL', userId: user.telegramId, includeQBankBasic: true, questionCount: 20 },
        bankId
      );
      onNavigate('question_screen', { blockId: block.id });
    } catch {
      setStarting(false);
      onNavigate(bankId === 'human_medicine' ? 'specialty_hub' : 'bank', { bankId });
    }
  };

  // level
  const levelIdx = LEVELS.reduce((acc, l, i) => (perf.total >= l.min ? i : acc), 0);
  const level = LEVELS[levelIdx], nextLevel = LEVELS[levelIdx + 1];
  const levelPct = nextLevel ? Math.round(((perf.total - level.min) / (nextLevel.min - level.min)) * 100) : 100;

  // headline: last 7 days vs the 7 before
  const trend = useMemo(() => {
    const acc = (slice: typeof perf.days) => {
      const t = slice.reduce((n, d) => n + d.total, 0), c = slice.reduce((n, d) => n + d.correct, 0);
      return t > 0 ? { pct: Math.round((c / t) * 100), total: t } : null;
    };
    const c = acc(perf.days.slice(-7)), p = acc(perf.days.slice(-14, -7));
    return c ? { cur: c.pct, delta: p ? c.pct - p.pct : null } : null;
  }, [perf.days]);

  const headline = () => {
    if (!hasData) return <>Start your first block.</>;
    if (!trend) return <>No practice in the last 7 days.</>;
    if (trend.delta === null) return <>You scored <em>{trend.cur}%</em> this week.</>;
    if (trend.delta > 0) return <>Accuracy is <em>up {trend.delta} point{trend.delta === 1 ? '' : 's'}</em> on last week.</>;
    if (trend.delta < 0) return <>Accuracy is <em style={{ color: ROSE }}>down {-trend.delta} point{trend.delta === -1 ? '' : 's'}</em> on last week.</>;
    return <>Accuracy is <em>steady</em> against last week.</>;
  };

  // tiles
  const weekVals = perf.weeks.filter((w) => w.pct !== null).map((w) => w.pct as number);
  const firstW = perf.weeks.find((w) => w.pct !== null && w.total >= 5), lastW = [...perf.weeks].reverse().find((w) => w.pct !== null && w.total >= 5);
  const weekDelta = firstW && lastW && firstW !== lastW ? (lastW.pct as number) - (firstW.pct as number) : null;
  const hard = perf.byDifficulty.find((d) => d.label === 'Hard');
  const hardAcc = hard && hard.total >= 40 ? hard.pct : 0;

  const achievements: Ach[] = [
    { i: 'v', n: 'Questions solved', d: 'Every answer counts, repeats included.', v: perf.total, t: [50, 250, 500, 1000] },
    { i: 'c', n: 'Coverage', d: 'Distinct questions you have seen, out of the whole bank.', v: perf.coverage.seen, t: [100, 350, 700, 1200], u: ' seen' },
    { i: 'm', n: 'Subject mastery', d: 'Subjects at 80% or more over at least 30 answers.', v: perf.masteredSubjects, t: [1, 3, 6, 9], u: ' subjects' },
    { i: 's', n: 'Streak', d: 'Your longest run of study days.', v: perf.longestStreak, t: [3, 7, 14, 30], u: ' days' },
    { i: 'r', n: 'Recovered', d: 'Missed questions you later answered correctly.', v: perf.recovered.recovered, t: [10, 30, 75, 150] },
    { i: 'h', n: 'Hard-question accuracy', d: 'Percent correct on Hard questions, minimum 40 answered.', v: hardAcc, t: [50, 60, 70, 80], u: '%' },
    { i: 'b', n: 'Block master', d: 'Completed blocks.', v: perf.blocksCompleted, t: [1, 10, 25, 50] },
    { i: 'f', n: 'Perfect block', d: 'Blocks of 10 or more questions answered 100% correct.', v: perf.perfectBlocks, t: [1, 3, 10, 25] },
    { i: 'k', n: 'Comeback', d: 'Best week-over-week accuracy gain.', v: perf.weekGain, t: [5, 10, 15, 20], u: ' pts' }
  ];
  let nextTaken = false;

  const trendDraw = useMemo(() => drawTrend(perf), [perf]);
  const radarDraw = useMemo(() => drawRadar(perf), [perf]);
  const clockDraw = useMemo(() => drawClock(perf), [perf]);
  const heatDraw = useMemo(() => drawHeat(perf), [perf]);

  const dayPick = perf.days[Math.min(dsel, perf.days.length - 1)];
  const dayLabel = dayPick ? new Date(dayPick.key + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

  const ordered = useMemo(
    () => [...subjects].sort((a, b) => (a.total ? a.pct : 200) - (b.total ? b.pct : 200)),
    [subjects]
  );

  const blocks = perf.sessions.slice(0, 8);
  const sparkPts = useMemo(() => {
    const v = blocks.map((b) => b.score ?? 0).reverse();
    if (v.length < 2) return null;
    const mn = Math.max(0, Math.min(...v) - 10), mx = Math.min(100, Math.max(...v) + 5) || 100;
    return v.map((q, i) => [20 + i * 560 / (v.length - 1), 70 - (q - mn) / Math.max(1, mx - mn) * 60]);
  }, [blocks]);
  const sparkPath = sparkPts ? sparkPts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ') : '';

  const arrow = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>;
  const bar = (pct: number, color: string) => <div className="pv-bar"><i style={{ width: Math.max(0, Math.min(100, pct)) + '%', background: color }} /></div>;
  const tri = (label: string, total: number, pct: number) => (
    <div className="pv-r" key={label}>
      <span>{label}</span>
      {bar(total ? pct : 0, total ? toneColor(pct) : DIM)}
      <b>{total ? pct + '%' : '–'}</b>
    </div>
  );

  return (
    <div className="pv-root" style={{ maxWidth: 1120, margin: '0 auto', paddingBottom: 90 }}>
      <style>{PV_CSS}</style>

      <button className="pv-back" onClick={() => onNavigate('back')}><ArrowLeft size={16} /> Back</button>
      <div className="pv-mono" style={{ color: 'var(--cy)' }}>{bankLabel}</div>
      <h1 className="pv-h1">Performance</h1>
      {visibleBanks.length > 1 && (
        <div className="pv-seg" role="group" aria-label="Question bank">
          {visibleBanks.map((b) => (
            <button key={b.id} aria-pressed={bankId === b.id} onClick={() => setBankId(b.id)}>{b.label}</button>
          ))}
        </div>
      )}

      {bankId === 'human_medicine' && dueCount > 0 && (
        <button className="pv-due" onClick={() => onNavigate('review', { bankId })}>
          <Repeat size={20} color={AMBER} />
          <span style={{ flex: 1 }}>
            <b>{dueCount} item{dueCount === 1 ? '' : 's'} due for review today</b>
            <span>Questions and cards you missed are ready to be revised.</span>
          </span>
          <ChevronRight size={16} color={DIM} />
        </button>
      )}

      {!hasData && (
        <div className="pv-empty">
          <h3>No answers yet</h3>
          <p>Finish a block in {bankLabel} and this page fills in with your accuracy, coverage, best hours and weak topics. Everything is measured from your own answers.</p>
          <button className="pv-pri" style={{ maxWidth: 320, margin: '18px auto 0' }} disabled={starting} onClick={() => practice()}>
            <span>Start a block</span><span className="pv-a">{arrow}</span>
          </button>
        </div>
      )}

      {hasData && (
        <>
          <section className="pv-hero">
            <div className="pv-hl">
              <div className="pv-ring">
                <svg viewBox="0 0 200 200">
                  <circle cx="100" cy="100" r="88" fill="none" stroke="rgba(207,239,248,.1)" strokeWidth="10" />
                  <circle cx="100" cy="100" r="88" fill="none" stroke={toneColor(perf.accuracy)} strokeWidth="10" strokeLinecap="round"
                    strokeDasharray="552.9" strokeDashoffset={ringOn ? 552.9 * (1 - perf.accuracy / 100) : 552.9}
                    style={{ filter: 'drop-shadow(0 0 8px rgba(111,224,180,.4))', transition: 'stroke-dashoffset 1.4s cubic-bezier(.16,1,.3,1)' }} />
                </svg>
                <div className="pv-c"><div><b>{perf.accuracy}<sup>%</sup></b><span className="pv-mono" style={{ color: 'var(--dim)' }}>Accuracy</span></div></div>
              </div>
              <h2>{headline()}</h2>
              <p>
                You have seen {perf.coverage.pct}% of the bank ({perf.coverage.seen.toLocaleString()} of {perf.coverage.total.toLocaleString()} questions).
                The network shows where it is strong and where it is still dark.
              </p>
              <div className="pv-lvl">
                <div className="pv-row pv-mono"><span>{level.name}</span><span>{nextLevel ? `${perf.total} / ${nextLevel.min} to ${nextLevel.name}` : `${perf.total} solved`}</span></div>
                <div className="pv-track"><i style={{ width: levelPct + '%' }} /></div>
              </div>

              {cs && (
                <div className="pv-card">
                  <span className="pv-mono" style={{ color: 'var(--cy)' }}>Selected subject</span>
                  <h3>{cs.major}</h3>
                  {cs.total > 0 ? (
                    <>
                      <div className="pv-g">
                        <div><b style={{ color: toneColor(cs.pct) }}>{cs.pct}%</b><span className="pv-mono">Accuracy</span></div>
                        <div><b>{cs.bankTotal ? Math.round(((cs.seen || 0) / cs.bankTotal) * 100) : 0}%</b><span className="pv-mono">Covered</span></div>
                        <div><b>{cs.firstTryPct ?? '–'}{cs.firstTryPct !== null && cs.firstTryPct !== undefined ? '%' : ''}</b><span className="pv-mono">First try</span></div>
                      </div>
                      <p>
                        {cs.seen} of {cs.bankTotal} questions seen.
                        {(() => {
                          const w = (cs.topics || []).filter((t) => t.total >= 3).sort((a, b) => a.pct - b.pct)[0];
                          return w ? <> Weakest topic: <b style={{ color: '#EAF1F7', fontWeight: 500 }}>{w.topic}</b> at {w.pct}%.</> : null;
                        })()}
                      </p>
                    </>
                  ) : (
                    <p>Not started. {cs.bankTotal} questions are waiting in this subject.</p>
                  )}
                  <button className="pv-pri" disabled={starting} onClick={() => practice(cs.major)}>
                    <span>{cs.total > 0 ? 'Practice' : 'Start'} {cs.major}</span><span className="pv-a">{arrow}</span>
                  </button>
                </div>
              )}
            </div>
            <div>
              <div className="pv-net">
                <PerfNetwork subjects={netSubjects} selected={cur} onSelect={setSel} />
              </div>
              <div className="pv-nlg pv-mono"><span>Brighter star = higher accuracy</span><span>Dim = not started</span><span>Tap a star</span></div>
            </div>
          </section>

          <div className="pv-sec">
            <div className="pv-sh"><h3>Precise readings</h3><span className="pv-mono">From your own answers</span></div>
            <div className="pv-rd">
              <div className="pv-t">
                <span className="pv-mono">Coverage</span><b className="pv-n">{perf.coverage.pct}%</b>
                <small>{perf.coverage.seen.toLocaleString()} of {perf.coverage.total.toLocaleString()} distinct questions seen</small>
                <div className="pv-viz">{bar(perf.coverage.pct, 'var(--cy)')}</div>
              </div>
              <div className="pv-t">
                <span className="pv-mono">First-attempt accuracy</span><b className="pv-n">{perf.firstAttempt ? perf.firstAttempt.pct + '%' : '–'}</b>
                <small>{perf.firstAttempt
                  ? `Before any repeat. Overall is ${perf.accuracy}%${perf.accuracy > perf.firstAttempt.pct ? ', so repeats help.' : '.'}`
                  : 'Needs a few answers.'}</small>
                <div className="pv-viz"><SparkLine vals={weekVals} color="#4FD6EC" /></div>
              </div>
              <div className="pv-t">
                <span className="pv-mono">By difficulty</span>
                <div className="pv-tri pv-viz" style={{ marginTop: 12, paddingTop: 0 }}>{perf.byDifficulty.map((d) => tri(d.label, d.total, d.pct))}</div>
                <small style={{ marginTop: 10 }}>{perf.byDifficulty.map((d) => d.total).join(' / ')} answers (Easy / Medium / Hard).</small>
              </div>
              <div className="pv-t">
                <span className="pv-mono">By exam</span>
                <div className="pv-tri pv-viz" style={{ marginTop: 12, paddingTop: 0 }}>
                  {perf.byExam.length ? perf.byExam.map((d) => tri(d.label, d.total, d.pct)) : <small>No exam-tagged answers yet.</small>}
                </div>
                {perf.byExam.length > 0 && <small style={{ marginTop: 10 }}>{perf.byExam.map((d) => d.total).join(' and ')} answers.</small>}
              </div>
              <div className="pv-t">
                <span className="pv-mono">Recovered</span><b className="pv-n">{perf.recovered.recovered}</b>
                <small>Missed questions you later answered correctly</small>
                <div className="pv-viz">{bar(perf.recovered.missed ? (perf.recovered.recovered / perf.recovered.missed) * 100 : 0, 'var(--vi)')}
                  <small style={{ marginTop: 6 }}>{perf.recovered.recovered} of {perf.recovered.missed} missed so far</small></div>
              </div>
              <div className="pv-t">
                <span className="pv-mono">Best time of day</span><b className="pv-n">{perf.peak ? hourLabel(perf.peak.hour) : '–'}</b>
                <small>{perf.peak
                  ? `${perf.peak.pct}% correct between ${hourLabel((perf.peak.hour + 23) % 24)} and ${hourLabel((perf.peak.hour + 2) % 24)}`
                  : 'Needs 20 answers to find your best hour.'}</small>
                <div className="pv-viz"><HoursBars hours={perf.hours} peak={perf.peak ? perf.peak.hour : null} /></div>
              </div>
              <div className="pv-t">
                <span className="pv-mono">Longest streak</span><b className="pv-n" style={{ color: 'var(--am)' }}>{perf.longestStreak}</b>
                <small>day{perf.longestStreak === 1 ? '' : 's'}. Current streak is {perf.streak}.</small>
                <div className="pv-viz">{bar(perf.longestStreak ? (perf.streak / perf.longestStreak) * 100 : 0, 'var(--am)')}</div>
              </div>
              <div className="pv-t">
                <span className="pv-mono">Last 8 weeks</span><b className="pv-n">{weekDelta === null ? '–' : (weekDelta > 0 ? '+' : '') + weekDelta}</b>
                <small>{weekDelta === null ? 'Needs two weeks with 5+ answers.' : `points since ${firstW!.label}`}</small>
                <div className="pv-viz"><SparkLine vals={weekVals} color="#6FE0B4" /></div>
              </div>
            </div>
          </div>

          <div className="pv-sec">
            <div className="pv-sh"><h3>Live charts</h3><span className="pv-mono">Tap a chart to replay it</span></div>
            <div className="pv-cg">
              <div className="pv-ch pv-big"><div className="pv-mono pv-ct">Accuracy by week <span>Bars are questions per week</span></div><AnimCanvas draw={trendDraw} height={230} label="Accuracy by week" /></div>
              <div className="pv-ch"><div className="pv-mono pv-ct">Subject radar <span>Solid = accuracy · dashed = covered</span></div><AnimCanvas draw={radarDraw} height={300} label="Subject radar" /></div>
              <div className="pv-ch"><div className="pv-mono pv-ct">When you study <span>Questions by hour</span></div><AnimCanvas draw={clockDraw} height={300} label="Questions by hour" /></div>
              <div className="pv-ch pv-big"><div className="pv-mono pv-ct">Last 12 weeks <span>Questions per day</span></div><AnimCanvas draw={heatDraw} height={230} label="Last 12 weeks" /></div>
            </div>
          </div>

          <div className="pv-sec">
            <div className="pv-sh"><h3>Last 30 days</h3><span className="pv-mono">Tap a day</span></div>
            <div className="pv-map">
              <DayHelix days={perf.days} sel={dsel} onPick={setDsel} />
              <div className="pv-legend pv-mono">
                <span><b style={{ background: 'var(--gr)' }} />70%+</span><span><b style={{ background: 'var(--am)' }} />50–69%</span>
                <span><b style={{ background: 'var(--rose)' }} />Under 50%</span><span><b style={{ border: '1px solid var(--dim)' }} />No study</span>
              </div>
              <div className="pv-pick">
                {dayPick && (dayPick.total
                  ? <><span className="pv-d">{dayLabel}</span><span>{dayPick.total} questions</span><span>{Math.round((dayPick.correct / dayPick.total) * 100)}% correct</span></>
                  : <><span className="pv-d">{dayLabel}</span><span>No questions this day</span></>)}
              </div>
            </div>
          </div>

          <div className="pv-sec pv-two">
            <div>
              <div className="pv-sh"><h3>Fix these topics</h3><span className="pv-mono">Weakest topics</span></div>
              <div className="pv-fix">
                {perf.weakTopics.length === 0 && <small style={{ color: 'var(--dim)' }}>Topics appear here once you have answered 3 questions in them.</small>}
                {perf.weakTopics.map((t) => (
                  <button key={t.major + t.topic} className="pv-fx" disabled={starting} onClick={() => practice(t.major)}>
                    <div><b>{t.topic}</b><small>{t.major}</small></div>
                    <span className="pv-p" style={{ color: toneColor(t.pct) }}>{t.pct}%</span>
                    {bar(t.pct, toneColor(t.pct))}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="pv-sh"><h3>Subjects</h3><span className="pv-mono">Accuracy · covered</span></div>
              <div>
                {ordered.map((s) => {
                  const col = s.total ? toneColor(s.pct) : DIM;
                  return (
                    <div className="pv-sr" key={s.major}>
                      <div>{s.major}<small>{s.seen} of {s.bankTotal} seen</small></div>
                      {bar(s.total ? s.pct : 0, col)}
                      <b style={{ color: col }}>{s.total ? s.pct + '%' : 'Not started'}</b>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="pv-sec">
            <div className="pv-sh"><h3>Achievements</h3><span className="pv-mono">Each one has tiers</span></div>
            <div className="pv-ach">
              {achievements.map((a) => {
                let ti = 0; while (ti < 4 && a.v >= a.t[ti]) ti++;
                const done = ti === 4, nxt = done ? a.t[3] : a.t[ti], prev = ti ? a.t[ti - 1] : 0;
                const pct = done ? 100 : Math.round(((a.v - prev) / (nxt - prev)) * 100);
                const isNext = !done && pct >= 70 && !nextTaken; if (isNext) nextTaken = true;
                const col = ti === 0 ? DIM : ti === 1 ? '#B4A8F5' : ti === 2 ? AMBER : '#4FD6EC', C = 2 * Math.PI * 24, u = a.v === 1 && a.u && a.u.endsWith('s') ? a.u.slice(0, -1) : a.u || '';
                return (
                  <div key={a.n} className={'pv-a1' + (isNext ? ' pv-next' : '') + (ti === 0 && pct < 8 ? ' pv-lock' : '')}>
                    <div className="pv-top">
                      <div className="pv-med">
                        <svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="24" fill="none" stroke="rgba(207,239,248,.1)" strokeWidth="4" />
                          <circle cx="28" cy="28" r="24" fill="none" stroke={col} strokeWidth="4" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} /></svg>
                        <div className="pv-i" style={{ color: col }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: IC[a.i] }} />
                        </div>
                      </div>
                      <div><h4>{a.n}</h4><div className="pv-tier pv-mono">{ti ? TIERS[ti - 1] + ' unlocked' : 'Locked'}</div></div>
                    </div>
                    <p>{a.d}</p>
                    <div className="pv-pips">{[0, 1, 2, 3].map((k) => <i key={k} style={k < ti ? { background: col } : undefined} />)}</div>
                    <div className="pv-pr pv-mono"><span><b>{a.v}{u}</b></span><span>{done ? 'All tiers done' : `Next ${TIERS[ti]} at ${nxt}${u}`}</span></div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pv-sec">
            <div className="pv-sh"><h3>Completed blocks</h3><span className="pv-mono">Tap to review</span></div>
            {blocks.length === 0 && <small style={{ color: 'var(--dim)' }}>Finish a block and it shows up here.</small>}
            {sparkPts && (
              <svg className="pv-spark" viewBox="0 0 600 80" preserveAspectRatio="none">
                <defs><linearGradient id="pvsg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#4FD6EC" stopOpacity=".25" /><stop offset="1" stopColor="#4FD6EC" stopOpacity="0" /></linearGradient></defs>
                <path d={sparkPath + ' L580 80 L20 80Z'} fill="url(#pvsg)" />
                <path d={sparkPath} fill="none" stroke="#4FD6EC" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                {sparkPts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="#4FD6EC" vectorEffect="non-scaling-stroke" />)}
              </svg>
            )}
            <div className="pv-blk">
              {blocks.map((b) => {
                const sc = b.score ?? 0;
                return (
                  <button key={b.id} className="pv-bk" onClick={() => onNavigate('question_screen', { blockId: b.id, reviewMode: 'all' })}>
                    <span className="pv-sc" style={{ color: toneColor(sc) }}>{sc}%</span>
                    <span><b>{b.questionIds.length} questions</b><span className="pv-m">{new Date(b.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></span>
                    <span className="pv-go"><ChevronRight size={18} /></span>
                  </button>
                );
              })}
            </div>
          </div>

          <p className="pv-note">
            Every reading is computed from your own answers, which are saved to your account and synced across devices. Subjects with fewer than the minimum answers show a dash instead of a guess. Response time per question is not recorded, so nothing here measures speed.
          </p>
        </>
      )}
    </div>
  );
};
