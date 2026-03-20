import { useState, useEffect } from 'react';
import { formatDate } from '../utils';

interface ErrorEntry {
  id: number;
  tenant_id: string;
  tenant_name: string;
  endpoint: string;
  method: string;
  error_message: string;
  error_code: number;
  retry_count: number;
  resolved: number;
  created_at: string;
}

interface Tenant {
  id: string;
  name: string;
}

export default function Errors() {
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [filterTenant, setFilterTenant] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const loadErrors = () => {
    setLoading(true);
    const params = new URLSearchParams({ resolved: showResolved ? '1' : '0' });
    if (filterTenant) params.set('tenant_id', filterTenant);

    fetch(`/api/errors?${params}`)
      .then((r) => r.json())
      .then((d) => { setErrors(d as ErrorEntry[]); setLoading(false); });
  };

  useEffect(() => {
    fetch('/api/tenants')
      .then((r) => r.json())
      .then((d) => setTenants(d as Tenant[]));
  }, []);

  useEffect(loadErrors, [showResolved, filterTenant]);

  const toggleSelect = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const selectAll = () => {
    if (selected.size === errors.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(errors.map((e) => e.id)));
    }
  };

  const handleAction = async (action: 'resolve' | 'retry') => {
    if (selected.size === 0) return;
    await fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ids: Array.from(selected) }),
    });
    setSelected(new Set());
    loadErrors();
  };

  return (
    <div>
      <div className="page-header"><h1>Error Queue</h1></div>

      <div className="toolbar">
        <div className="filters">
          <select value={filterTenant} onChange={(e) => setFilterTenant(e.target.value)}>
            <option value="">All Tenants</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            Show resolved
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {selected.size > 0 && (
            <>
              <button className="btn btn-sm btn-primary" onClick={() => handleAction('retry')}>
                Retry ({selected.size})
              </button>
              <button className="btn btn-sm" onClick={() => handleAction('resolve')}>
                Resolve ({selected.size})
              </button>
            </>
          )}
        </div>
      </div>

      <div className="table-container">
        {loading ? (
          <div className="empty-state"><p>Loading...</p></div>
        ) : errors.length === 0 ? (
          <div className="empty-state"><p>{showResolved ? 'No resolved errors' : 'No unresolved errors'}</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" checked={selected.size === errors.length && errors.length > 0} onChange={selectAll} />
                </th>
                <th>Tenant</th>
                <th>Endpoint</th>
                <th>Error</th>
                <th>Code</th>
                <th>Retries</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((e) => (
                <tr key={e.id}>
                  <td><input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSelect(e.id)} /></td>
                  <td>{e.tenant_name}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{e.method} {e.endpoint}</td>
                  <td>{e.error_message}</td>
                  <td><span className="badge error">{e.error_code}</span></td>
                  <td>{e.retry_count}</td>
                  <td>{formatDate(e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
