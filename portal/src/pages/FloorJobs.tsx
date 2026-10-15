import { useState, useEffect, Fragment } from 'react';
import { formatDate } from '../utils';

interface OrderRef { code: string; uuid: string | null; }

interface Job {
  jobCode: string;
  jobStatus: string;
  client: string;
  pending: number;
  completed: number;
  otherStatus: Record<string, number>;
  taskTypes: Record<string, number>;
  progress: Record<string, { pending: number; completed: number; other: number }>;
  orders: OrderRef[];
  assignees: string[];
  earliestStart: string | null;
  waves: string[];
}

interface Category {
  jobType: string;
  jobCount: number;
  pendingTasks: number;
  completedTasks: number;
  pendingJobs: number;
  jobs: Job[];
}

interface FloorData {
  environment: string;
  days: number;
  taskRowsInWindow: number;
  taskRowsLoaded: number;
  truncated: boolean;
  categories: Category[];
  error?: string;
}

export default function FloorJobs() {
  const [data, setData] = useState<FloorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(2);
  const [envSel, setEnvSel] = useState<'production' | 'sandbox'>('production');
  const [openOnly, setOpenOnly] = useState(true);
  const [openType, setOpenType] = useState<string | null>(null);
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [jobLookup, setJobLookup] = useState(''); // active direct Logiwa lookup
  const [copied, setCopied] = useState('');
  const [orderStatuses, setOrderStatuses] = useState<Record<string, string>>({});

  const loadOrderStatuses = (j: Job) => {
    const uuids = j.orders.map((o) => o.uuid).filter((u): u is string => !!u && !orderStatuses[u]);
    if (uuids.length === 0) return;
    fetch(`/api/floor-job-orders?env=${envSel}&uuids=${uuids.slice(0, 15).join(',')}`)
      .then((r) => r.json())
      .then((d) => setOrderStatuses((prev) => ({ ...prev, ...((d as { statuses?: Record<string, string> }).statuses || {}) })));
  };

  const load = (direct?: string) => {
    setLoading(true);
    const params = new URLSearchParams({ env: envSel, days: String(days) });
    if (direct) params.set('jobCode', direct);
    fetch(`/api/floor-jobs?${params}`)
      .then((r) => r.json())
      .then((d) => { setData(d as FloorData); setLoading(false); });
  };

  useEffect(() => { setJobLookup(''); load(); }, [days, envSel]);

  const findInLogiwa = () => {
    const code = search.trim();
    if (!code) return;
    setJobLookup(code);
    setOpenOnly(false);
    load(code);
  };

  const clearLookup = () => { setJobLookup(''); setSearch(''); load(); };

  const copyVal = async (val: string, e?: React.MouseEvent) => {
    e?.stopPropagation(); // don't toggle row expansion when copying
    try { await navigator.clipboard.writeText(val); setCopied(val); setTimeout(() => setCopied(''), 1500); } catch { /* ignore */ }
  };

  const Copyable = ({ val, style }: { val: string; style?: React.CSSProperties }) => (
    <span
      onClick={(e) => copyVal(val, e)}
      title="Click to copy"
      style={{ fontFamily: 'monospace', cursor: 'copy', color: copied === val ? '#2e7d32' : '#1565c0', ...style }}
    >
      {copied === val ? '✓ copied' : val}
    </span>
  );

  // Local search filters jobs by job code, order code, or order UUID.
  const q = search.trim().toLowerCase();
  const jobMatches = (j: Job) =>
    !q ||
    j.jobCode.toLowerCase().includes(q) ||
    j.orders.some((o) => o.code.toLowerCase().includes(q) || (o.uuid || '').toLowerCase().includes(q));

  const cats = (data?.categories || [])
    .map((c) => {
      const jobs = c.jobs.filter((j) => (openOnly ? j.pending > 0 : true) && jobMatches(j));
      return {
        ...c,
        jobs,
        pendingTasks: jobs.reduce((s, j) => s + j.pending, 0),
        completedTasks: jobs.reduce((s, j) => s + j.completed, 0),
      };
    })
    .filter((c) => c.jobs.length > 0);

  return (
    <div>
      <div className="page-header"><h1>Floor Jobs</h1></div>
      <p style={{ fontSize: 13, color: '#888', marginTop: -8, marginBottom: 16 }}>
        Live Logiwa warehouse jobs grouped by job type — click a category to see its jobs, click a
        job for its orders. "Pending" tasks are work still in the queue (what a Locus bot or picker
        has yet to do).
      </p>

      <div className="toolbar">
        <div className="filters" style={{ gap: 8 }}>
          <select value={envSel} onChange={(e) => setEnvSel(e.target.value as 'production' | 'sandbox')}>
            <option value="production">production</option>
            <option value="sandbox">sandbox</option>
          </select>
          <select value={days} onChange={(e) => setDays(parseInt(e.target.value))}>
            <option value={1}>last 1 day</option>
            <option value={2}>last 2 days</option>
            <option value={3}>last 3 days</option>
            <option value={7}>last 7 days</option>
          </select>
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
            {' '}Only jobs with pending work
          </label>
          <input
            placeholder="Search job # / order # / UUID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') findInLogiwa(); }}
            style={{ padding: '6px 8px', minWidth: 230, fontFamily: 'monospace', fontSize: 12 }}
          />
          <button className="btn btn-sm" onClick={findInLogiwa} title="Fetch this job code directly from Logiwa (ignores the date window)">Find job in Logiwa</button>
          {jobLookup && (
            <button className="btn btn-sm" onClick={clearLookup}>✕ viewing {jobLookup} — back to window</button>
          )}
          <button className="btn btn-sm" onClick={() => load(jobLookup || undefined)}>Refresh</button>
        </div>
        {data && !data.error && (
          <div style={{ fontSize: 12, color: '#888' }}>
            {data.taskRowsLoaded} tasks loaded{data.truncated ? ` of ${data.taskRowsInWindow} (narrow the window for full coverage)` : ''}
          </div>
        )}
      </div>

      {loading ? (
        <div className="empty-state"><p>Loading floor data from Logiwa…</p></div>
      ) : data?.error ? (
        <div className="empty-state"><p style={{ color: '#c62828' }}>{data.error}</p></div>
      ) : cats.length === 0 ? (
        <div className="empty-state"><p>No jobs {openOnly ? 'with pending work ' : ''}in the selected window.</p></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {cats.map((c) => (
            <div key={c.jobType} className="card"
              onClick={() => { setOpenType(openType === c.jobType ? null : c.jobType); setOpenJob(null); }}
              style={{ padding: 14, cursor: 'pointer', gridColumn: openType === c.jobType ? '1 / -1' : undefined, border: openType === c.jobType ? '2px solid #1565c0' : undefined }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <b style={{ fontSize: 14 }}>{c.jobType}</b>
                <span style={{ fontSize: 12, color: '#888' }}>{c.jobs.length} job{c.jobs.length === 1 ? '' : 's'}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 13 }}>
                <span style={{ color: c.pendingTasks > 0 ? '#e65100' : '#2e7d32', fontWeight: 600 }}>
                  {c.pendingTasks} pending task{c.pendingTasks === 1 ? '' : 's'}
                </span>
                {' · '}{c.completedTasks} completed
              </div>

              {openType === c.jobType && (
                <div style={{ marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
                  <table style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Job</th><th>Client</th><th>Job Status</th><th>Progress (done/total per step)</th><th>Assignees</th><th>Planned Start</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.jobs.map((j) => (
                        <Fragment key={j.jobCode}>
                          <tr onClick={() => { const opening = openJob !== j.jobCode; setOpenJob(opening ? j.jobCode : null); if (opening) loadOrderStatuses(j); }} style={{ cursor: 'pointer' }}>
                            <td style={{ fontSize: 13 }}><Copyable val={j.jobCode} /></td>
                            <td>{j.client}</td>
                            <td><span className={`badge ${j.jobStatus === 'Completed' ? 'fulfilled' : 'sent'}`}>{j.jobStatus}</span></td>
                            <td style={{ fontSize: 13 }}>
                              {Object.entries(j.progress).map(([step, p]) => {
                                const total = p.pending + p.completed + p.other;
                                const done = p.completed === total;
                                return (
                                  <span key={step} style={{ marginRight: 12, whiteSpace: 'nowrap' }}>
                                    {step}{' '}
                                    <b style={{ color: done ? '#2e7d32' : '#e65100' }}>{p.completed}/{total}</b>
                                    {done ? ' ✓' : ` (${p.pending} to do)`}
                                  </span>
                                );
                              })}
                            </td>
                            <td style={{ fontSize: 12 }}>{j.assignees.join(', ') || '—'}</td>
                            <td style={{ fontSize: 12 }}>{j.earliestStart ? formatDate(j.earliestStart) : '—'}</td>
                          </tr>
                          {openJob === j.jobCode && (
                            <tr>
                              <td colSpan={6} style={{ background: '#fafafa', padding: '10px 16px' }}>
                                <div style={{ fontSize: 12, marginBottom: 6 }}>
                                  <b>Orders in this job ({j.orders.length})</b> — UUID is what Locus/external systems receive; click any value to copy. Status is live from Logiwa.
                                </div>
                                <table style={{ fontSize: 12 }}>
                                  <thead><tr><th>Order #</th><th>Order UUID</th><th>Order Status</th></tr></thead>
                                  <tbody>
                                    {j.orders.map((o) => (
                                      <tr key={o.code}>
                                        <td><Copyable val={o.code} /></td>
                                        <td>{o.uuid ? <Copyable val={o.uuid} /> : '—'}</td>
                                        <td>
                                          {o.uuid && orderStatuses[o.uuid]
                                            ? <span className={`badge ${/^(Shipped|Delivered)$/.test(orderStatuses[o.uuid]) ? 'fulfilled' : 'sent'}`}>{orderStatuses[o.uuid]}</span>
                                            : <span style={{ color: '#aaa' }}>loading…</span>}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                {j.waves.length > 0 && (
                                  <div style={{ fontSize: 12, marginTop: 8, color: '#888' }}>
                                    Waves:{' '}
                                    {j.waves.map((w, i) => (
                                      <Fragment key={w}>{i > 0 && ', '}<Copyable val={w} style={{ fontSize: 12 }} /></Fragment>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
