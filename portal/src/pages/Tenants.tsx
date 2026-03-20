import { useState, useEffect } from 'react';

interface TenantEndpoint {
  endpoint_type: string;
  enabled: number;
  custom_path: string | null;
}

interface Tenant {
  id: string;
  name: string;
  base_url: string | null;
  callback_url: string | null;
  active: number;
  active_keys: number;
  logiwa_environment: 'sandbox' | 'production';
  logiwa_sandbox_client_id: string | null;
  logiwa_prod_client_id: string | null;
  created_at: string;
  updated_at: string;
  endpoints: TenantEndpoint[];
}

interface LogiwaClient {
  identifier: string;
  displayName: string;
}

const ENDPOINT_OPTIONS = [
  { type: 'create_order', label: 'Create Order', method: 'POST', path: '/v1/orders' },
  { type: 'get_order', label: 'Get Order Status', method: 'GET', path: '/v1/orders/:id' },
  { type: 'tracking', label: 'Get Tracking', method: 'GET', path: '/v1/orders/:id/tracking' },
  { type: 'inventory', label: 'Query Inventory', method: 'POST', path: '/v1/inventory/query' },
  { type: 'create_po', label: 'Create Purchase Order (future)', method: 'POST', path: '/v1/purchase-orders', future: true },
  { type: 'webhooks', label: 'Webhook Subscriptions (future)', method: 'POST', path: '/v1/webhooks', future: true },
];

interface CreateForm {
  name: string;
  base_url: string;
  callback_url: string;
  endpoints: string[];
  logiwa_sandbox_client_id: string;
  logiwa_prod_client_id: string;
}

const emptyForm: CreateForm = {
  name: '', base_url: '', callback_url: '', endpoints: [],
  logiwa_sandbox_client_id: '', logiwa_prod_client_id: '',
};

