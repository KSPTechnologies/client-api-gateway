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

interface MonthRow { m: string; u: string; c: string; jt: string; tt: string; pu: number; e: number; t: number; ms: number; }

interface MonthlyData {
  environment: string;
  months: number;
  range: { from: string; to: string } | null;
  coverage: { first_day: string | null; last_day: string | null; days: number } | null;
  rows: MonthRow[];
  error?: string;
}

const csvEsc = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default function Productivity() {
  const [data, setData] = useState<ProdData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(1);
  const [envSel, setEnvSel] = useState<'production' | 'sandbox'>('production');
  const [slice, setSlice] = useState<Slice>('user');
  const [taskType, setTaskType] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<'live' | 'monthly'>('live');
  const [monthsBack, setMonthsBack] = useState(6); // 0 = custom date range
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [monthly, setMonthly] = useState<MonthlyData | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  const customRange = monthsBack === 0;
  const loadMonthly = () => {
    if (customRange && !(fromDate && toDate && fromDate <= toDate)) return; // wait for a complete range
    setMonthlyLoading(true);
    const q = customRange ? `from=${fromDate}&to=${toDate}` : `months=${monthsBack}`;
    fetch(`/api/productivity-monthly?env=${envSel}&${q}`)
      .then((r) => r.json())
      .then((d) => { setMonthly(d as MonthlyData); setMonthlyLoading(false); });
  };

  useEffect(() => { if (view === 'monthly') loadMonthly(); }, [view, monthsBack, envSel, fromDate, toDate]);

  // Full-grain CSV of what the monthly view has loaded (billing pivots from
  // this): month, user, client, job type, task type, PU, eaches, tasks,
  // hours, PU/hr. Respects the task-type filter; slice is display-only.
  const exportMonthlyCsv = () => {
    if (!monthly || monthly.error) return;
    const rows = (taskType ? monthly.rows.filter((r) => r.tt === taskType) : monthly.rows)
      .slice()
      .sort((a, b) => a.m.localeCompare(b.m) || a.c.localeCompare(b.c) || a.u.localeCompare(b.u) || a.jt.localeCompare(b.jt) || a.tt.localeCompare(b.tt));
    const lines = ['month,user,client,job_type,task_type,pickable_units,eaches,tasks,active_hours,pu_per_hr'];
    for (const r of rows) {
      const hrs = r.ms / 3_600_000;
      lines.push([
        r.m, r.u, r.c, r.jt, r.tt,
        Math.round(r.pu * 100) / 100,
        Math.round(r.e * 100) / 100,
        r.t,
        Math.round(hrs * 100) / 100,
        hrs > 0 ? Math.round((r.pu / hrs) * 10) / 10 : '',
      ].map(csvEsc).join(','));
    }
    const label = monthly.range
      ? `${monthly.range.from}_${monthly.range.to}`
      : rows.length ? `${rows[0].m}_${rows[rows.length - 1].m}` : 'empty';
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `productivity_${monthly.environment}_${label}${taskType ? `_${taskType.replace(/[^\w-]+/g, '-')}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

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
          <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #ccc' }}>
            <button className="btn btn-sm" style={{ border: 'none', borderRadius: 0, background: view === 'live' ? '#1565c0' : '#fff', color: view === 'live' ? '#fff' : '#333' }} onClick={() => setView('live')}>Live window</button>
            <button className="btn btn-sm" style={{ border: 'none', borderRadius: 0, background: view === 'monthly' ? '#1565c0' : '#fff', color: view === 'monthly' ? '#fff' : '#333' }} onClick={() => setView('monthly')}>Month to month</button>
          </div>
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
          {view === 'live' ? (
            <select value={days} onChange={(e) => setDays(parseInt(e.target.value))}>
              <option value={1}>last 1 day</option>
              <option value={2}>last 2 days</option>
              <option value={3}>last 3 days</option>
              <option value={7}>last 7 days</option>
            </select>
          ) : (
            <>
              <select value={monthsBack} onChange={(e) => setMonthsBack(parseInt(e.target.value))}>
                <option value={3}>last 3 months</option>
                <option value={6}>last 6 months</option>
                <option value={12}>last 12 months</option>
                <option value={0}>custom date range…</option>
              </select>
              {customRange && (
                <>
                  <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                  <span style={{ color: '#888' }}>→</span>
                  <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                </>
              )}
            </>
          )}
          <select value={envSel} onChange={(e) => setEnvSel(e.target.value as 'production' | 'sandbox')}>
            <option value="production">production</option>
            <option value="sandbox">sandbox</option>
          </select>
          <button className="btn btn-sm" onClick={view === 'monthly' ? loadMonthly : load}>Refresh</button>
          {view === 'monthly' && (
            <button className="btn btn-sm" onClick={exportMonthlyCsv} disabled={monthlyLoading || !monthly || !!monthly.error}>
              Export CSV
            </button>
          )}
        </div>
        {data && !data.error && (
          <div style={{ fontSize: 12, color: '#888' }}>
            {totals.pu} pickable units ({totals.eaches} eaches) · {totals.tasks} tasks · {totals.hours} active hrs
            {data.truncated ? ` — ${data.taskRowsLoaded} of ${data.taskRowsInWindow} rows loaded, narrow the window` : ''}
          </div>
        )}
      </div>

      {view === 'monthly' ? (() => {
        if (customRange && !(fromDate && toDate && fromDate <= toDate)) {
          return <div className="empty-state"><p>Pick a from and to date to load the range.</p></div>;
        }
        if (monthlyLoading || !monthly) return <div className="empty-state"><p>Loading monthly history…</p></div>;
        if (monthly.error) return <div className="empty-state"><p style={{ color: '#c62828' }}>{monthly.error}</p></div>;
        const mrows = taskType ? monthly.rows.filter((r) => r.tt === taskType) : monthly.rows;
        const keyOfM = (r: MonthRow) => slice === 'user' ? r.u : slice === 'client' ? r.c : slice === 'tasktype' ? r.tt : r.jt;
        const monthsList = [...new Set(mrows.map((r) => r.m))].sort();
        if (monthsList.length === 0) return <div className="empty-state"><p>No history yet — the nightly aggregation and backfill fill this in.</p></div>;
        const byKey = new Map<string, Map<string, { pu: number; ms: number; tasks: number }>>();
        for (const r of mrows) {
          const k = keyOfM(r);
          if (!byKey.has(k)) byKey.set(k, new Map());
          const mm = byKey.get(k)!;
          const cell = mm.get(r.m) || { pu: 0, ms: 0, tasks: 0 };
          cell.pu += r.pu; cell.ms += r.ms; cell.tasks += r.t;
          mm.set(r.m, cell);
        }
        const latest = monthsList[monthsList.length - 1];
        const prior = monthsList[monthsList.length - 2];
        const rate = (c?: { pu: number; ms: number }) => (c && c.ms > 0 ? c.pu / (c.ms / 3_600_000) : 0);
        const keys = [...byKey.keys()].sort((a, b) => (byKey.get(b)!.get(latest)?.pu || 0) - (byKey.get(a)!.get(latest)?.pu || 0));
        return (
          <div className="table-container">
            <div style={{ fontSize: 12, color: '#888', margin: '4px 0 8px' }}>
              {monthly.range
                ? <>Range: <b>{monthly.range.from} → {monthly.range.to}</b> (months spanning the range show only the days inside it). </>
                : <>History: {monthly.coverage?.first_day || '—'} → {monthly.coverage?.last_day || '—'} ({monthly.coverage?.days || 0} days). </>}
              Cells show <b>PU</b> and <b>PU/Hr</b>; Δ compares {prior || '—'} → {latest}.
            </div>
            <table>
              <thead>
                <tr>
                  <th>{sliceLabel}</th>
                  {monthsList.map((m) => <th key={m}>{m}</th>)}
                  <th>Δ PU/Hr</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const mm = byKey.get(k)!;
                  const rLatest = rate(mm.get(latest));
                  const rPrior = prior ? rate(mm.get(prior)) : 0;
                  const delta = rPrior > 0 && rLatest > 0 ? ((rLatest - rPrior) / rPrior) * 100 : null;
                  return (
                    <tr key={k}>
                      <td style={{ fontWeight: 600 }}>{k}</td>
                      {monthsList.map((m) => {
                        const c = mm.get(m);
                        return (
                          <td key={m} style={{ whiteSpace: 'nowrap' }}>
                            {c ? (<>
                              {Math.round(c.pu)}<span style={{ color: '#888' }}> PU</span>{' '}
                              <b style={{ color: '#1565c0' }}>{rate(c) ? (Math.round(rate(c) * 10) / 10) : '—'}</b><span style={{ color: '#888', fontSize: 11 }}>/hr</span>
                            </>) : <span style={{ color: '#ccc' }}>—</span>}
                          </td>
                        );
                      })}
                      <td style={{ fontWeight: 700, color: delta === null ? '#888' : delta >= 0 ? '#2e7d32' : '#c62828' }}>
                        {delta === null ? '—' : `${delta >= 0 ? '+' : ''}${Math.round(delta)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })() : loading ? (
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
                  {open === a.key && slice === 'client' && (() => {
                    // Client drill-down: NESTED job types -> users, so you can
                    // see which job type works best for this client and who
                    // ran it at what rate.
                    const subset = rows.filter((r) => r.c === a.key);
                    const jobTypes = aggregate(subset, (r) => r.jt);
                    const det = detailOf(a.key);
                    const small = (title: string, list: Agg[]) => (
                      <div style={{ minWidth: 240 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{title}</div>
                        <table style={{ fontSize: 12, width: '100%' }}>
                          <thead><tr><th></th><th>PU</th><th>Tasks</th><th>Hrs</th><th>PU/Hr</th></tr></thead>
                          <tbody>{list.map((s) => (
                            <tr key={s.key}><td>{s.key}</td><td>{s.pu}</td><td>{s.tasks}</td><td>{s.hours}</td><td>{s.puph || '—'}</td></tr>
                          ))}</tbody>
                        </table>
                      </div>
                    );
                    return (
                      <tr>
                        <td colSpan={8} style={{ background: '#fafafa', padding: '12px 20px' }}>
                          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Job types for {a.key} — with each person's performance</div>
                          <table style={{ fontSize: 12, width: '100%', marginBottom: 14 }}>
                            <thead><tr><th>Job Type / User</th><th>PU</th><th>Eaches</th><th>Tasks</th><th>Hrs</th><th>PU/Hr</th></tr></thead>
                            <tbody>
                              {jobTypes.map((jt) => (
                                <Fragment key={jt.key}>
                                  <tr style={{ background: '#eef3f8', fontWeight: 700 }}>
                                    <td>{jt.key}</td><td>{jt.pu}</td><td style={{ color: '#888' }}>{jt.eaches}</td><td>{jt.tasks}</td><td>{jt.hours}</td><td style={{ color: '#1565c0' }}>{jt.puph || '—'}</td>
                                  </tr>
                                  {aggregate(subset.filter((r) => r.jt === jt.key), (r) => r.u).map((u) => (
                                    <tr key={jt.key + u.key}>
                                      <td style={{ paddingLeft: 24, color: '#444' }}>{u.key}</td>
                                      <td>{u.pu}</td><td style={{ color: '#888' }}>{u.eaches}</td><td>{u.tasks}</td><td>{u.hours}</td><td>{u.puph || '—'}</td>
                                    </tr>
                                  ))}
                                </Fragment>
                              ))}
                            </tbody>
                          </table>
                          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
                            {small('By Task Type', det.byTaskType)}
                            {small('By Pack Type (case vs each)', det.byPackType)}
                          </div>
                        </td>
                      </tr>
                    );
                  })()}
                  {open === a.key && slice !== 'client' && (() => {
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
