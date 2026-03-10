import React, { useState, useEffect } from 'react';
import { adminClient, type BootstrapResponse, type StatusResponse } from '../api';

export function Overview({ bootstrapData }: { bootstrapData: BootstrapResponse }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    adminClient.getStatus().then(setStatus).catch(console.error);
  }, []);

  const d = bootstrapData.derived;
  const config = bootstrapData.config;
  
  return (
    <div>
      <h1 className="page-title">Overview</h1>
      
      <div className="card">
        <h3>Service Status</h3>
        <p>Status: <span data-testid="overview-status" className={`status-badge ${status?.running ? 'status-running' : 'status-stopped'}`}>{status?.running ? 'Running' : 'Stopped'}</span></p>
        <p>Latest Start Time: <span data-testid="overview-start-time">{status?.startedAt ? new Date(status.startedAt).toLocaleString() : 'N/A'}</span></p>
      </div>

      <div className="card">
        <h3>Network endpoints</h3>
        <p>Listen URL: <code data-testid="overview-listen-url">{d.listenUrl}</code></p>
        <p>Container / Public URL: <code data-testid="overview-public-url">{d.publicUrl}</code></p>
      </div>

      <div className="card">
        <h3>Security Configuration</h3>
        <p>Protocol Whitelist: <code data-testid="overview-protocol-whitelist">{config.protocols.join(', ')}</code></p>
        <p>Host Whitelist: <code data-testid="overview-host-whitelist">{config.allowedHosts.length > 0 ? config.allowedHosts.join(', ') : 'All hosts allowed'}</code></p>
      </div>

      <div className="card">
        <h3>Local State</h3>
        <p>State Dir: <code data-testid="overview-state-dir">{d.stateDir}</code></p>
        <p>Token File Path: <code data-testid="overview-token-file-path">{d.tokenFilePath}</code></p>
      </div>
    </div>
  );
}
