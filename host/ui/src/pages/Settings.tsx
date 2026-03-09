import React, { useState, useEffect } from 'react';
import { adminClient, type BootstrapResponse, type Config } from '../api';

export function Settings({ bootstrapData, onRefresh }: { bootstrapData: BootstrapResponse, onRefresh: () => void }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    adminClient.getConfig().then(setConfig).catch(console.error);
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    setSaving(true);
    try {
      const res = await adminClient.saveConfig(config);
      if (res.restartRequired) {
        alert('Config saved. Restart required.');
      } else {
        alert('Config saved.');
      }
    } catch (err: any) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRestart = async () => {
    try {
      setRestarting(true);
      const res = await adminClient.restart();
      if (res.restarting) {
        setTimeout(() => {
          window.location.href = res.nextPanelUrl;
        }, 2000);
      }
    } catch (err: any) {
      alert('Failed to restart: ' + err.message);
      setRestarting(false);
    }
  };

  const handleRotate = async () => {
    try {
      const res = await adminClient.rotateToken();
      if (res.ok) {
        alert('Token rotated.');
      }
    } catch (err: any) {
      alert('Failed to rotate token: ' + err.message);
    }
  };

  if (!config) return <div>Loading config...</div>;

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      
      {restarting && (
        <div data-testid="restart-banner" style={{ background: '#fef08a', color: '#854d0e', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
          Restarting service... please wait.
        </div>
      )}

      <form onSubmit={handleSave} className="card">
        <h3>Network</h3>
        <div className="field">
          <label>Host</label>
          <input 
            type="text" 
            data-testid="settings-host" 
            value={config.host} 
            onChange={e => setConfig({ ...config, host: e.target.value })} 
          />
        </div>
        <div className="field">
          <label>Port</label>
          <input 
            type="number" 
            data-testid="settings-port" 
            value={config.port} 
            onChange={e => setConfig({ ...config, port: parseInt(e.target.value, 10) })} 
          />
        </div>
        <div className="field">
          <label>Public URL</label>
          <input 
            type="text" 
            data-testid="settings-public-url" 
            value={config.publicUrl} 
            onChange={e => setConfig({ ...config, publicUrl: e.target.value })} 
          />
        </div>

        <h3>Access Control</h3>
        <div className="field">
          <label>Protocols (comma separated)</label>
          <input 
            type="text" 
            data-testid="settings-protocols" 
            value={config.protocols.join(', ')} 
            onChange={e => setConfig({ ...config, protocols: e.target.value.split(',').map(s => s.trim()) })} 
          />
        </div>
        <div className="field">
          <label>Allowed Hosts (comma separated)</label>
          <input 
            type="text" 
            data-testid="settings-allowed-hosts" 
            value={config.allowedHosts.join(', ')} 
            onChange={e => setConfig({ ...config, allowedHosts: e.target.value.split(',').map(s => s.trim()) })} 
          />
        </div>

        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
          <button type="submit" data-testid="settings-save" disabled={saving}>
            {saving ? 'Saving...' : 'Save Config'}
          </button>
          <button type="button" onClick={handleRestart} data-testid="settings-restart" disabled={restarting}>
            Restart Service
          </button>
        </div>
      </form>

      <div className="card">
        <h3>Token Management</h3>
        <p>Token Path: <code data-testid="token-file-path">{bootstrapData.derived.tokenFilePath}</code></p>
        <button type="button" onClick={handleRotate} data-testid="token-rotate">
          Rotate Token
        </button>
      </div>
    </div>
  );
}
