import { useState, useEffect } from 'react';
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
                <tr key={p.id}>
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
