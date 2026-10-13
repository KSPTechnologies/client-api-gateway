import { useState, useEffect } from 'react';
import { formatDate } from '../utils';

interface MirrorRow {
  tenant_id: string;
  tenant_name: string;
  logiwa_environment: string;
  enabled: number;
  lookback_days: number;
  last_run_at: string | null;
  last_imported: number;
  total_orders: number;
}

interface Tenant { id: string; name: string; }

export default function OrderMirror() {
  const [rows, setRows] = useState<MirrorRow[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formTenant, setFormTenant] = useState('');
  const [formLookback, setFormLookback] = useState(3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    fetch('/api/order-mirrors')
      .then((r) => r.json())
      .then((d) => { setRows(d as MirrorRow[]); setLoading(false); });
  };

  useEffect(() => {
    fetch('/api/tenants').then((r) => r.json()).then((d) => setTenants(d as Tenant[]));
    load();
  }, []);

  const save = async (tenantId: string, enabled: boolean, lookback: number) => {
    setError('');
    setSaving(true);
    const res = await fetch('/api/order-mirrors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId, enabled, lookback_days: lookback }),
    });
    setSaving(false);
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setError(b.error || `Save failed (${res.status})`);
      return;
    }
    setShowForm(false);
    setFormTenant('');
    load();
  };

  const remove = async (r: MirrorRow) => {
    if (!window.confirm(`Stop mirroring Logiwa orders for ${r.tenant_name}? Existing imported orders are kept.`)) return;
    await fetch(`/api/order-mirrors?tenant_id=${encodeURIComponent(r.tenant_id)}`, { method: 'DELETE' });
    load();
  };

  return (
    <div>
      <div className="page-header">
        <h1>Order Mirror</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add Client'}
        </button>
      </div>

      <p style={{ fontSize: 13, color: '#888', marginTop: -8, marginBottom: 16 }}>
        For clients whose orders are created directly in Logiwa (not through the gateway): every
        15 minutes the gateway imports their recent Logiwa orders into the Orders table, so
        tracking sync runs on them and the client can poll the tracking endpoint with their API
        key. Imported orders show a <b>logiwa</b> source badge. Lookback = how many days back
        each pass checks (re-imports are automatically skipped).
      </p>

      {showForm && (
        <div className="card" style={{ marginBottom: 20, padding: 16, display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <label style={{ fontSize: 13 }}>
            Client
            <select value={formTenant} onChange={(e) => setFormTenant(e.target.value)} style={{ width: 240, display: 'block' }}>
              <option value="">Select…</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 13 }}>
            Lookback (days)
            <input type="number" min={1} max={30} value={formLookback}
              onChange={(e) => setFormLookback(parseInt(e.target.value) || 3)}
              style={{ width: 90, display: 'block' }} />
          </label>
          <button className="btn btn-primary btn-sm" disabled={saving || !formTenant}
            onClick={() => save(formTenant, true, formLookback)}>
            {saving ? 'Saving…' : 'Enable Mirror'}
          </button>
          {error && <span style={{ color: '#c62828', fontSize: 13 }}>{error}</span>}
        </div>
      )}

      <div className="table-container">
        {loading ? (
          <div className="empty-state"><p>Loading...</p></div>
        ) : rows.length === 0 ? (
          <div className="empty-state"><p>No clients mirrored.</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Environment</th>
                <th>Lookback</th>
                <th>Last Run</th>
                <th>Last Imported</th>
                <th>Total Orders</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tenant_id} style={{ opacity: r.enabled ? 1 : 0.5 }}>
                  <td>{r.tenant_name || r.tenant_id}</td>
                  <td><span className={`badge ${r.logiwa_environment === 'production' ? 'fulfilled' : 'received'}`}>{r.logiwa_environment}</span></td>
                  <td>{r.lookback_days}d</td>
                  <td>{r.last_run_at ? formatDate(r.last_run_at) : '—'}</td>
                  <td>{r.last_imported}</td>
                  <td>{r.total_orders}</td>
                  <td><span className={`badge ${r.enabled ? 'sent' : 'error'}`}>{r.enabled ? 'enabled' : 'disabled'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" onClick={() => save(r.tenant_id, !r.enabled, r.lookback_days)}>
                      {r.enabled ? 'Disable' : 'Enable'}
                    </button>{' '}
                    <button className="btn btn-sm" onClick={() => remove(r)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
