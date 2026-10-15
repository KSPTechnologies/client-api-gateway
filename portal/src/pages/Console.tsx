import { useState, useEffect } from 'react';

interface Tenant { id: string; name: string; logiwa_environment: string; }

interface ConsoleResult {
  status: number;
  body: unknown;
  environment: string;
  tenantName: string;
  durationMs: number;
}

interface CallTemplate {
  label: string;
  method: 'GET' | 'POST';
  path: string;           // may contain {id}
  query?: string;
  body?: object;
  writes?: string;        // what a POST creates, for the confirm step
}

const TEMPLATES: CallTemplate[] = [
  { label: 'List orders', method: 'GET', path: '/v1/orders', query: 'page=1&size=10' },
  { label: 'List orders — changed since (incremental sync)', method: 'GET', path: '/v1/orders', query: 'UpdatedDateTime.bt=2026-10-01,2026-10-31' },
  { label: 'Get order', method: 'GET', path: '/v1/orders/{id}' },
  { label: 'Get tracking', method: 'GET', path: '/v1/orders/{id}/tracking' },
  {
    label: 'Create order', method: 'POST', path: '/v1/orders', writes: 'order',
    body: {
      code: 'EXAMPLE-001',
      customer: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
      shipmentAddress: { country: 'US', state: 'MN', addressLine1: '123 Main St', city: 'Minneapolis', postalCode: '55401', phoneNumber: '555-555-0100' },
      shipmentOrderLineList: [{ sku: 'SKU-HERE', packType: 'Unit', packQuantity: 1 }],
    },
  },
  { label: 'List inventory', method: 'GET', path: '/v1/inventory', query: 'page=1&size=25' },
  { label: 'Inventory availability (ATP)', method: 'GET', path: '/v1/inventory/availability', query: 'page=1&size=25' },
  { label: 'Query inventory by SKU', method: 'POST', path: '/v1/inventory/query', body: { skus: ['SKU-HERE'] } },
  { label: 'List products', method: 'GET', path: '/v1/products', query: 'page=1&size=25' },
  {
    label: 'Create product (SKU)', method: 'POST', path: '/v1/products', writes: 'product/SKU',
    body: { sku: 'EXAMPLE-SKU-001', name: 'Example Product', uomPackTypeName: 'Unit' },
  },
  { label: 'List purchase orders', method: 'GET', path: '/v1/purchase-orders', query: 'page=1&size=10' },
  {
    label: 'Create purchase order', method: 'POST', path: '/v1/purchase-orders', writes: 'purchase order',
    body: {
      code: 'EXAMPLE-PO-001',
      vendorName: 'Vendor Name Here',
      purchaseOrderLineList: [{ sku: 'SKU-HERE', packType: 'Unit', packQuantity: 10 }],
    },
  },
  { label: 'PO receipts', method: 'GET', path: '/v1/purchase-orders/{id}/receipts' },
];

