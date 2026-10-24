import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Question, QuestionStats, OptionKey } from '../types';

interface ExplanationPanelProps {
  question: Question;
  selectedAnswer: OptionKey | null;
  stats: QuestionStats;
}

const KEYS = ['A', 'B', 'C', 'D'] as OptionKey[];

const bold = (str: string): React.ReactNode[] =>
  str.split(/(\*\*.*?\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );

export const ExplanationPanel: React.FC<ExplanationPanelProps> = ({ question, selectedAnswer, stats }) => {
  const isCorrect = selectedAnswer === question.correctAnswer;
  const [open, setOpen] = useState<OptionKey | null>(null);

  // Real aggregate stats exist only once somebody has answered this question.
  const showStats = (stats?.totalAttempts || 0) > 0;

  const sections = question.explanation.split(/(?=##\s)/g).map((sec) => sec.trim()).filter(Boolean);

  const renderBody = (lines: string[]) =>
    lines.map((line, i) => {
      const t = line.trim();
      if (!t) return null;
      if (t.startsWith('* ') || t.startsWith('- ')) {
        return <div key={i} className="ex-li"><i />{<span>{bold(t.substring(2))}</span>}</div>;
      }
      return <p key={i}>{bold(t)}</p>;
    });

  const others = KEYS.filter((k) => k !== question.correctAnswer && Boolean(question.optionExplanations?.[k]));

  return (
    <section className="ex-exp" aria-label="Explanation">
      <style>{EXP_CSS}</style>

      <div className="ex-verdict">
        <h3 className={isCorrect ? 'ok' : 'bad'}>{isCorrect ? 'Correct' : 'Incorrect'}</h3>
        <div className="ex-vs">
          {isCorrect
            ? `Option ${question.correctAnswer} is the correct choice.`
            : `You chose ${selectedAnswer || 'none'}. The correct answer is ${question.correctAnswer}.`}
        </div>
        {showStats && (
          <div className="ex-mono ex-vt">
            {stats.totalAttempts.toLocaleString()} examinees · {stats.distribution[question.correctAnswer] || 0}% chose {question.correctAnswer}
          </div>
        )}
      </div>

      {showStats && (
        <div className="ex-bars" aria-label="How other examinees answered">
          {KEYS.map((k) => {
            const pct = stats.distribution[k] || 0;
            const cls = k === question.correctAnswer ? 'ok' : k === selectedAnswer ? 'bad' : '';
            return (
              <div key={k} className={`ex-bar ${cls}`}>
                <span className="ex-mono">{k}</span>
                <div><i style={{ width: `${pct}%` }} /></div>
                <b>{pct}%</b>
              </div>
            );
          })}
        </div>
      )}

      <div className={`ex-cols ${others.length ? 'two' : ''}`}>
        <div className="ex-why">
          {sections.map((sec, idx) => {
            const lines = sec.split('\n');
            const isHead = lines[0].startsWith('## ');
            return (
              <div className="ex-sec" key={idx}>
                {isHead && <div className="ex-mono ex-h">{lines[0].replace(/^##\s*/, '')}</div>}
                {renderBody(isHead ? lines.slice(1) : lines)}
              </div>
            );
          })}
        </div>

        {others.length > 0 && (
          <div className="ex-oth">
            <div className="ex-mono ex-h am">Why the other options are incorrect</div>
            {others.map((k) => (
              <div key={k} className={`ex-acc ${open === k ? 'open' : ''}`}>
                <button onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k}>
                  <span className="ex-mono">{k}</span>
                  <b>{question.options[k]}</b>
                  <ChevronDown className="w-4 h-4" />
                </button>
                {open === k && <p>{question.optionExplanations![k]}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

const EXP_CSS = `
.ex-exp{margin-top:34px;padding-top:26px;border-top:1px solid rgba(207,239,248,.1);color:#DCE6EF;font-family:'Geist','Inter',system-ui,sans-serif}
.ex-exp .ex-mono{font:500 10.5px 'Geist Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase}
.ex-verdict h3{margin:0;font:400 clamp(38px,5vw,60px)/1 'Instrument Serif',Georgia,serif}
.ex-verdict h3.ok{color:#6FE0B4}.ex-verdict h3.bad{color:#FF8FA3}
.ex-vs{margin-top:8px;font-size:15px;color:#A9B8C8}
.ex-vt{margin-top:8px;color:#93A3B6}
.ex-bars{display:grid;gap:8px;margin-top:20px;max-width:520px}
.ex-bar{display:grid;grid-template-columns:18px 1fr 42px;align-items:center;gap:10px;color:#93A3B6}
.ex-bar>div{height:6px;border-radius:6px;background:rgba(207,239,248,.08);overflow:hidden}
.ex-bar i{display:block;height:100%;border-radius:6px;background:rgba(207,239,248,.35)}
.ex-bar.ok i{background:#6FE0B4}.ex-bar.bad i{background:#FF8FA3}
.ex-bar.ok,.ex-bar.ok b{color:#8FEAC6}.ex-bar.bad,.ex-bar.bad b{color:#FFA9B8}
.ex-bar b{font:500 12px 'Geist Mono',ui-monospace,monospace;text-align:right;font-variant-numeric:tabular-nums}
.ex-cols{display:grid;gap:34px;margin-top:30px}
@media(min-width:1100px){.ex-cols.two{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:48px}}
.ex-h{color:#4FD6EC;margin-bottom:10px}.ex-h.am{color:#E8B66A;margin-bottom:12px}
.ex-sec{margin-bottom:26px}
.ex-sec p{margin:0 0 10px;font-size:calc(16px*var(--fs,1));line-height:1.7;color:#CBD7E3}
.ex-sec strong{color:#EAF1F7;font-weight:600}
.ex-li{display:flex;gap:12px;margin:0 0 9px;font-size:calc(16px*var(--fs,1));line-height:1.65;color:#CBD7E3}
.ex-li i{flex:none;width:6px;height:6px;border-radius:50%;background:#4FD6EC;margin-top:.7em;opacity:.75}
.ex-acc{border:1px solid rgba(207,239,248,.1);border-radius:16px;background:rgba(207,239,248,.025);margin-bottom:8px;overflow:hidden}
.ex-acc button{width:100%;display:flex;align-items:center;gap:12px;padding:13px 14px;background:none;border:0;color:#DCE6EF;text-align:left;cursor:pointer;font-family:inherit}
.ex-acc button .ex-mono{flex:none;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;border:1px solid rgba(207,239,248,.2);color:#93A3B6;letter-spacing:0}
.ex-acc button b{flex:1;min-width:0;font-weight:500;font-size:15px}
.ex-acc button svg{flex:none;color:#93A3B6;transition:transform .25s}.ex-acc.open button svg{transform:rotate(180deg)}
.ex-acc p{margin:0;padding:0 16px 16px 50px;font-size:calc(14.5px*var(--fs,1));line-height:1.65;color:#A9B8C8}
@media(prefers-reduced-motion:reduce){.ex-acc button svg{transition:none}}
`;
