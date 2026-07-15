import { useState, useEffect } from 'react';
import { formatDate } from '../utils';

interface Ev {
  at: string;
  type: string;
  who: string;
  what: string;
  status: string;
  error: string | null;
  orderId: string | null;
}

interface CronRun {
  cron: string;
  last_run_at: string | null;
  last_status: string | null;
  detail: string | null;
}

// Expected max gap (minutes) before a cron is considered stale.
const CRON_EXPECTED: Record<string, number> = {
  'sftp-connector': 6,
  'tracking-sync': 35,
  'inventory-refresh': 130,
};

const TYPE_STYLE: Record<string, { bg: string; fg: string }> = {
  api: { bg: '#e3f2fd', fg: '#1565c0' },
  sftp: { bg: '#ede7f6', fg: '#5e35b1' },
  zoho: { bg: '#fff3e0', fg: '#e65100' },
};

function ageMinutes(utc: string | null): number | null {
  if (!utc) return null;
  const ms = Date.now() - Date.parse(utc.endsWith('Z') ? utc : utc + 'Z');
  return isNaN(ms) ? null : Math.round(ms / 60000);
}

export default function Activity() {
  const [events, setEvents] = useState<Ev[]>([]);
  const [crons, setCrons] = useState<CronRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);

  const load = () => {
    fetch('/api/activity')
      .then((r) => r.json())
      .then((d) => {
        const data = d as { events: Ev[]; crons: CronRun[] };
        setEvents(data.events || []);
        setCrons(data.crons || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    load();
    if (!auto) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [auto]);

  const shown = events
    .filter((e) => !typeFilter || e.type === typeFilter)
    .filter((e) => !errorsOnly || e.status === 'error');

  return (
    <div>
      <div className="page-header"><h1>Activity</h1></div>

      {/* Cron health strip */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        {['sftp-connector', 'tracking-sync', 'inventory-refresh'].map((name) => {
          const c = crons.find((x) => x.cron === name);
          const age = c ? ageMinutes(c.last_run_at) : null;
          const expected = CRON_EXPECTED[name] || 60;
          const stale = age === null || age > expected;
          const errored = c?.last_status === 'error';
          const color = stale ? '#c62828' : errored ? '#e65100' : '#2e7d32';
          const label = age === null ? 'never seen' : age < 1 ? 'just now' : `${age} min ago`;
          return (
            <div key={name} style={{ border: `1px solid ${color}33`, borderLeft: `4px solid ${color}`, borderRadius: 6, padding: '10px 14px', minWidth: 190, background: '#fff' }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{name}</div>
              <div style={{ fontSize: 13, color }}>{stale ? `STALE — last run ${label}` : errored ? `ran ${label} with errors` : `OK — ran ${label}`}</div>
              {errored && c?.detail && (
                <div style={{ fontSize: 11, color: '#888', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.detail}>{c.detail}</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="toolbar">
        <div className="filters" style={{ gap: 8 }}>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All Channels</option>
            <option value="api">API</option>
            <option value="sftp">SFTP</option>
            <option value="zoho">Zoho</option>
          </select>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> errors only
          </label>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> auto-refresh (15s)
          </label>
          <button className="btn btn-sm" onClick={load}>Refresh</button>
        </div>
        <div style={{ fontSize: 13, color: '#888' }}>{shown.length} events</div>
      </div>

      <div className="table-container">
        {loading ? (
          <div className="empty-state"><p>Loading...</p></div>
        ) : shown.length === 0 ? (
          <div className="empty-state"><p>No recent activity</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Channel</th>
                <th>Who</th>
                <th>Event</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e, i) => {
                const s = TYPE_STYLE[e.type] || TYPE_STYLE.api;
                return (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(e.at)}</td>
                    <td>
                      <span style={{ background: s.bg, color: s.fg, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>{e.type}</span>
                    </td>
                    <td style={{ fontSize: 13 }}>{e.who}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {e.status === 'error' ? '🔴 ' : ''}{e.what}
                    </td>
                    <td style={{ fontSize: 12, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#c62828' }} title={e.error || ''}>
                      {e.error || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
