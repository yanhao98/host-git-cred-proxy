import { useState, useEffect } from 'react';
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
      <h1 className="page-title">概览</h1>

      <div className="card">
        <h3>服务状态</h3>
        <p>状态：<span data-testid="overview-status" className={`status-badge ${status?.running ? 'status-running' : 'status-stopped'}`}>{status?.running ? '运行中' : '已停止'}</span></p>
        <p>最近启动时间：<span data-testid="overview-start-time">{status?.startedAt ? new Date(status.startedAt).toLocaleString() : '暂无'}</span></p>
      </div>

      <div className="card">
        <h3>网络端点</h3>
        <p>监听地址：<code data-testid="overview-listen-url">{d.listenUrl}</code></p>
        <p>容器访问地址：<code data-testid="overview-public-url">{d.publicUrl}</code></p>
      </div>

      <div className="card">
        <h3>安全配置</h3>
        <p>协议白名单：<code data-testid="overview-protocol-whitelist">{config.protocols.join(', ')}</code></p>
        <p>Host 白名单：<code data-testid="overview-host-whitelist">{config.allowedHosts.length > 0 ? config.allowedHosts.join(', ') : '不限制'}</code></p>
      </div>

      <div className="card">
        <h3>本地状态</h3>
        <p>状态目录：<code data-testid="overview-state-dir">{d.stateDir}</code></p>
        <p>Token 文件：<code data-testid="overview-token-file-path">{d.tokenFilePath}</code></p>
      </div>
    </div>
  );
}