export default function Console() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [tplIdx, setTplIdx] = useState(0);
  const [pathId, setPathId] = useState('');
  const [query, setQuery] = useState(TEMPLATES[0].query || '');
  const [bodyText, setBodyText] = useState('');
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ConsoleResult | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/tenants').then((r) => r.json()).then((d) => setTenants(d as Tenant[]));
  }, []);

  const tpl = TEMPLATES[tplIdx];
  const tenant = tenants.find((t) => t.id === tenantId);
  const env = tenant?.logiwa_environment || '';
  const isProd = env === 'production';
  const resolvedPath = tpl.path.replace('{id}', pathId || '{id}');

  const pickTemplate = (i: number) => {
    setTplIdx(i);
    setQuery(TEMPLATES[i].query || '');
    setBodyText(TEMPLATES[i].body ? JSON.stringify(TEMPLATES[i].body, null, 2) : '');
    setResult(null);
    setError('');
    setConfirming(false);
  };

  const send = async () => {
    setError('');
    setCopied(false);
    if (!tenantId) { setError('Pick a client first.'); return; }
    if (tpl.path.includes('{id}') && !pathId.trim()) { setError('This call needs an order/PO code or id in the path field.'); return; }
    let parsedBody: unknown;
    if (tpl.method === 'POST') {
      try { parsedBody = JSON.parse(bodyText || '{}'); }
      catch (e) { setError(`Body is not valid JSON: ${e instanceof Error ? e.message : e}`); return; }
      if (!confirming) { setConfirming(true); return; }
    }
    setConfirming(false);
    setSending(true);
    setResult(null);
    try {
      const res = await fetch('/api/console', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          method: tpl.method,
          path: resolvedPath,
          query: query.trim() || undefined,
          body: tpl.method === 'POST' ? parsedBody : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) setError((data as any)?.error || `Console call failed (${res.status})`);
      else setResult(data as ConsoleResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setSending(false);
  };

  const copyExample = async () => {
    if (!result) return;
    const url = `https://connect.ksp3plhq.com${resolvedPath}${query.trim() ? `?${query.trim()}` : ''}`;
    const lines = [
      `KSP Gateway API example — ${tpl.label}`,
      `Environment: ${result.environment}    Captured: ${new Date().toISOString()}`,
      '',
      `${tpl.method} ${url}`,
      `X-API-Key: <your-api-key>`,
      `Content-Type: application/json`,
    ];
    if (tpl.method === 'POST') lines.push('', 'Request body:', bodyText);
    lines.push('', `Response (HTTP ${result.status}):`, JSON.stringify(result.body, null, 2));
    lines.push('', 'cURL:',
      `curl -X ${tpl.method} "${url}" -H "X-API-Key: <your-api-key>" -H "Content-Type: application/json"` +
      (tpl.method === 'POST' ? ` -d '${(bodyText || '{}').replace(/\n\s*/g, ' ')}'` : ''));
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { setError('Clipboard copy failed — select and copy from the response panel.'); }
  };

  const pre = { whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const, background: '#1e1e2e', color: '#cdd6f4', padding: 12, borderRadius: 6, fontSize: 12, maxHeight: 480, overflowY: 'auto' as const };

  return (
    <div>
      <div className="page-header"><h1>API Console</h1></div>
      <p style={{ fontSize: 13, color: '#888', marginTop: -8, marginBottom: 16 }}>
        Run gateway calls <b>as a client</b> — no API key involved; the call executes through the
        real pipeline (mappings, validation, endpoint enforcement), so responses are exactly what
        the client's dev will see. POSTs create <b>real records</b> and require a confirm. Every
        call is logged with your email.
      </p>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: 13 }}>
            Act as client
            <select value={tenantId} onChange={(e) => { setTenantId(e.target.value); setConfirming(false); }} style={{ display: 'block', minWidth: 200 }}>
              <option value="">Select…</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          {tenant && (
            <span className={`badge ${isProd ? 'error' : 'received'}`} style={{ marginBottom: 4 }}>
              {env.toUpperCase()}
            </span>
          )}
          <label style={{ fontSize: 13 }}>
            Call
            <select value={tplIdx} onChange={(e) => pickTemplate(parseInt(e.target.value))} style={{ display: 'block', minWidth: 300 }}>
              {TEMPLATES.map((t, i) => <option key={t.label} value={i}>{t.method} — {t.label}</option>)}
            </select>
          </label>
          {tpl.path.includes('{id}') && (
            <label style={{ fontSize: 13 }}>
              Order/PO code or id
              <input value={pathId} onChange={(e) => setPathId(e.target.value)} style={{ display: 'block', minWidth: 180 }} placeholder="e.g. SO0019" />
            </label>
          )}
        </div>

        <div style={{ marginTop: 10, fontFamily: 'monospace', fontSize: 13, color: '#555' }}>
          {tpl.method} https://connect.ksp3plhq.com{resolvedPath}{query.trim() ? `?${query.trim()}` : ''}
        </div>

        <label style={{ fontSize: 13, display: 'block', marginTop: 10 }}>
          Query string (optional)
          <input value={query} onChange={(e) => setQuery(e.target.value)} style={{ display: 'block', width: '100%', fontFamily: 'monospace' }}
            placeholder="e.g. UpdatedDateTime.bt=2026-10-01,2026-10-31" />
        </label>

        {tpl.method === 'POST' && (
          <label style={{ fontSize: 13, display: 'block', marginTop: 10 }}>
            Request body (JSON)
            <textarea value={bodyText} onChange={(e) => { setBodyText(e.target.value); setConfirming(false); }}
              rows={12} style={{ display: 'block', width: '100%', fontFamily: 'monospace', fontSize: 12 }} />
          </label>
        )}

        {confirming && tenant && (
          <div style={{ marginTop: 12, padding: 10, background: isProd ? '#fdecea' : '#fff8e1', border: `1px solid ${isProd ? '#c62828' : '#f9a825'}`, borderRadius: 6, fontSize: 13 }}>
            ⚠️ This creates a <b>REAL {tpl.writes || 'record'}</b> for <b>{tenant.name}</b> in{' '}
            <b style={{ color: isProd ? '#c62828' : '#795548' }}>{env.toUpperCase()}</b>
            {isProd ? ' — the warehouse can see and act on it.' : ' (sandbox).'} Click Send again to proceed.
          </div>
        )}

        <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn btn-primary" disabled={sending} onClick={send}>
            {sending ? 'Sending…' : confirming ? 'Send — confirmed' : 'Send'}
          </button>
          {result && (
            <button className="btn" onClick={copyExample}>{copied ? '✓ Copied' : 'Copy as example'}</button>
          )}
          {error && <span style={{ color: '#c62828', fontSize: 13 }}>{error}</span>}
        </div>
      </div>

      {result && (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            <span className={`badge ${result.status < 300 ? 'sent' : 'error'}`}>HTTP {result.status}</span>
            {' '}<b>{result.tenantName}</b> · {result.environment} · {result.durationMs}ms
          </div>
          <pre style={pre}>{JSON.stringify(result.body, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
