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
          ? '配置已保存。需要重启服务以应用新的网络配置。'
          : '配置已保存，无需重启。',
        nextPanelUrl: res.nextPanelUrl,
      });
    } catch (err) {
      setSaveStatus({
        tone: 'error',
        message: `保存失败。${getErrorMessage(err)} 如果会话过期，请刷新面板后重试。`,
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
        message: `重启失败。${getErrorMessage(err)} 如果会话过期，请刷新面板后重试。`,
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
          message: 'Token 已轮换，无需重启。',
        });
      }
    } catch (err) {
      setRotateStatus({
        tone: 'error',
        message: `Token 轮换失败。${getErrorMessage(err)} 如果会话过期，请刷新面板后重试。`,
      });
    }
  };

  if (!config) return <div>加载配置中...</div>;

  return (
    <div>
      <h1 className="page-title">设置</h1>

      {restarting && (
        <div data-testid="restart-banner" style={{ background: '#fef08a', color: '#854d0e', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
          正在重启服务... 即将跳转到{' '}
          <code data-testid="restart-next-panel-url">{restartTargetUrl ?? '新面板地址'}</code>
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
              新面板地址：{' '}
              <code data-testid="save-next-panel-url">{saveStatus.nextPanelUrl}</code>
            </p>
          )}
          {saveStatus.tone === 'error' && (
            <button type="button" data-testid="settings-reload" onClick={onRefresh} style={{ marginTop: '0.75rem' }}>
              刷新面板
            </button>
          )}
        </div>
      )}

      <form onSubmit={handleSave} className="card">
        <h3>网络</h3>
        <div className="field">
          <label htmlFor="settings-host-input">监听地址</label>
          <input
            id="settings-host-input"
            type="text"
            data-testid="settings-host"
            value={config.host}
            onChange={e => setConfig({ ...config, host: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="settings-port-input">端口</label>
          <input
            id="settings-port-input"
            type="number"
            data-testid="settings-port"
            value={config.port}
            onChange={e => setConfig({ ...config, port: parseInt(e.target.value, 10) })}
          />
        </div>
        <div className="field">
          <label htmlFor="settings-public-url-input">容器访问地址</label>
          <input
            id="settings-public-url-input"
            type="text"
            data-testid="settings-public-url"
            value={config.publicUrl}
            onChange={e => setConfig({ ...config, publicUrl: e.target.value })}
          />
        </div>

        <h3>访问控制</h3>
        <div className="field">
          <label htmlFor="settings-protocols-input">允许协议（逗号分隔）</label>
          <input
            id="settings-protocols-input"
            type="text"
            data-testid="settings-protocols"
            value={config.protocols.join(', ')}
            onChange={e => setConfig({ ...config, protocols: e.target.value.split(',').map(s => s.trim()) })}
          />
        </div>
        <div className="field">
          <label htmlFor="settings-allowed-hosts-input">允许 Host（逗号分隔）</label>
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
            {saving ? '保存中...' : '保存配置'}
          </button>
          <button type="button" onClick={handleRestart} data-testid="settings-restart" disabled={restarting}>
            重启服务
          </button>
        </div>
      </form>

      <div className="card">
        <h3>Token 管理</h3>
        <p>Token 路径：<code data-testid="token-file-path">{tokenFilePath}</code></p>
        <button type="button" onClick={handleRotate} data-testid="token-rotate">
          轮换 Token
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
      </div>
    </div>
  );
}

function validateConfig(config: Config): string | null {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    return '端口必须是 1 到 65535 之间的整数。';
  }

  const publicUrl = config.publicUrl.trim();
  if (!publicUrl.startsWith('http://') && !publicUrl.startsWith('https://')) {
    return '容器访问地址必须以 http:// 或 https:// 开头。';
  }

  return null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误。';
}
