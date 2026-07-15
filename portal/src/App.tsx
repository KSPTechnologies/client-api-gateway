import { useState } from 'react';
import Dashboard from './pages/Dashboard';
import Activity from './pages/Activity';
import Tenants from './pages/Tenants';
import ApiKeys from './pages/ApiKeys';
import Orders from './pages/Orders';
import Errors from './pages/Errors';
import Zoho from './pages/Zoho';
import Sftp from './pages/Sftp';
import './App.css';

type Page = 'dashboard' | 'activity' | 'tenants' | 'api-keys' | 'orders' | 'errors' | 'zoho' | 'sftp';

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
          <li className={page === 'activity' ? 'active' : ''} onClick={() => setPage('activity')}>Activity</li>
          <li className={page === 'tenants' ? 'active' : ''} onClick={() => setPage('tenants')}>Clients</li>
          <li className={page === 'api-keys' ? 'active' : ''} onClick={() => setPage('api-keys')}>API Keys</li>
          <li className={page === 'orders' ? 'active' : ''} onClick={() => setPage('orders')}>Orders</li>
          <li className={page === 'errors' ? 'active' : ''} onClick={() => setPage('errors')}>Errors</li>
          <li className={page === 'zoho' ? 'active' : ''} onClick={() => setPage('zoho')}>Zoho</li>
          <li className={page === 'sftp' ? 'active' : ''} onClick={() => setPage('sftp')}>SFTP</li>
        </ul>
      </nav>
      <main className="content">
        {page === 'dashboard' && <Dashboard />}
        {page === 'activity' && <Activity />}
        {page === 'tenants' && <Tenants />}
        {page === 'api-keys' && <ApiKeys />}
        {page === 'orders' && <Orders />}
        {page === 'errors' && <Errors />}
        {page === 'zoho' && <Zoho />}
        {page === 'sftp' && <Sftp />}
      </main>
    </div>
  );
}

export default App;
