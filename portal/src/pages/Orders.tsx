import { useState, useEffect, Fragment } from 'react';
import { formatDate } from '../utils';

interface Order {
  id: string;
  tenant_id: string;
  tenant_name: string;
  external_order_id: string | null;
  logiwa_order_id: string | null;
  status: string;
  source: 'api' | 'sftp' | 'zoho';
  sftp_file: string | null;
  sftp_confirmation: string | null;
  zoho_record: string | null;
  zoho_writeback: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface Tenant { id: string; name: string; }

interface TimelineEntry { at: string | null; label: string; detail: string; }

interface OrderDetail {
  order: Record<string, unknown>;
  source: string;
  timeline: TimelineEntry[];
  requestPayload: string | null;
  responsePayload: string | null;
  payloadsAvailable: boolean;
}

const SOURCE_STYLE: Record<string, { bg: string; fg: string }> = {
  api: { bg: '#e3f2fd', fg: '#1565c0' },
  sftp: { bg: '#ede7f6', fg: '#5e35b1' },
  zoho: { bg: '#fff3e0', fg: '#e65100' },
};

function SourceBadge({ source }: { source: string }) {
  const s = SOURCE_STYLE[source] || SOURCE_STYLE.api;
  return (
    <span style={{ background: s.bg, color: s.fg, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
      {source}
    </span>
  );
}

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filterTenant, setFilterTenant] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, OrderDetail | 'loading'>>({});
  const [showPayload, setShowPayload] = useState<Record<string, boolean>>({});

  const loadOrders = () => {
    setLoading(true);
    const params = new URLSearchParams({ page: page.toString() });
    if (filterTenant) params.set('tenant_id', filterTenant);
    if (filterStatus) params.set('status', filterStatus);
    if (filterSource) params.set('source', filterSource);
    if (q) params.set('q', q);

    fetch(`/api/orders?${params}`)
      .then((r) => r.json())
      .then((d) => {
        const data = d as { orders: Order[]; total: number };
        setOrders(data.orders);
        setTotal(data.total);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetch('/api/tenants')
      .then((r) => r.json())
      .then((d) => setTenants(d as Tenant[]));
  }, []);

  useEffect(loadOrders, [page, filterTenant, filterStatus, filterSource, q]);

  const toggleExpand = (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!details[id]) {
      setDetails((m) => ({ ...m, [id]: 'loading' }));
      fetch(`/api/order-detail?id=${encodeURIComponent(id)}`)
        .then((r) => r.json())
        .then((d) => setDetails((m) => ({ ...m, [id]: d as OrderDetail })));
    }
  };

  const totalPages = Math.ceil(total / 50);

  return (
    <div>
      <div className="page-header"><h1>Orders</h1></div>

      <div className="toolbar">
        <div className="filters" style={{ flexWrap: 'wrap', gap: 8 }}>
          <select value={filterTenant} onChange={(e) => { setFilterTenant(e.target.value); setPage(1); }}>
            <option value="">All Clients</option>
            {tenants.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
          </select>
          <select value={filterSource} onChange={(e) => { setFilterSource(e.target.value); setPage(1); }}>
            <option value="">All Sources</option>
            <option value="api">API</option>
            <option value="sftp">SFTP</option>
            <option value="zoho">Zoho</option>
          </select>
          <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
            <option value="">All Statuses</option>
            <option value="received">Received</option>
            <option value="sent">Sent</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="closed">Closed</option>
            <option value="error">Error</option>
          </select>
          <input
            placeholder="Search order code / id…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setQ(search.trim()); setPage(1); } }}
            style={{ padding: '6px 8px', minWidth: 200 }}
          />
          <button className="btn btn-sm" onClick={() => { setQ(search.trim()); setPage(1); }}>Search</button>
          <button className="btn btn-sm" onClick={loadOrders}>Refresh</button>
        </div>
        <div style={{ fontSize: 13, color: '#888' }}>{total} orders</div>
      </div>

      <div className="table-container">
        {loading ? (
          <div className="empty-state"><p>Loading...</p></div>
        ) : orders.length === 0 ? (
          <div className="empty-state"><p>No orders found</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Code</th>
                <th>Source</th>
                <th>Logiwa ID</th>
                <th>Status</th>
                <th>Error</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <Fragment key={o.id}>
                  <tr onClick={() => toggleExpand(o.id)} style={{ cursor: 'pointer' }}>
                    <td>{o.tenant_name}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{o.external_order_id || '—'}</td>
                    <td><SourceBadge source={o.source} /></td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{o.logiwa_order_id ? o.logiwa_order_id.slice(0, 13) + '…' : '—'}</td>
                    <td><span className={`badge ${o.status}`}>{o.status}</span></td>
                    <td style={{ fontSize: 12, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#c62828' }}>
                      {o.last_error || '—'}
                    </td>
                    <td>{formatDate(o.created_at)}</td>
                  </tr>
                  {expandedId === o.id && (
                    <tr>
                      <td colSpan={7} style={{ background: '#fafafa', padding: '16px 24px' }}>
                        {details[o.id] === 'loading' || !details[o.id] ? (
                          <p style={{ fontSize: 13 }}>Loading detail…</p>
                        ) : (
                          (() => {
                            const d = details[o.id] as OrderDetail;
                            return (
                              <div style={{ fontSize: 13 }}>
                                <div style={{ marginBottom: 10 }}>
                                  <strong>Gateway order:</strong> <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{o.id}</span>
                                  {o.logiwa_order_id && (<>
                                    {' '}· <strong>Logiwa:</strong> <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{o.logiwa_order_id}</span>
                                  </>)}
                                </div>
                                <strong>Timeline</strong>
                                <ul style={{ margin: '6px 0 12px', paddingLeft: 18 }}>
                                  {d.timeline.map((t, i) => (
                                    <li key={i} style={{ marginBottom: 3 }}>
                                      <span style={{ color: '#888' }}>{t.at ? formatDate(t.at) : ''}</span>{' '}
                                      <strong>{t.label}</strong> — {t.detail}
                                    </li>
                                  ))}
                                </ul>
                                {o.last_error && (
                                  <div style={{ background: '#fdecea', border: '1px solid #f5c6c2', borderRadius: 6, padding: '8px 12px', marginBottom: 12, whiteSpace: 'pre-wrap', fontSize: 12 }}>
                                    {o.last_error}
                                  </div>
                                )}
                                {d.payloadsAvailable ? (
                                  <div style={{ display: 'flex', gap: 8 }}>
                                    {d.requestPayload && (
                                      <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setShowPayload((m) => ({ ...m, [o.id + ':req']: !m[o.id + ':req'] })); }}>
                                        {showPayload[o.id + ':req'] ? 'Hide' : 'Show'} request payload
                                      </button>
                                    )}
                                    {d.responsePayload && (
                                      <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setShowPayload((m) => ({ ...m, [o.id + ':res']: !m[o.id + ':res'] })); }}>
                                        {showPayload[o.id + ':res'] ? 'Hide' : 'Show'} Logiwa response
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <p style={{ fontSize: 12, color: '#999' }}>Raw payloads unavailable (R2 binding not active yet).</p>
                                )}
                                {showPayload[o.id + ':req'] && d.requestPayload && (
                                  <pre style={{ background: '#1a1a2e', color: '#a0e0a0', padding: 12, borderRadius: 6, fontSize: 11, overflowX: 'auto', marginTop: 8 }}>{d.requestPayload}</pre>
                                )}
                                {showPayload[o.id + ':res'] && d.responsePayload && (
                                  <pre style={{ background: '#1a1a2e', color: '#a0c0e0', padding: 12, borderRadius: 6, fontSize: 11, overflowX: 'auto', marginTop: 8 }}>{d.responsePayload}</pre>
                                )}
                              </div>
                            );
                          })()
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
