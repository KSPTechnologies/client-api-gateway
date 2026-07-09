import { useState, useEffect } from 'react';
import { formatDate } from '../utils';

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

interface SftpClientRow {
  sftp_username: string;
  enabled: number;
}

export default function Sftp() {
  const [files, setFiles] = useState<SftpFile[]>([]);
  const [clients, setClients] = useState<SftpClientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filterClient, setFilterClient] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ page: page.toString() });
    if (filterClient) params.set('client', filterClient);
    if (filterStatus) params.set('status', filterStatus);

    fetch(`/api/sftp?${params}`)
      .then((r) => r.json())
      .then((d) => {
        const data = d as { files: SftpFile[]; clients: SftpClientRow[]; total: number };
        setFiles(data.files);
        setClients(data.clients || []);
        setTotal(data.total);
        setLoading(false);
      });
  };

  useEffect(load, [page, filterClient, filterStatus]);

  const totalPages = Math.ceil(total / 50);

  return (
    <div>
      <div className="page-header"><h1>SFTP</h1></div>

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
          <button className="btn btn-sm" onClick={load}>Refresh</button>
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