export default function Tenants() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateForm>({ ...emptyForm });
  const [sandboxClients, setSandboxClients] = useState<LogiwaClient[]>([]);
  const [prodClients, setProdClients] = useState<LogiwaClient[]>([]);

  const loadLogiwaClients = () => {
    fetch('/api/logiwa-clients?env=sandbox')
      .then((r) => r.json())
      .then((d) => setSandboxClients((d as { clients: LogiwaClient[] }).clients || []))
      .catch(() => {});
    fetch('/api/logiwa-clients?env=production')
      .then((r) => r.json())
      .then((d) => setProdClients((d as { clients: LogiwaClient[] }).clients || []))
      .catch(() => {});
  };

  const loadTenants = () => {
    fetch('/api/tenants')
      .then((r) => r.json())
      .then((d) => { setTenants(d as Tenant[]); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadTenants(); loadLogiwaClients(); }, []);

  const toggleEndpoint = (type: string) => {
    setForm((f) => ({
      ...f,
      endpoints: f.endpoints.includes(type)
        ? f.endpoints.filter((e) => e !== type)
        : [...f.endpoints, type],
    }));
  };

  const handleCreate = async () => {
    const res = await fetch('/api/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setShowModal(false);
      setForm({ ...emptyForm });
      loadTenants();
    }
  };

  if (loading) return <div className="empty-state"><p>Loading...</p></div>;

  return (
    <div>
      <div className="toolbar">
        <div className="page-header"><h1>Clients</h1></div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>Add Client</button>
      </div>

      <div className="table-container">
        {tenants.length === 0 ? (
          <div className="empty-state"><p>No clients yet. Add one to get started.</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Base URL</th>
                <th>Environment</th>
                <th>Active Keys</th>
                <th>Endpoints</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <>
                  <tr key={t.id} onClick={() => setExpandedId(expandedId === t.id ? null : t.id)} style={{ cursor: 'pointer' }}>
                    <td><strong>{t.name}</strong><br /><span style={{ fontSize: 11, color: '#999' }}>{t.id}</span></td>
                    <td>{t.base_url || '—'}</td>
                    <td>
                      <span className={`badge ${t.logiwa_environment === 'production' ? 'error' : 'fulfilled'}`}>
                        {(t.logiwa_environment || 'sandbox').toUpperCase()}
                      </span>
                    </td>
                    <td>{t.active_keys}</td>
                    <td>{t.endpoints.filter((e) => e.enabled).length} enabled</td>
                    <td><span className={`badge ${t.active ? 'active' : 'inactive'}`}>{t.active ? 'Active' : 'Inactive'}</span></td>
                    <td>{new Date(t.created_at).toLocaleDateString()}</td>
                  </tr>
                  {expandedId === t.id && (
                    <tr key={`${t.id}-detail`}>
                      <td colSpan={7} style={{ background: '#fafafa', padding: '16px 24px' }}>
                        <div style={{ fontSize: 13 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                            <strong>Logiwa Environment:</strong>
                            <button
                              className={`env-switch ${t.logiwa_environment === 'production' ? 'production' : 'sandbox'}`}
                              style={{ width: 'auto', padding: '4px 12px', fontSize: 11 }}
                              onClick={async (e) => {
                                e.stopPropagation();
                                const newEnv = t.logiwa_environment === 'production' ? 'sandbox' : 'production';
                                if (newEnv === 'production' && !confirm(`Switch ${t.name} to PRODUCTION? Their API requests will hit the live Logiwa system.`)) return;
                                await fetch('/api/environment', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ tenant_id: t.id, environment: newEnv }),
                                });
                                loadTenants();
                              }}
                            >
                              <span className="env-dot" />
                              <span className="env-text">{(t.logiwa_environment || 'sandbox').toUpperCase()}</span>
                            </button>
                            <span style={{ color: '#888', fontSize: 11 }}>Click to switch</span>
                          </div>
                          <strong>Enabled Endpoints:</strong>
                          {t.endpoints.filter((e) => e.enabled).length === 0 ? (
                            <span style={{ color: '#999', marginLeft: 8 }}>None configured</span>
                          ) : (
                            <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
                              {t.endpoints.filter((e) => e.enabled).map((ep) => {
                                const def = ENDPOINT_OPTIONS.find((o) => o.type === ep.endpoint_type);
                                return (
                                  <li key={ep.endpoint_type} style={{ marginBottom: 4 }}>
                                    <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{def?.method}</span>{' '}
                                    <span style={{ fontFamily: 'monospace' }}>{ep.custom_path || def?.path}</span>{' '}
                                    <span style={{ color: '#888' }}>— {def?.label}</span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                          {t.callback_url && (
                            <p style={{ marginTop: 8 }}><strong>Callback URL:</strong> <span style={{ fontFamily: 'monospace' }}>{t.callback_url}</span></p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
            <h2>Add Client</h2>

            <div className="form-group">
              <label>Client Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Acme Corp" />
            </div>
            <div className="form-group">
              <label>Base URL</label>
              <input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="e.g. acme.com" />
            </div>
            <div className="form-group">
              <label>Callback URL (optional — for tracking push notifications)</label>
              <input value={form.callback_url} onChange={(e) => setForm({ ...form, callback_url: e.target.value })} placeholder="https://client.example.com/webhook" />
            </div>

            <div style={{ borderTop: '1px solid #eee', margin: '16px 0', paddingTop: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>Logiwa Client Mapping</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Sandbox Client</label>
                  <select value={form.logiwa_sandbox_client_id} onChange={(e) => setForm({ ...form, logiwa_sandbox_client_id: e.target.value })}>
                    <option value="">Select sandbox client...</option>
                    {sandboxClients.map((c) => (
                      <option key={c.identifier} value={c.identifier}>{c.displayName}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Production Client</label>
                  <select value={form.logiwa_prod_client_id} onChange={(e) => setForm({ ...form, logiwa_prod_client_id: e.target.value })}>
                    <option value="">Select production client...</option>
                    {prodClients.map((c) => (
                      <option key={c.identifier} value={c.identifier}>{c.displayName}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid #eee', margin: '16px 0', paddingTop: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>Endpoint Functions</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {ENDPOINT_OPTIONS.map((ep) => (
                  <label key={ep.type} style={{
                    display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                    padding: '8px 12px', border: '1px solid #eee', borderRadius: 6, cursor: 'pointer',
                    background: form.endpoints.includes(ep.type) ? '#e3f2fd' : '#fff',
                    opacity: (ep as any).future ? 0.5 : 1,
                  }}>
                    <input
                      type="checkbox"
                      checked={form.endpoints.includes(ep.type)}
                      onChange={() => toggleEndpoint(ep.type)}
                    />
                    <div>
                      <div style={{ fontWeight: 500 }}>{ep.label}</div>
                      <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>{ep.method} {ep.path}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {form.endpoints.length > 0 && form.base_url && (
              <div style={{ borderTop: '1px solid #eee', margin: '16px 0', paddingTop: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>Generated Endpoints</label>
                <div style={{ background: '#1a1a2e', borderRadius: 6, padding: 12, fontSize: 12, fontFamily: 'monospace', color: '#a0a0c0' }}>
                  {form.endpoints.map((epType) => {
                    const def = ENDPOINT_OPTIONS.find((e) => e.type === epType);
                    if (!def) return null;
                    const slug = def.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                    return (
                      <div key={epType} style={{ marginBottom: 4 }}>
                        <span style={{ color: '#4a9eff' }}>{def.method}</span>{' '}
                        <span style={{ color: '#4ade80' }}>{form.base_url}/{slug}</span>{' '}
                        <span style={{ color: '#666' }}>→ {def.path}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!form.name}>Create Client</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
