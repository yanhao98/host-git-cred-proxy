import React, { useState, useEffect } from 'react';
import { adminClient, type BootstrapResponse } from './api';

import { Overview } from './pages/Overview';
import { Setup } from './pages/Setup';
import { Requests } from './pages/Requests';
import { Logs } from './pages/Logs';
import { Settings } from './pages/Settings';

const TABS = ['overview', 'setup', 'requests', 'logs', 'settings'] as const;

function getTabFromHash(): string {
  const hash = window.location.hash.replace('#', '');
  return TABS.includes(hash as any) ? hash : 'overview';
}

export default function App() {
  const [activeTab, setActiveTab] = useState(getTabFromHash);
  const [bootstrapData, setBootstrapData] = useState<BootstrapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const switchTab = (tab: string) => {
    setActiveTab(tab);
    window.location.hash = tab;
  };

  useEffect(() => {
    const onHashChange = () => setActiveTab(getTabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

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
    return <div style={{ padding: '2rem', color: 'red' }}>加载面板失败：{error}</div>;
  }

  if (!bootstrapData) {
    return <div style={{ padding: '2rem' }}>加载中...</div>;
  }

  return (
    <div className="shell" data-testid="app-shell">
      <div className="sidebar">
        <div className="sidebar-header">
          host-git-cred-proxy
        </div>
        <div
          className={`nav-link ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => switchTab('overview')}
          data-testid="nav-overview"
        >
          概览
        </div>
        <div
          className={`nav-link ${activeTab === 'setup' ? 'active' : ''}`}
          onClick={() => switchTab('setup')}
          data-testid="nav-setup"
        >
          接入
        </div>
        <div
          className={`nav-link ${activeTab === 'requests' ? 'active' : ''}`}
          onClick={() => switchTab('requests')}
          data-testid="nav-requests"
        >
          请求
        </div>
        <div
          className={`nav-link ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => switchTab('logs')}
          data-testid="nav-logs"
        >
          日志
        </div>
        <div
          className={`nav-link ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => switchTab('settings')}
          data-testid="nav-settings"
        >
          设置
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
