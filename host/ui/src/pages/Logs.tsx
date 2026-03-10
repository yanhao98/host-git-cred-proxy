import React, { useState, useEffect } from 'react';
import { adminClient, type LogsResponse } from '../api';

export function Logs() {
  const [logs, setLogs] = useState<LogsResponse>({ lines: [], truncated: false });

  useEffect(() => {
    let mounted = true;
    const fetchLogs = () => {
      adminClient.getLogs()
        .then(data => {
          if (mounted) setLogs(data);
        })
        .catch(console.error);
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div>
      <h1 className="page-title">Logs</h1>
      <div className="card">
        {logs.lines.length === 0 ? (
          <p data-testid="logs-empty" style={{ color: 'var(--color-text-muted)' }}>
            No logs available yet.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ position: 'relative' }}>
              <pre data-testid="logs-view" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {logs.lines.join('\n')}
              </pre>
            </div>
            {logs.truncated && (
              <p data-testid="logs-truncated" style={{ color: '#d97706', fontSize: '13px', margin: 0, marginTop: '8px' }}>
                ⚠ Logs truncated to the newest lines
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
