import { useState, useEffect } from 'react';
import { formatDate } from '../utils';

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
    tenant_name: string | null;
    method: string;
    path: string;
    status_code: number;
    error_message: string | null;
    created_at: string;
  }[];
  recentErrors: {
    id: number;
    tenant_id: string;
    tenant_name: string | null;
    endpoint: string;
    method: string;
    error_message: string;
    error_code: number;
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
          <div className="label">Active Clients</div>
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

      {data.recentErrors.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, marginBottom: 12, color: '#e74c3c' }}>Unresolved Errors</h2>
          <div className="table-container" style={{ marginBottom: 24 }}>
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Endpoint</th>
                  <th>Error</th>
                  <th>Code</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {data.recentErrors.map((err) => (
                  <tr key={err.id}>
                    <td>{err.tenant_name || err.tenant_id}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{err.method} {err.endpoint}</td>
                    <td style={{ fontSize: 13, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{err.error_message}</td>
                    <td><span className="badge error">{err.error_code}</span></td>
                    <td>{formatDate(err.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Recent API Activity</h2>
      <div className="table-container">
        {data.recentRequests.length === 0 ? (
          <div className="empty-state"><p>No requests yet</p></div>
        ) : (
          <table className="request-log">
            <thead>
              <tr>
                <th>Client</th>
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
                  <td>{req.tenant_name || '—'}</td>
                  <td className="method">{req.method}</td>
                  <td className="path">{req.path}</td>
                  <td className={req.status_code < 400 ? 'status-ok' : 'status-err'}>
                    {req.status_code}
                  </td>
                  <td style={{ fontSize: 13, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.error_message || '—'}</td>
                  <td>{formatDate(req.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
