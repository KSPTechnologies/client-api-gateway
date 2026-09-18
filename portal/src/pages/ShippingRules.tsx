import { useState, useEffect } from 'react';

interface Replacement {
  shippingOptionName?: string;
  carrierName?: string;
  carrierSetupName?: string;
  isSetUnmatchedShippingOptionAsRequested?: boolean;
}

interface Rule {
  tenant_id: string;
  tenant_name: string;
  match_setup_name: string;
  match_option_name: string | null;
  replacement: Replacement;
  enabled: number;
  created_at: string;
}

interface Tenant {
  id: string;
  name: string;
}

const emptyForm = {
  tenant_id: '',
  match_setup_name: '',
  match_option_name: '',
  shipping_option_name: '',
  carrier_name: '',
  carrier_setup_name: '',
  unmatched_as_requested: true,
  enabled: true,
};

export default function ShippingRules() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    fetch('/api/shipping-mappings')
      .then((r) => r.json())
      .then((d) => { setRules(d as Rule[]); setLoading(false); });
  };

  useEffect(() => {
    fetch('/api/tenants')
      .then((r) => r.json())
      .then((d) => setTenants(d as Tenant[]));
    load();
  }, []);

  const save = async () => {
    setError('');
    setSaving(true);
    const res = await fetch('/api/shipping-mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setError(b.error || `Save failed (${res.status})`);
      return;
    }
    setShowForm(false);
    setForm({ ...emptyForm });
    load();
  };

  const editRule = (r: Rule) => {
    setForm({
      tenant_id: r.tenant_id,
      match_setup_name: r.match_setup_name,
      match_option_name: r.match_option_name || '',
      shipping_option_name: r.replacement.shippingOptionName || '',
      carrier_name: r.replacement.carrierName || '',
      carrier_setup_name: r.replacement.carrierSetupName || '',
      unmatched_as_requested: !!r.replacement.isSetUnmatchedShippingOptionAsRequested,
      enabled: !!r.enabled,
    });
    setShowForm(true);
  };

  const toggleRule = async (r: Rule) => {
    await fetch('/api/shipping-mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: r.tenant_id,
        match_setup_name: r.match_setup_name,
        match_option_name: r.match_option_name || '',
        shipping_option_name: r.replacement.shippingOptionName || '',
        carrier_name: r.replacement.carrierName || '',
        carrier_setup_name: r.replacement.carrierSetupName || '',
        unmatched_as_requested: !!r.replacement.isSetUnmatchedShippingOptionAsRequested,
        enabled: !r.enabled,
      }),
    });
    load();
  };

  const removeRule = async (r: Rule) => {
    if (!window.confirm(`Delete the ${r.tenant_name} rule for setup "${r.match_setup_name}"?`)) return;
    await fetch(`/api/shipping-mappings?tenant_id=${encodeURIComponent(r.tenant_id)}&match_setup_name=${encodeURIComponent(r.match_setup_name)}`, {
      method: 'DELETE',
    });
    load();
  };

  return (
    <div>
      <div className="page-header">
        <h1>Shipping Rules</h1>
        <button className="btn btn-primary" onClick={() => { setForm({ ...emptyForm }); setShowForm(!showForm); }}>
          {showForm ? 'Cancel' : '+ Add Rule'}
        </button>
      </div>

      <p style={{ fontSize: 13, color: '#888', marginTop: -8, marginBottom: 16 }}>
        Rewrites a client's shipping option before the order reaches Logiwa. A rule matches on the
        incoming <b>carrier setup name</b> (plus the <b>option name</b>, if set — leave it blank to match
        every option under that setup) and substitutes the configured Logiwa values. Matching is
        case-insensitive. One rule per client + setup name.
      </p>

      {showForm && (
        <div className="card" style={{ marginBottom: 20, padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}>
              Client
              <select value={form.tenant_id} onChange={(e) => setForm({ ...form, tenant_id: e.target.value })} style={{ width: '100%' }}>
                <option value="">Select…</option>
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              Match: carrier setup name
              <input value={form.match_setup_name} placeholder="e.g. Cheapest" onChange={(e) => setForm({ ...form, match_setup_name: e.target.value })} style={{ width: '100%' }} />
            </label>
            <label style={{ fontSize: 13 }}>
              Match: option name (optional)
              <input value={form.match_option_name} placeholder="blank = any option" onChange={(e) => setForm({ ...form, match_option_name: e.target.value })} style={{ width: '100%' }} />
            </label>
            <label style={{ fontSize: 13 }}>
              Send: shipping option name
              <input value={form.shipping_option_name} placeholder="e.g. ALL-GRAY" onChange={(e) => setForm({ ...form, shipping_option_name: e.target.value })} style={{ width: '100%' }} />
            </label>
            <label style={{ fontSize: 13 }}>
              Send: carrier name
              <input value={form.carrier_name} placeholder="e.g. Cheapest" onChange={(e) => setForm({ ...form, carrier_name: e.target.value })} style={{ width: '100%' }} />
            </label>
            <label style={{ fontSize: 13 }}>
              Send: carrier setup name
              <input value={form.carrier_setup_name} placeholder="e.g. Cheapest" onChange={(e) => setForm({ ...form, carrier_setup_name: e.target.value })} style={{ width: '100%' }} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 24, marginTop: 12, alignItems: 'center' }}>
            <label style={{ fontSize: 13 }}>
              <input type="checkbox" checked={form.unmatched_as_requested} onChange={(e) => setForm({ ...form, unmatched_as_requested: e.target.checked })} />
              {' '}If Logiwa can't match, accept the order anyway (shipping shows "requested" — safer, but needs a manual carrier assignment)
            </label>
            <label style={{ fontSize: 13 }}>
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
              {' '}Enabled
            </label>
            <button className="btn btn-primary btn-sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save Rule'}</button>
            {error && <span style={{ color: '#c62828', fontSize: 13 }}>{error}</span>}
          </div>
        </div>
      )}

      <div className="table-container">
        {loading ? (
          <div className="empty-state"><p>Loading...</p></div>
        ) : rules.length === 0 ? (
          <div className="empty-state"><p>No shipping rules configured.</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Matches (setup / option)</th>
                <th>Sends to Logiwa (option / carrier / setup)</th>
                <th>Unmatched</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={`${r.tenant_id}:${r.match_setup_name}`} style={{ opacity: r.enabled ? 1 : 0.5 }}>
                  <td>{r.tenant_name || r.tenant_id}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 13 }}>
                    {r.match_setup_name} / {r.match_option_name || <span style={{ color: '#888' }}>any</span>}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: 13 }}>
                    {r.replacement.shippingOptionName} / {r.replacement.carrierName} / {r.replacement.carrierSetupName}
                  </td>
                  <td style={{ fontSize: 13 }}>
                    {r.replacement.isSetUnmatchedShippingOptionAsRequested ? 'accept as requested' : 'reject order'}
                  </td>
                  <td><span className={`badge ${r.enabled ? 'sent' : 'error'}`}>{r.enabled ? 'enabled' : 'disabled'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" onClick={() => editRule(r)}>Edit</button>{' '}
                    <button className="btn btn-sm" onClick={() => toggleRule(r)}>{r.enabled ? 'Disable' : 'Enable'}</button>{' '}
                    <button className="btn btn-sm" onClick={() => removeRule(r)}>Delete</button>
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
