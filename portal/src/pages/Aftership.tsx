import { useState, useEffect, Fragment } from 'react';
import { formatDate } from '../utils';

interface Push {
  id: string;
  tenant_name: string | null;
  order_code: string | null;
  tracking_number: string;
  aftership_id: string | null;
  status: string;
  last_error: string | null;
  created_at: string;
}

interface Checkpoint { time: string | null; message: string; location: string | null; }

interface PushDetail {
  requestPayload: unknown;
  responseMeta: unknown;
  live: {
    tag: string;
    subtag_message: string | null;
    expected_delivery: string | null;
    courier_tracking_link: string | null;
    checkpoints: Checkpoint[];
  } | null;
}

interface Account {
  tenant_id: string;
  tenant_name: string | null;
  enabled: number;
  enabled_at: string;
  has_credentials: boolean;
}

export default function Aftership() {
  const [pushes, setPushes] = useState<Push[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [auto, setAuto] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, PushDetail | 'loading'>>({});

  const toggleExpand = (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    setDetails((m) => ({ ...m, [id]: 'loading' }));
    fetch(`/api/aftership-detail?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => setDetails((m) => ({ ...m, [id]: d as PushDetail })));
  };

  const load = () => {
    const p = new URLSearchParams({ page: page.toString() });
    if (filterStatus) p.set('status', filterStatus);
    fetch(`/api/aftership?${p}`)
      .then((r) => r.json())
      .then((d) => {
        const data = d as { pushes: Push[]; total: number };
        setPushes(data.pushes);
        setTotal(data.total);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    fetch('/api/aftership-clients')
      .then((r) => r.json())
      .then((d) => setAccounts((d as { accounts: Account[] }).accounts || []))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    if (!auto) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [page, filterStatus, auto]);

  const totalPages = Math.ceil(total / 50);

  return (
    <div>
      <div className="page-header"><h1>AfterShip</h1></div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        {accounts.length === 0 ? (
          <span style={{ fontSize: 13, color: '#888' }}>No clients enabled for AfterShip.</span>
        ) : accounts.map((a) => (
          <div key={a.tenant_id} style={{ border: '1px solid #c8e6c9', borderLeft: '4px solid #2e7d32', borderRadius: 6, padding: '10px 14px', background: '#fff' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{a.tenant_name || a.tenant_id}</div>
            <div style={{ fontSize: 12, color: a.enabled ? '#2e7d32' : '#c62828' }}>
              {a.enabled ? 'enabled' : 'disabled'} since {formatDate(a.enabled_at)}
              {!a.has_credentials && ' — ⚠ no credentials'}
            </div>
          </div>
        ))}
      </div>

      <div className="toolbar">
        <div className="filters" style={{ gap: 8 }}>
          <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
            <option value="">All Statuses</option>
            <option value="pushed">Pushed</option>
            <option value="pending">Pending</option>
            <option value="error">Error</option>
            <option value="skipped">Skipped</option>
          </select>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> auto-refresh (15s)
          </label>
          <button className="btn btn-sm" onClick={load}>Refresh</button>
        </div>
        <div style={{ fontSize: 13, color: '#888' }}>{total} pushes</div>
      </div>

      <div className="table-container">
        {loading ? (
          <div className="empty-state"><p>Loading...</p></div>
        ) : pushes.length === 0 ? (
          <div className="empty-state"><p>No trackings pushed yet — waiting for the first fulfillment.</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Order</th>
                <th>Tracking #</th>
                <th>Status</th>
                <th>AfterShip ID</th>
                <th>Error</th>
                <th>Pushed</th>
              </tr>
            </thead>
            <tbody>
              {pushes.map((p) => (
                <Fragment key={p.id}>
                  <tr onClick={() => toggleExpand(p.id)} style={{ cursor: 'pointer' }}>
                    <td>{p.tenant_name || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{(p.order_code || '—').slice(0, 18)}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.tracking_number}</td>
                    <td><span className={`badge ${p.status === 'pushed' ? 'fulfilled' : p.status}`}>{p.status}</span></td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.aftership_id ? p.aftership_id.slice(0, 12) + '…' : '—'}</td>
                    <td style={{ fontSize: 12, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#c62828' }} title={p.last_error || ''}>
                      {p.last_error || '—'}
                    </td>
                    <td>{formatDate(p.created_at)}</td>
                  </tr>
                  {expandedId === p.id && (
                    <tr>
                      <td colSpan={7} style={{ background: '#fafafa', padding: '16px 24px' }}>
                        {details[p.id] === 'loading' || !details[p.id] ? (
                          <p style={{ fontSize: 13 }}>Loading detail…</p>
                        ) : (
                          (() => {
                            const d = details[p.id] as PushDetail;
                            return (
                              <div style={{ fontSize: 13 }}>
                                {d.live ? (
                                  <div style={{ marginBottom: 12 }}>
                                    <strong>Live AfterShip status:</strong>{' '}
                                    <span style={{ background: '#e8f5e9', color: '#2e7d32', padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>{d.live.tag}</span>
                                    {d.live.subtag_message && <span style={{ color: '#666' }}> — {d.live.subtag_message}</span>}
                                    {d.live.expected_delivery && <span style={{ color: '#666' }}> · ETA {d.live.expected_delivery}</span>}
                                    {d.live.courier_tracking_link && (
                                      <> · <a href={d.live.courier_tracking_link} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>carrier page ↗</a></>
                                    )}
                                    {d.live.checkpoints.length > 0 && (
                                      <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                                        {d.live.checkpoints.map((c, i) => (
                                          <li key={i} style={{ marginBottom: 2 }}>
                                            <span style={{ color: '#888' }}>{c.time ? formatDate(c.time) : ''}</span>{' '}
                                            {c.message}{c.location ? ` (${c.location})` : ''}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                ) : (
                                  <p style={{ fontSize: 12, color: '#999', marginTop: 0 }}>Live AfterShip status unavailable.</p>
                                )}
                                <strong>Payload we pushed</strong>
                                {d.requestPayload ? (
                                  <pre style={{ background: '#1a1a2e', color: '#a0e0a0', padding: 12, borderRadius: 6, fontSize: 11, marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflow: 'auto' }}>
                                    {JSON.stringify(d.requestPayload, null, 2)}
                                  </pre>
                                ) : (
                                  <p style={{ fontSize: 12, color: '#999' }}>Not recorded (pushes before 7/20 didn't store payloads).</p>
                                )}
                                {d.responseMeta != null && (
                                  <>
                                    <strong>AfterShip response</strong>
                                    <pre style={{ background: '#1a1a2e', color: '#a0c0e0', padding: 12, borderRadius: 6, fontSize: 11, marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto' }}>
                                      {JSON.stringify(d.responseMeta, null, 2)}
                                    </pre>
                                  </>
                                )}
                              </div>
                            );
                          })()
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span style={{ fontSize: 13, lineHeight: '28px' }}>Page {page} of {totalPages}</span>
          <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
