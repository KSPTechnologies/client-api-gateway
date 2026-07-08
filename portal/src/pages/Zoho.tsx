import { useState, useEffect } from 'react';
import { formatDate } from '../utils';

interface ZohoEvent {
  id: string;
  tenant_id: string;
  tenant_name: string;
  zoho_record_id: string;
  order_code: string | null;
  gateway_order_id: string | null;
  source: string;
  inbound_status: string;
  writeback_status: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface Tenant {
  id: string;
  name: string;
}

export default function Zoho() {
  const [events, setEvents] = useState<ZohoEvent[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filterTenant, setFilterTenant] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const loadEvents = () => {
    setLoading(true);
    const params = new URLSearchParams({ page: page.toString() });
    if (filterTenant) params.set('tenant_id', filterTenant);
    if (filterStatus) params.set('status', filterStatus);

    fetch(`/api/zoho?${params}`)
      .then((r) => r.json())
      .then((d) => {
        const data = d as { events: ZohoEvent[]; total: number };
        setEvents(data.events);
        setTotal(data.total);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetch('/api/tenants')
      .then((r) => r.json())
      .then((d) => setTenants(d as Tenant[]));
  }, []);

  useEffect(loadEvents, [page, filterTenant, filterStatus]);

  const totalPages = Math.ceil(total / 50);

  return (
    <div>
      <div className="page-header"><h1>Zoho</h1></div>

      <div className="toolbar">
        <div className="filters">
          <select value={filterTenant} onChange={(e) => { setFilterTenant(e.target.value); setPage(1); }}>
            <option value="">All Tenants</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
            <option value="">All Statuses</option>
            <option value="received">Received</option>
            <option value="sent">Sent</option>
            <option value="error">Error</option>
          </select>
          <button className="btn btn-sm" onClick={loadEvents}>Refresh</button>
        </div>
        <div style={{ fontSize: 13, color: '#888' }}>{total} events</div>
      </div>

      <div className="table-container">
        {loading ? (
          <div className="empty-state"><p>Loading...</p></div>
        ) : events.length === 0 ? (
          <div className="empty-state"><p>No Zoho events yet — waiting for the first order.</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Zoho Record</th>
                <th>Order Code</th>
                <th>Gateway Order</th>
                <th>Source</th>
                <th>Inbound</th>
                <th>Writeback</th>
                <th>Error</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {events.map((z) => (
                <tr key={z.id}>
                  <td>{z.tenant_name}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{z.zoho_record_id}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{z.order_code || '—'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{z.gateway_order_id || '—'}</td>
                  <td>{z.source}</td>
                  <td><span className={`badge ${z.inbound_status}`}>{z.inbound_status}</span></td>
                  <td><span className={`badge ${z.writeback_status}`}>{z.writeback_status}</span></td>
                  <td style={{ fontSize: 12, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#c62828' }}>
                    {z.last_error || '—'}
                  </td>
                  <td>{formatDate(z.created_at)}</td>
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
