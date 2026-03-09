import React, { useState, useEffect } from 'react';
import { adminClient } from '../api';

export function Logs() {
  const [logs, setLogs] = useState<{ lines: string[], truncated: boolean }>({ lines: [], truncated: false });

  useEffect(() => {
    const fetchLogs = () => adminClient.getLogs().then(setLogs).catch(console.error);
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <h1 className="page-title">Logs</h1>
      <div className="card">
        {logs.truncated && <p style={{ color: 'var(--color-text-muted)' }}>Logs truncated</p>}
        <pre data-testid="logs-view" style={{ whiteSpace: 'pre-wrap' }}>
          {logs.lines.join('\n') || 'No logs available'}
        </pre>
      </div>
    </div>
  );
}
