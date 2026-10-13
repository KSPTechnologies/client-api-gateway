import { useState, useEffect, Fragment } from 'react';
import { formatDate } from '../utils';

interface CallRow {
  id: string;
  endpoint: string;
  environment: string | null;
  shipment_order_code: string | null;
  shipment_order_identifier: string | null;
  speedee_order_id: string | null;
  is_successful: number | null;
  duration_ms: number | null;
  message: string | null;
  created_at: string;
}

interface CallDetail extends CallRow {
  request_json: string | null;
  response_json: string | null;
}

const EP_STYLE: Record<string, { bg: string; fg: string }> = {
  rate: { bg: '#e3f2fd', fg: '#1565c0' },
  create: { bg: '#e8f5e9', fg: '#2e7d32' },
  void: { bg: '#fff3e0', fg: '#e65100' },
  eod: { bg: '#ede7f6', fg: '#5e35b1' },
  token: { bg: '#eceff1', fg: '#455a64' },
  webhook: { bg: '#fce4ec', fg: '#ad1457' },
};

function EpBadge({ ep }: { ep: string }) {
  const s = EP_STYLE[ep] || EP_STYLE.token;
  return (
    <span style={{ background: s.bg, color: s.fg, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
      {ep}
    </span>
  );
}

export default function Speedee() {
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [fEndpoint, setFEndpoint] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CallDetail | null>(null);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (fEndpoint) params.set('endpoint', fEndpoint);
    if (fStatus) params.set('status', fStatus);
    if (q) params.set('q', q);
    fetch(`/api/speedee-log?${params}`)
      .then((r) => r.json())
      .then((d) => {
        const data = d as { calls: CallRow[]; total: number };
        setCalls(data.calls); setTotal(data.total); setLoading(false);
      });
  };

  useEffect(load, [page, fEndpoint, fStatus, q]);

  const toggle = (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    setDetail(null);
    fetch(`/api/speedee-log?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => setDetail(d as CallDetail));
  };

  const totalPages = Math.ceil(total / 50);
  const pre = { whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const, background: '#1e1e2e', color: '#cdd6f4', padding: 12, borderRadius: 6, fontSize: 12, maxHeight: 400, overflowY: 'auto' as const };

  return (
    <div>
      <div className="page-header"><h1>SpeeDee</h1></div>
      <p style={{ fontSize: 13, color: '#888', marginTop: -8, marginBottom: 16 }}>
        Every Logiwa custom-carrier call through the gateway's SpeeDee adapter — click a row for
        the full request and response (label data redacted). Shipment state lives in
        <b> speedee_orders</b>; this is the call history.
      </p>

      <div className="toolbar">
        <div className="filters" style={{ flexWrap: 'wrap', gap: 8 }}>
          <select value={fEndpoint} onChange={(e) => { setFEndpoint(e.target.value); setPage(1); }}>
            <option value="">All Endpoints</option>
            <option value="rate">Rate</option>
            <option value="create">Create</option>
            <option value="void">Void</option>
            <option value="eod">End of Day</option>
            <option value="token">Token</option>
            <option value="webhook">Webhook</option>
          </select>
          <select value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(1); }}>
            <option value="">All Results</option>
            <option value="ok">Success</option>
            <option value="fail">Failed</option>
          </select>
          <input
            placeholder="Search order code / SpeeDee ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setQ(search.trim()); setPage(1); } }}
            style={{ padding: '6px 8px', minWidth: 220 }}
          />
          <button className="btn btn-sm" onClick={() => { setQ(search.trim()); setPage(1); }}>Search</button>
          <button className="btn btn-sm" onClick={load}>Refresh</button>
        </div>
        <div style={{ fontSize: 13, color: '#888' }}>{total} calls</div>
      </div>

      <div className="table-container">
        {loading ? (
          <div className="empty-state"><p>Loading...</p></div>
        ) : calls.length === 0 ? (
          <div className="empty-state"><p>No SpeeDee calls yet — they appear as soon as Logiwa hits the adapter.</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Endpoint</th>
                <th>Env</th>
                <th>Order Code</th>
                <th>SpeeDee ID</th>
                <th>Result</th>
                <th>ms</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <Fragment key={c.id}>
                  <tr onClick={() => toggle(c.id)} style={{ cursor: 'pointer' }}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(c.created_at)}</td>
                    <td><EpBadge ep={c.endpoint} /></td>
                    <td style={{ fontSize: 12 }}>{c.environment || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{c.shipment_order_code || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{c.speedee_order_id || '—'}</td>
                    <td>
                      {c.is_successful === null ? <span style={{ color: '#888' }}>—</span> :
                        <span className={`badge ${c.is_successful ? 'sent' : 'error'}`}>{c.is_successful ? 'ok' : 'failed'}</span>}
                    </td>
                    <td style={{ fontSize: 12 }}>{c.duration_ms ?? '—'}</td>
                    <td style={{ fontSize: 12, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: c.is_successful === 0 ? '#c62828' : '#555' }}>
                      {c.message || '—'}
                    </td>
                  </tr>
                  {expandedId === c.id && (
                    <tr>
                      <td colSpan={8} style={{ background: '#fafafa', padding: '16px 24px' }}>
                        {!detail ? <p style={{ fontSize: 13 }}>Loading…</p> : (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Request (from Logiwa)</div>
                              <pre style={pre}>{detail.request_json || '(none)'}</pre>
                            </div>
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Response (from gateway)</div>
                              <pre style={pre}>{detail.response_json || '(none)'}</pre>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
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
