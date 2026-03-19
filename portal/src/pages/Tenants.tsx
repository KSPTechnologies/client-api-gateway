import { useState, useEffect } from 'react';

interface Tenant {
  id: string;
  name: string;
  callback_url: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export default function Tenants() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', logiwa_api_url: '', logiwa_credentials: '', callback_url: '' });

  const loadTenants = () => {
    fetch('/api/tenants')
      .then((r) => r.json())
      .then((d) => { setTenants(d as Tenant[]); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(loadTenants, []);

  const handleCreate = async () => {
    const res = await fetch('/api/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setShowModal(false);
      setForm({ name: '', logiwa_api_url: '', logiwa_credentials: '', callback_url: '' });
      loadTenants();
    }
  };

  if (loading) return <div className="empty-state"><p>Loading...</p></div>;

  return (
    <div>
      <div className="toolbar">
        <div className="page-header"><h1>Tenants</h1></div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>Add Tenant</button>
      </div>

      <div className="table-container">
        {tenants.length === 0 ? (
          <div className="empty-state"><p>No tenants yet. Add one to get started.</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Callback URL</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.name}</strong><br /><span style={{ fontSize: 11, color: '#999' }}>{t.id}</span></td>
                  <td>{t.callback_url || '—'}</td>
                  <td><span className={`badge ${t.active ? 'active' : 'inactive'}`}>{t.active ? 'Active' : 'Inactive'}</span></td>
                  <td>{new Date(t.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add Tenant</h2>
            <div className="form-group">
              <label>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Client name" />
            </div>
            <div className="form-group">
              <label>Logiwa API URL</label>
              <input value={form.logiwa_api_url} onChange={(e) => setForm({ ...form, logiwa_api_url: e.target.value })} placeholder="https://myapi.logiwa.com" />
            </div>
            <div className="form-group">
              <label>Logiwa Credentials (JSON)</label>
              <input value={form.logiwa_credentials} onChange={(e) => setForm({ ...form, logiwa_credentials: e.target.value })} placeholder='{"username":"...","password":"..."}' />
            </div>
            <div className="form-group">
              <label>Callback URL (optional)</label>
              <input value={form.callback_url} onChange={(e) => setForm({ ...form, callback_url: e.target.value })} placeholder="https://client.example.com/webhook" />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
