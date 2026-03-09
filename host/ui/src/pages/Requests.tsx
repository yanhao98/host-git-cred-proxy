import React, { useState, useEffect } from 'react';
import { adminClient } from '../api';

export function Requests() {
  const [requests, setRequests] = useState<any[]>([]);

  useEffect(() => {
    adminClient.getRequests().then(setRequests).catch(console.error);
  }, []);

  return (
    <div>
      <h1 className="page-title">Requests</h1>
      <div className="card">
        <table data-testid="requests-table" style={{ width: '100%', textAlign: 'left' }}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Protocol</th>
              <th>Host</th>
              <th>Path</th>
              <th>Outcome</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r, i) => (
              <tr key={i}>
                <td>{new Date(r.timestamp).toISOString()}</td>
                <td>{r.action}</td>
                <td>{r.protocol}</td>
                <td>{r.host}</td>
                <td>{r.path}</td>
                <td>{r.outcome}</td>
                <td>{r.durationMs}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
