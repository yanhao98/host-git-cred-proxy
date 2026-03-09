import React, { useState, useEffect } from 'react';
import { adminClient, type BootstrapResponse } from './api';

import { Overview } from './pages/Overview';
import { Setup } from './pages/Setup';
import { Requests } from './pages/Requests';
import { Logs } from './pages/Logs';
import { Settings } from './pages/Settings';

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [bootstrapData, setBootstrapData] = useState<BootstrapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminClient.bootstrap()
      .then(data => {
        setBootstrapData(data);
      })
      .catch(err => {
        console.error('Failed to bootstrap', err);
        setError(err.message);
      });
  }, []);

  if (error) {
    return <div style={{ padding: '2rem', color: 'red' }}>Error loading panel: {error}</div>;
  }

  if (!bootstrapData) {
    return <div style={{ padding: '2rem' }}>Loading...</div>;
  }

  return (
    <div className="shell" data-testid="app-shell">
      <div className="sidebar">
        <div className="sidebar-header">
          host-git-cred-proxy
        </div>
        <div 
          className={`nav-link ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
          data-testid="nav-overview"
        >
          Overview
        </div>
        <div 
          className={`nav-link ${activeTab === 'setup' ? 'active' : ''}`}
          onClick={() => setActiveTab('setup')}
          data-testid="nav-setup"
        >
          Setup
        </div>
        <div 
          className={`nav-link ${activeTab === 'requests' ? 'active' : ''}`}
          onClick={() => setActiveTab('requests')}
          data-testid="nav-requests"
        >
          Requests
        </div>
        <div 
          className={`nav-link ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
          data-testid="nav-logs"
        >
          Logs
        </div>
        <div 
          className={`nav-link ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
          data-testid="nav-settings"
        >
          Settings
        </div>
      </div>
      <div className="content">
        {activeTab === 'overview' && <Overview bootstrapData={bootstrapData} />}
        {activeTab === 'setup' && <Setup bootstrapData={bootstrapData} />}
        {activeTab === 'requests' && <Requests />}
        {activeTab === 'logs' && <Logs />}
        {activeTab === 'settings' && <Settings bootstrapData={bootstrapData} onRefresh={() => window.location.reload()} />}
      </div>
    </div>
  );
}
