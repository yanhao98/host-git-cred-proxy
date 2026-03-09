import React, { useState, useEffect } from 'react';
import { adminClient, type BootstrapResponse, type StatusResponse } from '../api';

export function Overview({ bootstrapData }: { bootstrapData: BootstrapResponse }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    adminClient.getStatus().then(setStatus).catch(console.error);
  }, []);

  const d = bootstrapData.derived;
  
  return (
    <div>
      <h1 className="page-title">Overview</h1>
      
      <div className="card">
        <h3>Service Status</h3>
        <p>Status: <span data-testid="overview-status">{status?.running ? 'Running' : 'Stopped'}</span></p>
        <p>Listen URL: <code data-testid="overview-listen-url">{d.listenUrl}</code></p>
        <p>Public URL: <code data-testid="overview-public-url">{d.publicUrl}</code></p>
        <p>State Dir: <code data-testid="overview-state-dir">{d.stateDir}</code></p>
      </div>
    </div>
  );
}
