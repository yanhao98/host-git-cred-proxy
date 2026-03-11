import React, { useState, useEffect } from 'react';
import { adminClient, type RequestRecord } from '../api';

export function Requests() {
  const [requests, setRequests] = useState<RequestRecord[]>([]);

  useEffect(() => {
    let mounted = true;
    const fetchRequests = () => {
      adminClient.getRequests()
        .then(data => {
          if (mounted) setRequests(data);
        })
        .catch(console.error);
    };

    fetchRequests();
    const interval = setInterval(fetchRequests, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div>
      <h1 className="page-title">请求</h1>

      {requests.length === 0 ? (
        <div className="card">
          <p data-testid="requests-empty" style={{ color: 'var(--color-text-muted)' }}>
            暂无请求记录。
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table data-testid="requests-table" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                <th style={{ padding: '8px' }}>时间</th>
                <th style={{ padding: '8px' }}>操作</th>
                <th style={{ padding: '8px' }}>协议</th>
                <th style={{ padding: '8px' }}>Host</th>
                <th style={{ padding: '8px' }}>路径</th>
                <th style={{ padding: '8px' }}>结果</th>
                <th style={{ padding: '8px' }}>耗时</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={`${r.time}-${r.action}-${r.path}`} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                  <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{new Date(r.time).toISOString()}</td>
                  <td style={{ padding: '8px' }}>{r.action}</td>
                  <td style={{ padding: '8px' }}>{r.protocol}</td>
                  <td style={{ padding: '8px' }}>{r.host}</td>
                  <td style={{ padding: '8px', wordBreak: 'break-all', fontFamily: 'monospace' }}>{r.path}</td>
                  <td style={{ padding: '8px' }}>{r.outcome}</td>
                  <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{r.durationMs}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
