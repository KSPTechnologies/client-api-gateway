import { useState, useEffect } from 'react';

interface ApiKey {
  id: string;
  tenant_id: string;
  tenant_name: string;
  label: string | null;
  active: number;
  rate_limit: number;
  last_used_at: string | null;
  created_at: string;
}

interface Tenant {
  id: string;
  name: string;
}

export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [form, setForm] = useState({ tenant_id: '', label: '', rate_limit: '60' });

  const loadKeys = () => {
    fetch('/api/api-keys')
      .then((r) => r.json())
      .then((d) => { setKeys(d as ApiKey[]); setLoading(false); });
  };

  useEffect(() => {
    loadKeys();
    fetch('/api/tenants')
      .then((r) => r.json())
      .then((d) => setTenants(d as Tenant[]));
  }, []);

  const handleGenerate = async () => {
    const res = await fetch('/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: form.tenant_id,
        label: form.label || undefined,
        rate_limit: parseInt(form.rate_limit),
      }),
    });
    if (res.ok) {
      const data = await res.json() as { key: string };
      setNewKey(data.key);
      setForm({ tenant_id: '', label: '', rate_limit: '60' });
      loadKeys();
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (!confirm('Revoke this API key? The client will immediately lose access.')) return;
    await fetch('/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'revoke', key_id: keyId }),
    });
    loadKeys();
  };

  if (loading) return <div className="empty-state"><p>Loading...</p></div>;

  return (
    <div>
      <div className="toolbar">
        <div className="page-header"><h1>API Keys</h1></div>
        <button className="btn btn-primary" onClick={() => { setShowModal(true); setNewKey(null); }}>Generate Key</button>
      </div>

      <div className="table-container">
        {keys.length === 0 ? (
          <div className="empty-state"><p>No API keys yet. Generate one for a client.</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Label</th>
                <th>Rate Limit</th>
                <th>Status</th>
                <th>Last Used</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.tenant_name}</td>
                  <td>{k.label || '—'}</td>
                  <td>{k.rate_limit}/min</td>
                  <td><span className={`badge ${k.active ? 'active' : 'inactive'}`}>{k.active ? 'Active' : 'Revoked'}</span></td>
                  <td>{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}</td>
                  <td>{new Date(k.created_at).toLocaleDateString()}</td>
                  <td>
                    {k.active ? (
                      <button className="btn btn-sm btn-danger" onClick={() => handleRevoke(k.id)}>Revoke</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {newKey ? (
              <>
                <h2>Key Generated</h2>
                <p style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>Copy this key now. It cannot be retrieved again.</p>
                <div className="key-display">{newKey}</div>
                <div className="modal-actions">
                  <button className="btn btn-primary" onClick={() => { navigator.clipboard.writeText(newKey); }}>Copy</button>
                  <button className="btn" onClick={() => setShowModal(false)}>Done</button>
                </div>
              </>
            ) : (
              <>
                <h2>Generate API Key</h2>
                <div className="form-group">
                  <label>Client</label>
                  <select value={form.tenant_id} onChange={(e) => setForm({ ...form, tenant_id: e.target.value })}>
                    <option value="">Select a client...</option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Label (optional)</label>
                  <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. production, staging" />
                </div>
                <div className="form-group">
                  <label>Rate Limit (requests/min)</label>
                  <input type="number" value={form.rate_limit} onChange={(e) => setForm({ ...form, rate_limit: e.target.value })} />
                </div>
                <div className="modal-actions">
                  <button className="btn" onClick={() => setShowModal(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleGenerate} disabled={!form.tenant_id}>Generate</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
