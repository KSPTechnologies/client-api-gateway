import { useState, useEffect, Fragment } from 'react';

interface Row { u: string; c: string; jt: string; tt: string; j: string; p: number; e: number; pk: string; f: number; }

interface ProdData {
  environment: string;
  days: number;
  taskRowsInWindow: number;
  taskRowsLoaded: number;
  truncated: boolean;
  rows: Row[];
  error?: string;
}

type Slice = 'user' | 'client' | 'jobtype' | 'tasktype';

const GAP_CAP_MS = 5 * 60 * 1000; // active-time gap cap: pauses over 5 min don't count

// Active (gap-capped) milliseconds for ONE user's finish timestamps.
function activeMs(finishes: number[]): number {
  if (finishes.length === 0) return 0;
  const sorted = [...finishes].sort((a, b) => a - b);
  let ms = 60_000; // credit the first task a minute
  for (let i = 1; i < sorted.length; i++) ms += Math.min(sorted[i] - sorted[i - 1], GAP_CAP_MS);
  return ms;
}

// Sum of per-user active time within a subset of rows (active time is only
// meaningful per person).
function subsetActiveHours(rows: Row[]): number {
  const byUser = new Map<string, number[]>();
  for (const r of rows) {
    if (!byUser.has(r.u)) byUser.set(r.u, []);
    byUser.get(r.u)!.push(r.f);
  }
  let ms = 0;
  for (const finishes of byUser.values()) ms += activeMs(finishes);
  return ms / 3_600_000;
}

interface Agg { key: string; tasks: number; pu: number; eaches: number; hours: number; puph: number; users: number; clients: number; }

function aggregate(rows: Row[], keyOf: (r: Row) => string): Agg[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const out: Agg[] = [];
  for (const [key, rs] of groups) {
    const pu = rs.reduce((s, r) => s + r.p, 0);
    const eaches = rs.reduce((s, r) => s + r.e, 0);
    const hours = subsetActiveHours(rs);
    out.push({
      key, tasks: rs.length, pu, eaches,
      hours: Math.round(hours * 100) / 100,
      puph: hours > 0 ? Math.round((pu / hours) * 10) / 10 : 0,
      users: new Set(rs.map((r) => r.u)).size,
      clients: new Set(rs.map((r) => r.c)).size,
    });
  }
  return out.sort((a, b) => b.pu - a.pu);
}

