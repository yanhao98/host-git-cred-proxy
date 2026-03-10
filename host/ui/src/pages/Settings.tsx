import React, { useState, useEffect } from 'react';
import { adminClient, type BootstrapResponse, type Config } from '../api';

export function Settings({ bootstrapData, onRefresh }: { bootstrapData: BootstrapResponse, onRefresh: () => void }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [tokenFilePath, setTokenFilePath] = useState(bootstrapData.derived.tokenFilePath);
  const [saveStatus, setSaveStatus] = useState<{
    tone: 'info' | 'success' | 'error';
    message: string;
    nextPanelUrl?: string;
  } | null>(null);
  const [rotateStatus, setRotateStatus] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);
  const [restartTargetUrl, setRestartTargetUrl] = useState<string | null>(null);

  useEffect(() => {
    adminClient.getConfig().then(setConfig).catch(console.error);
  }, []);

  useEffect(() => {
    setTokenFilePath(bootstrapData.derived.tokenFilePath);
  }, [bootstrapData.derived.tokenFilePath]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;

    const validationError = validateConfig(config);
    if (validationError) {
      setSaveStatus({
        tone: 'error',
        message: validationError,
      });
      return;
    }

    setSaving(true);
    setSaveStatus(null);
    try {
      const res = await adminClient.saveConfig(config);
      setSaveStatus({
        tone: res.restartRequired ? 'info' : 'success',
        message: res.restartRequired
          ? 'Settings saved. Restart required to apply the new network configuration.'
          : 'Settings saved. No restart is required.',
        nextPanelUrl: res.nextPanelUrl,
      });
    } catch (err) {
      setSaveStatus({
        tone: 'error',
        message: `Failed to save settings. ${getErrorMessage(err)} Reload the panel and try again if your session is stale.`,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRestart = async () => {
    try {
      setRestarting(true);
      setRotateStatus(null);
      const res = await adminClient.restart();
      if (res.restarting) {
        setRestartTargetUrl(res.nextPanelUrl);
        setTimeout(() => {
          window.location.assign(res.nextPanelUrl);
        }, 1500);
      }
    } catch (err) {
      setRestartTargetUrl(null);
      setSaveStatus({
        tone: 'error',
        message: `Failed to restart the service. ${getErrorMessage(err)} Reload the panel and try again if your session is stale.`,
      });
      setRestarting(false);
    }
  };

  const handleRotate = async () => {
    try {
      setRotateStatus(null);
      const res = await adminClient.rotateToken();
      if (res.ok) {
        setTokenFilePath(res.tokenFilePath);
        setRotateStatus({
          tone: 'success',
          message: 'Token rotated successfully. No restart is required.',
        });
      }
    } catch (err) {
      setRotateStatus({
        tone: 'error',
        message: `Failed to rotate the token. ${getErrorMessage(err)} Reload the panel and try again if your session is stale.`,
      });
    }
  };

  if (!config) return <div>Loading config...</div>;

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      
      {restarting && (
        <div data-testid="restart-banner" style={{ background: '#fef08a', color: '#854d0e', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
          Restarting service... reconnecting to{' '}
          <code data-testid="restart-next-panel-url">{restartTargetUrl ?? 'the next panel URL'}</code>
          .
        </div>
      )}

      {saveStatus && (
        <div
          data-testid="save-status"
          style={{
            background: saveStatus.tone === 'error' ? '#fee2e2' : saveStatus.tone === 'info' ? '#dbeafe' : '#dcfce7',
            color: saveStatus.tone === 'error' ? '#991b1b' : saveStatus.tone === 'info' ? '#1d4ed8' : '#166534',
            padding: '1rem',
            borderRadius: '4px',
            marginBottom: '1rem',
          }}
        >
          <p style={{ margin: 0 }}>{saveStatus.message}</p>
          {saveStatus.nextPanelUrl && (
            <p style={{ margin: '0.5rem 0 0' }}>
              Next panel URL:{' '}
              <code data-testid="save-next-panel-url">{saveStatus.nextPanelUrl}</code>
            </p>
          )}
          {saveStatus.tone === 'error' && (
            <button type="button" data-testid="settings-reload" onClick={onRefresh} style={{ marginTop: '0.75rem' }}>
              Reload panel
            </button>
          )}
        </div>
      )}

      <form onSubmit={handleSave} className="card">
        <h3>Network</h3>
        <div className="field">
          <label htmlFor="settings-host-input">Host</label>
          <input 
            id="settings-host-input"
            type="text" 
            data-testid="settings-host" 
            value={config.host} 
            onChange={e => setConfig({ ...config, host: e.target.value })} 
          />
        </div>
        <div className="field">
          <label htmlFor="settings-port-input">Port</label>
          <input 
            id="settings-port-input"
            type="number" 
            data-testid="settings-port" 
            value={config.port} 
            onChange={e => setConfig({ ...config, port: parseInt(e.target.value, 10) })} 
          />
        </div>
        <div className="field">
          <label htmlFor="settings-public-url-input">Public URL</label>
          <input 
            id="settings-public-url-input"
            type="text" 
            data-testid="settings-public-url" 
            value={config.publicUrl} 
            onChange={e => setConfig({ ...config, publicUrl: e.target.value })} 
          />
        </div>

        <h3>Access Control</h3>
        <div className="field">
          <label htmlFor="settings-protocols-input">Protocols (comma separated)</label>
          <input 
            id="settings-protocols-input"
            type="text" 
            data-testid="settings-protocols" 
            value={config.protocols.join(', ')} 
            onChange={e => setConfig({ ...config, protocols: e.target.value.split(',').map(s => s.trim()) })} 
          />
        </div>
        <div className="field">
          <label htmlFor="settings-allowed-hosts-input">Allowed Hosts (comma separated)</label>
          <input 
            id="settings-allowed-hosts-input"
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
        <p>Token Path: <code data-testid="token-file-path">{tokenFilePath}</code></p>
        <button type="button" onClick={handleRotate} data-testid="token-rotate">
          Rotate Token
        </button>
        {rotateStatus && (
          <p
            data-testid="rotate-status"
            style={{
              marginTop: '0.75rem',
              color: rotateStatus.tone === 'error' ? '#991b1b' : '#166534',
            }}
          >
            {rotateStatus.message}
          </p>
        )}
        <p style={{ color: 'var(--color-text-muted)', marginTop: '0.75rem' }}>
          `credential.useHttpPath` is informational only here. Container helper setup still belongs in onboarding, not in panel settings.
        </p>
      </div>
    </div>
  );
}

function validateConfig(config: Config): string | null {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    return 'Port must be an integer between 1 and 65535.';
  }

  const publicUrl = config.publicUrl.trim();
  if (!publicUrl.startsWith('http://') && !publicUrl.startsWith('https://')) {
    return 'Public URL must start with http:// or https://.';
  }

  return null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error.';
}
