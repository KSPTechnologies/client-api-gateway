import { useState, useEffect, Fragment } from 'react';
import { formatDate } from '../utils';

interface Job {
  jobCode: string;
  jobStatus: string;
  client: string;
  pending: number;
  completed: number;
  otherStatus: Record<string, number>;
  taskTypes: Record<string, number>;
  orders: string[];
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

  const load = () => {
    setLoading(true);
    fetch(`/api/floor-jobs?env=${envSel}&days=${days}`)
      .then((r) => r.json())
      .then((d) => { setData(d as FloorData); setLoading(false); });
  };

  useEffect(load, [days, envSel]);

  const cats = (data?.categories || [])
    .map((c) => openOnly ? { ...c, jobs: c.jobs.filter((j) => j.pending > 0) } : c)
    .filter((c) => (openOnly ? c.jobs.length > 0 : true));

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
          <button className="btn btn-sm" onClick={load}>Refresh</button>
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
                        <th>Job</th><th>Client</th><th>Job Status</th><th>Pending</th><th>Completed</th><th>Task Types</th><th>Assignees</th><th>Planned Start</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.jobs.map((j) => (
                        <Fragment key={j.jobCode}>
                          <tr onClick={() => setOpenJob(openJob === j.jobCode ? null : j.jobCode)} style={{ cursor: 'pointer' }}>
                            <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{j.jobCode}</td>
                            <td>{j.client}</td>
                            <td><span className={`badge ${j.jobStatus === 'Completed' ? 'fulfilled' : 'sent'}`}>{j.jobStatus}</span></td>
                            <td style={{ color: j.pending > 0 ? '#e65100' : undefined, fontWeight: j.pending > 0 ? 700 : undefined }}>{j.pending}</td>
                            <td>{j.completed}</td>
                            <td style={{ fontSize: 12 }}>{Object.entries(j.taskTypes).map(([t, n]) => `${t}:${n}`).join(' ')}</td>
                            <td style={{ fontSize: 12 }}>{j.assignees.join(', ') || '—'}</td>
                            <td style={{ fontSize: 12 }}>{j.earliestStart ? formatDate(j.earliestStart) : '—'}</td>
                          </tr>
                          {openJob === j.jobCode && (
                            <tr>
                              <td colSpan={8} style={{ background: '#fafafa', padding: '10px 16px' }}>
                                <div style={{ fontSize: 12, marginBottom: 6 }}>
                                  <b>Orders in this job ({j.orders.length}):</b>
                                </div>
                                <div style={{ fontFamily: 'monospace', fontSize: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {j.orders.map((o) => (
                                    <span key={o} style={{ background: '#e3f2fd', padding: '2px 8px', borderRadius: 8 }}>{o}</span>
                                  ))}
                                </div>
                                {j.waves.length > 0 && (
                                  <div style={{ fontSize: 12, marginTop: 8, color: '#888' }}>Waves: {j.waves.join(', ')}</div>
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