export default function Productivity() {
  const [data, setData] = useState<ProdData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(1);
  const [envSel, setEnvSel] = useState<'production' | 'sandbox'>('production');
  const [slice, setSlice] = useState<Slice>('user');
  const [taskType, setTaskType] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch(`/api/productivity?env=${envSel}&days=${days}`)
      .then((r) => r.json())
      .then((d) => { setData(d as ProdData); setLoading(false); });
  };

  useEffect(load, [days, envSel]);

  const allRows = data?.rows || [];
  const taskTypes = [...new Set(allRows.map((r) => r.tt))].sort();
  const rows = taskType ? allRows.filter((r) => r.tt === taskType) : allRows;

  const keyOf = (r: Row) =>
    slice === 'user' ? r.u : slice === 'client' ? r.c : slice === 'tasktype' ? r.tt : r.jt;
  const aggs = aggregate(rows, keyOf);
  const totals = {
    tasks: rows.length,
    pu: rows.reduce((s, r) => s + r.p, 0),
    eaches: rows.reduce((s, r) => s + r.e, 0),
    hours: Math.round(subsetActiveHours(rows) * 100) / 100,
  };

  // Drill-down: within the open group, break down by the complementary dims
  // (incl. job-type-inside-client, and pack type to show case vs each work).
  const detailOf = (key: string) => {
    const subset = rows.filter((r) => keyOf(r) === key);
    return {
      byTaskType: slice === 'tasktype' ? aggregate(subset, (r) => r.c) : aggregate(subset, (r) => r.tt),
      byOther: slice === 'user' ? aggregate(subset, (r) => r.c) : aggregate(subset, (r) => r.u),
      byJobType: slice === 'jobtype' ? aggregate(subset, (r) => r.c) : aggregate(subset, (r) => r.jt),
      byPackType: aggregate(subset, (r) => r.pk),
    };
  };

  const sliceLabel = slice === 'user' ? 'User' : slice === 'client' ? 'Client' : slice === 'tasktype' ? 'Task Type' : 'Job Type';
  const taskTypeSubLabel = slice === 'tasktype' ? 'By Client' : 'By Task Type';
  const otherLabel = slice === 'user' ? 'By Client' : 'By User';
  const jobTypeLabel = slice === 'jobtype' ? 'By Client' : 'By Job Type';

  return (
    <div>
      <div className="page-header"><h1>Productivity</h1></div>
      <p style={{ fontSize: 13, color: '#888', marginTop: -8, marginBottom: 16 }}>
        Completed warehouse tasks from Logiwa, sliced by user, client, job type, or task type.
        <b> Pickable Units (PU)</b> = what was physically handled — a case pick counts once, not
        its inner quantity (shown separately as Eaches). <b>Hours</b> are gap-capped active time
        (pauses over 5 minutes between completions don't count), so <b>PU/Hr</b> approximates
        working rate, not wall-clock.
      </p>

      <div className="toolbar">
        <div className="filters" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select value={slice} onChange={(e) => { setSlice(e.target.value as Slice); setOpen(null); }}>
            <option value="user">By User</option>
            <option value="client">By Client</option>
            <option value="jobtype">By Job Type</option>
            <option value="tasktype">By Task Type</option>
          </select>
          <select value={taskType} onChange={(e) => { setTaskType(e.target.value); setOpen(null); }}>
            <option value="">All task types</option>
            {taskTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={days} onChange={(e) => setDays(parseInt(e.target.value))}>
            <option value={1}>last 1 day</option>
            <option value={2}>last 2 days</option>
            <option value={3}>last 3 days</option>
            <option value={7}>last 7 days</option>
          </select>
          <select value={envSel} onChange={(e) => setEnvSel(e.target.value as 'production' | 'sandbox')}>
            <option value="production">production</option>
            <option value="sandbox">sandbox</option>
          </select>
          <button className="btn btn-sm" onClick={load}>Refresh</button>
        </div>
        {data && !data.error && (
          <div style={{ fontSize: 12, color: '#888' }}>
            {totals.pu} pickable units ({totals.eaches} eaches) · {totals.tasks} tasks · {totals.hours} active hrs
            {data.truncated ? ` — ${data.taskRowsLoaded} of ${data.taskRowsInWindow} rows loaded, narrow the window` : ''}
          </div>
        )}
      </div>

      {loading ? (
        <div className="empty-state"><p>Loading from Logiwa…</p></div>
      ) : data?.error ? (
        <div className="empty-state"><p style={{ color: '#c62828' }}>{data.error}</p></div>
      ) : aggs.length === 0 ? (
        <div className="empty-state"><p>No completed tasks in the selected window.</p></div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>{sliceLabel}</th>
                <th>Pickable Units</th>
                <th>Eaches</th>
                <th>Tasks</th>
                <th>Active Hrs</th>
                <th>PU/Hr</th>
                {slice !== 'user' && <th>Users</th>}
                {slice === 'user' && <th>Clients</th>}
              </tr>
            </thead>
            <tbody>
              {aggs.map((a) => (
                <Fragment key={a.key}>
                  <tr onClick={() => setOpen(open === a.key ? null : a.key)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 600 }}>{a.key}</td>
                    <td>{a.pu}</td>
                    <td style={{ color: '#888' }}>{a.eaches}</td>
                    <td>{a.tasks}</td>
                    <td>{a.hours}</td>
                    <td style={{ fontWeight: 700, color: '#1565c0' }}>{a.puph || '—'}</td>
                    {slice !== 'user' && <td>{a.users}</td>}
                    {slice === 'user' && <td>{a.clients}</td>}
                  </tr>
                  {open === a.key && (() => {
                    const det = detailOf(a.key);
                    const sub = (title: string, list: Agg[]) => (
                      <div style={{ minWidth: 280 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{title}</div>
                        <table style={{ fontSize: 12, width: '100%' }}>
                          <thead><tr><th></th><th>PU</th><th>Eaches</th><th>Tasks</th><th>Hrs</th><th>PU/Hr</th></tr></thead>
                          <tbody>
                            {list.map((s) => (
                              <tr key={s.key}>
                                <td>{s.key}</td><td>{s.pu}</td><td style={{ color: '#888' }}>{s.eaches}</td><td>{s.tasks}</td><td>{s.hours}</td><td>{s.puph || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                    return (
                      <tr>
                        <td colSpan={8} style={{ background: '#fafafa', padding: '12px 20px' }}>
                          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
                            {sub(taskTypeSubLabel, det.byTaskType)}
                            {sub(otherLabel, det.byOther)}
                            {sub(jobTypeLabel, det.byJobType)}
                            {sub('By Pack Type (case vs each)', det.byPackType)}
                          </div>
                        </td>
                      </tr>
                    );
                  })()}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
