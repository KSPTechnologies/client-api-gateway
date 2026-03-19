import { useState } from 'react';
import Dashboard from './pages/Dashboard';
import Tenants from './pages/Tenants';
import ApiKeys from './pages/ApiKeys';
import Orders from './pages/Orders';
import Errors from './pages/Errors';
import './App.css';

type Page = 'dashboard' | 'tenants' | 'api-keys' | 'orders' | 'errors';

function App() {
  const [page, setPage] = useState<Page>('dashboard');

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-header">
          <h2>API Gateway</h2>
        </div>
        <ul>
          <li className={page === 'dashboard' ? 'active' : ''} onClick={() => setPage('dashboard')}>Dashboard</li>
          <li className={page === 'tenants' ? 'active' : ''} onClick={() => setPage('tenants')}>Tenants</li>
          <li className={page === 'api-keys' ? 'active' : ''} onClick={() => setPage('api-keys')}>API Keys</li>
          <li className={page === 'orders' ? 'active' : ''} onClick={() => setPage('orders')}>Orders</li>
          <li className={page === 'errors' ? 'active' : ''} onClick={() => setPage('errors')}>Errors</li>
        </ul>
      </nav>
      <main className="content">
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
