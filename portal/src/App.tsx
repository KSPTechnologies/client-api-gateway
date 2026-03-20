import { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard';
import Tenants from './pages/Tenants';
import ApiKeys from './pages/ApiKeys';
import Orders from './pages/Orders';
import Errors from './pages/Errors';
import './App.css';

type Page = 'dashboard' | 'tenants' | 'api-keys' | 'orders' | 'errors';
type LogiwaEnv = 'sandbox' | 'production';

function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [logiwaEnv, setLogiwaEnv] = useState<LogiwaEnv>('sandbox');
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    fetch('/api/environment')
      .then((r) => r.json())
      .then((d) => setLogiwaEnv((d as { environment: LogiwaEnv }).environment))
      .catch(() => {});
  }, []);

  const toggleEnvironment = async () => {
    const newEnv: LogiwaEnv = logiwaEnv === 'sandbox' ? 'production' : 'sandbox';

    if (newEnv === 'production') {
      if (!confirm('Switch to PRODUCTION? All API requests will hit the live Logiwa system.')) return;
    }

    setSwitching(true);
    const res = await fetch('/api/environment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment: newEnv }),
    });
    if (res.ok) {
      setLogiwaEnv(newEnv);
    }
    setSwitching(false);
  };

  const isSandbox = logiwaEnv === 'sandbox';

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-header">
          <h2>API Gateway</h2>
        </div>
        <ul>
          <li className={page === 'dashboard' ? 'active' : ''} onClick={() => setPage('dashboard')}>Dashboard</li>
          <li className={page === 'tenants' ? 'active' : ''} onClick={() => setPage('tenants')}>Clients</li>
          <li className={page === 'api-keys' ? 'active' : ''} onClick={() => setPage('api-keys')}>API Keys</li>
          <li className={page === 'orders' ? 'active' : ''} onClick={() => setPage('orders')}>Orders</li>
          <li className={page === 'errors' ? 'active' : ''} onClick={() => setPage('errors')}>Errors</li>
        </ul>
        <div className="env-toggle">
          <div className="env-label">Logiwa Environment</div>
          <button
            className={`env-switch ${isSandbox ? 'sandbox' : 'production'}`}
            onClick={toggleEnvironment}
            disabled={switching}
          >
            <span className="env-dot" />
            <span className="env-text">{switching ? 'Switching...' : logiwaEnv.toUpperCase()}</span>
          </button>
        </div>
      </nav>
      <main className="content">
        {!isSandbox && (
          <div className="prod-banner">PRODUCTION — Requests are hitting the live Logiwa system</div>
        )}
        {page === 'dashboard' && <Dashboard />}
        {page === 'tenants' && <Tenants />}
        {page === 'api-keys' && <ApiKeys />}
        {page === 'orders' && <Orders />}
        {page === 'errors' && <Errors />}
      </main>
    </div>
  );
}

export default App;
