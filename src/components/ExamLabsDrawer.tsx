import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { LAB_GROUPS, LAB_VALUES_ARE_SAMPLE } from '../data/labValues';

export const ExamLabsDrawer: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [q, setQ] = useState('');
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open && window.innerWidth > 620) { const t = setTimeout(() => inp.current?.focus(), 300); return () => clearTimeout(t); }
  }, [open]);
  const needle = q.trim().toLowerCase();
  const groups = LAB_GROUPS
    .map((g) => ({ ...g, rows: g.rows.filter((r) => r.name.toLowerCase().includes(needle)) }))
    .filter((g) => g.rows.length);

  return (
    <>
      <div className={`ex-scrim ${open ? 'on' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`ex-drawer ${open ? 'on' : ''}`} aria-label="Lab values" aria-hidden={!open}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="ex-mono text-[#4FD6EC]">Reference</div>
            <h2 className="ex-serif text-[30px] leading-none mt-1">Lab values</h2>
          </div>
          <button onClick={onClose} className="ex-x" aria-label="Close lab values"><X className="w-[18px] h-[18px]" /></button>
        </div>
        {LAB_VALUES_ARE_SAMPLE && (
          <div className="ex-sample">Sample layout. Final values come from the reference source approved by the admin.</div>
        )}
        <input ref={inp} className="ex-sin" placeholder="Search a test" aria-label="Search lab values"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="ex-labs">
          {groups.length === 0 && <div className="ex-lr"><b>No tests match.</b></div>}
          {groups.map((g) => (
            <div key={g.title}>
              <h4>{g.title}</h4>
              {g.rows.map((r) => (
                <div className="ex-lr" key={r.name}><b>{r.name}</b><span>{r.range}</span><small>{r.unit}</small></div>
              ))}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
};
