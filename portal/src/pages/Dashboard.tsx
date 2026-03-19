import { useState, useEffect } from 'react';

interface DashboardData {
  tenants: number;
  orders: {
    total: number;
    received: number;
    sent: number;
    fulfilled: number;
    closed: number;
    error: number;
  };
  unresolvedErrors: number;
  recentRequests: {
    tenant_id: string;
    method: string;
    path: string;
    status_code: number;
    error_message: string | null;
    created_at: string;
  }[];
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then((d) => { setData(d as DashboardData); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="empty-state"><p>Loading...</p></div>;
  if (!data) return <div className="empty-state"><p>Failed to load dashboard</p></div>;

  return (
    <div>
      <div className="page-header"><h1>Dashboard</h1></div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Active Tenants</div>
          <div className="value">{data.tenants}</div>
        </div>
        <div className="stat-card">
          <div className="label">Total Orders</div>
          <div className="value">{data.orders.total}</div>
        </div>
        <div className="stat-card">
          <div className="label">Fulfilled</div>
          <div className="value success">{data.orders.fulfilled}</div>
        </div>
        <div className="stat-card">
          <div className="label">Unresolved Errors</div>
          <div className="value error">{data.unresolvedErrors}</div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Received</div>
          <div className="value">{data.orders.received}</div>
        </div>
        <div className="stat-card">
          <div className="label">Sent to Logiwa</div>
          <div className="value">{data.orders.sent}</div>
        </div>
        <div className="stat-card">
          <div className="label">Closed</div>
          <div className="value">{data.orders.closed}</div>
        </div>
        <div className="stat-card">
          <div className="label">Errored</div>
          <div className="value error">{data.orders.error}</div>
        </div>
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Recent Requests</h2>
      <div className="table-container">
        {data.recentRequests.length === 0 ? (
          <div className="empty-state"><p>No requests yet</p></div>
        ) : (
          <table className="request-log">
            <thead>
              <tr>
                <th>Method</th>
                <th>Path</th>
                <th>Status</th>
                <th>Error</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {data.recentRequests.map((req, i) => (
                <tr key={i}>
                  <td className="method">{req.method}</td>
                  <td className="path">{req.path}</td>
                  <td className={req.status_code < 400 ? 'status-ok' : 'status-err'}>
                    {req.status_code}
                  </td>
                  <td>{req.error_message || '—'}</td>
                  <td>{new Date(req.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
