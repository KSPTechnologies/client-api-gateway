import { useState, useEffect } from 'react';
import { formatDate } from '../utils';

interface SftpClientRow {
  sftp_username: string;
  tenant_id: string;
  tenant_name: string | null;
  environment: string;
  r2_prefix: string;
  enabled: number;
  created_at: string;
}

interface Tenant {
  id: string;
  name: string;
  logiwa_sandbox_client_id: string | null;
  logiwa_prod_client_id: string | null;
}

interface SftpFile {
  id: string;
  sftp_username: string;
  tenant_name: string | null;
  file_name: string | null;
  order_code: string | null;
  gateway_order_id: string | null;
  status: string;
  confirmation_key: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export default function Sftp() {
  // ── SFTP client links ──
  const [clients, setClients] = useState<SftpClientRow[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [newUser, setNewUser] = useState('');
  const [newTenant, setNewTenant] = useState('');
  const [newEnv, setNewEnv] = useState('sandbox');
  const [msg, setMsg] = useState('');

  // ── File activity ──
  const [files, setFiles] = useState<SftpFile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filterClient, setFilterClient] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const loadClients = () => {
    fetch('/api/sftp-clients')
      .then((r) => r.json())
      .then((d) => {
        const data = d as { clients: SftpClientRow[]; tenants: Tenant[] };
        setClients(data.clients || []);
        setTenants(data.tenants || []);
      });
  };

  const loadFiles = () => {
    setLoading(true);
    const p = new URLSearchParams({ page: page.toString() });
    if (filterClient) p.set('client', filterClient);
    if (filterStatus) p.set('status', filterStatus);
    fetch(`/api/sftp?${p}`)
      .then((r) => r.json())
      .then((d) => {
        const data = d as { files: SftpFile[]; total: number };
        setFiles(data.files);
        setTotal(data.total);
        setLoading(false);
      });
  };

  useEffect(loadClients, []);
  useEffect(loadFiles, [page, filterClient, filterStatus]);

  const linkClient = () => {
    setMsg('');
    fetch('/api/sftp-clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sftp_username: newUser.trim(), tenant_id: newTenant, environment: newEnv }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setMsg(d.error);
        else {
          setMsg(`Linked ${d.sftp_username} → ${d.r2_prefix} (${d.environment})`);
          setNewUser('');
          setNewTenant('');
          loadClients();
        }
      });
  };

  const toggle = (username: string, enabled: number) => {
    fetch('/api/sftp-clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle', sftp_username: username, enabled: enabled ? 0 : 1 }),
    }).then(loadClients);
  };

  const unlink = (username: string) => {
    if (!confirm(`Unlink SFTP user "${username}" from its client? (Does not delete the SFTP account itself.)`)) return;
    fetch('/api/sftp-clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unlink', sftp_username: username }),
    }).then(loadClients);
  };

  const totalPages = Math.ceil(total / 50);

  return (
    <div>
      <div className="page-header"><h1>SFTP</h1></div>

      {/* ── SFTP Clients (links) ── */}
      <h3 style={{ marginTop: 0 }}>SFTP Clients</h3>
      <p style={{ fontSize: 13, color: '#666', marginTop: 0 }}>
        Link an SFTP username to a gateway client. Files dropped in that user's <code>in/</code> folder are
        submitted to Logiwa as the linked client; confirmations are written back to their <code>out/</code> folder.
      </p>

      <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input
          placeholder="SFTP username (e.g. graytools)"
          value={newUser}
          onChange={(e) => setNewUser(e.target.value)}
          style={{ padding: '6px 8px' }}
        />
        <select value={newTenant} onChange={(e) => setNewTenant(e.target.value)}>
          <option value="">Select client…</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <select value={newEnv} onChange={(e) => setNewEnv(e.target.value)}>
          <option value="sandbox">sandbox</option>
          <option value="production">production</option>
        </select>
        <button className="btn btn-sm" disabled={!newUser.trim() || !newTenant} onClick={linkClient}>
          Link SFTP client
        </button>
        {msg && (
          <span style={{ fontSize: 12, color: msg.startsWith('Linked') ? '#2e7d32' : '#c62828' }}>{msg}</span>
        )}
      </div>

      <div className="table-container">
        {clients.length === 0 ? (
          <div className="empty-state"><p>No SFTP clients linked yet.</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>SFTP User</th>
                <th>Client</th>
                <th>Environment</th>
                <th>Folder</th>
                <th>Enabled</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.sftp_username}>
                  <td style={{ fontFamily: 'monospace' }}>{c.sftp_username}</td>
                  <td>{c.tenant_name || c.tenant_id}</td>
                  <td><span className={`badge ${c.environment}`}>{c.environment}</span></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.r2_prefix}</td>
                  <td>{c.enabled ? 'Yes' : 'No'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" onClick={() => toggle(c.sftp_username, c.enabled)}>
                      {c.enabled ? 'Disable' : 'Enable'}
                    </button>{' '}
                    <button className="btn btn-sm" onClick={() => unlink(c.sftp_username)}>Unlink</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── File activity ── */}
      <h3 style={{ marginTop: 28 }}>File Activity</h3>
      <div className="toolbar">
        <div className="filters">
          <select value={filterClient} onChange={(e) => { setFilterClient(e.target.value); setPage(1); }}>
            <option value="">All Clients</option>
            {clients.map((c) => (
              <option key={c.sftp_username} value={c.sftp_username}>{c.sftp_username}</option>
            ))}
          </select>
          <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
            <option value="">All Statuses</option>
            <option value="received">Received</option>
            <option value="sent">Sent</option>
            <option value="confirmed">Confirmed</option>
            <option value="error">Error</option>
          </select>
          <button className="btn btn-sm" onClick={loadFiles}>Refresh</button>
        </div>
        <div style={{ fontSize: 13, color: '#888' }}>{total} files</div>
      </div>

      <div className="table-container">
        {loading ? (
          <div className="empty-state"><p>Loading...</p></div>
        ) : files.length === 0 ? (
          <div className="empty-state"><p>No SFTP files yet — waiting for a drop.</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>File</th>
                <th>Order Code</th>
                <th>Gateway Order</th>
                <th>Status</th>
                <th>Confirmation</th>
                <th>Error</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td>{f.sftp_username}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{f.file_name || '—'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{f.order_code || '—'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{f.gateway_order_id || '—'}</td>
                  <td><span className={`badge ${f.status}`}>{f.status}</span></td>
                  <td style={{ fontSize: 12 }}>{f.confirmation_key ? '✓ written' : '—'}</td>
                  <td style={{ fontSize: 12, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#c62828' }}>
                    {f.last_error || '—'}
                  </td>
                  <td>{formatDate(f.created_at)}</td>
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
