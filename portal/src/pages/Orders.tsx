import { useState, useEffect } from 'react';

interface Order {
  id: string;
  tenant_id: string;
  tenant_name: string;
  external_order_id: string | null;
  logiwa_order_id: string | null;
  status: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface Tenant {
  id: string;
  name: string;
}

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filterTenant, setFilterTenant] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const loadOrders = () => {
    setLoading(true);
    const params = new URLSearchParams({ page: page.toString() });
    if (filterTenant) params.set('tenant_id', filterTenant);
    if (filterStatus) params.set('status', filterStatus);

    fetch(`/api/orders?${params}`)
      .then((r) => r.json())
      .then((d) => {
        const data = d as { orders: Order[]; total: number };
        setOrders(data.orders);
        setTotal(data.total);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetch('/api/tenants')
      .then((r) => r.json())
      .then((d) => setTenants(d as Tenant[]));
  }, []);

  useEffect(loadOrders, [page, filterTenant, filterStatus]);

  const totalPages = Math.ceil(total / 50);

  return (
    <div>
      <div className="page-header"><h1>Orders</h1></div>

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
            <option value="fulfilled">Fulfilled</option>
            <option value="closed">Closed</option>
            <option value="error">Error</option>
          </select>
        </div>
        <div style={{ fontSize: 13, color: '#888' }}>{total} orders</div>
      </div>

      <div className="table-container">
        {loading ? (
          <div className="empty-state"><p>Loading...</p></div>
        ) : orders.length === 0 ? (
          <div className="empty-state"><p>No orders found</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>External ID</th>
                <th>Logiwa ID</th>
                <th>Status</th>
                <th>Error</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{o.tenant_name}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{o.external_order_id || '—'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{o.logiwa_order_id || '—'}</td>
                  <td><span className={`badge ${o.status}`}>{o.status}</span></td>
                  <td style={{ fontSize: 12, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#c62828' }}>
                    {o.status === 'error' ? (o.last_error || 'Unknown error') : '—'}
                  </td>
                  <td>{new Date(o.created_at).toLocaleString()}</td>
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
