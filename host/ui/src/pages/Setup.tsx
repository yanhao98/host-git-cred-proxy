import { type BootstrapResponse } from '../api';

const DEFAULT_PUBLIC_URL = 'http://host.docker.internal:18765';

export function Setup({ bootstrapData }: { bootstrapData: BootstrapResponse }) {
  const d = bootstrapData.derived;
  const isDefaultUrl = d.publicUrl === DEFAULT_PUBLIC_URL;

  const composeEnvLines = !isDefaultUrl ? [
    `      - GIT_CRED_PROXY_INSTALL_URL=${d.publicUrl}`,
    `      - GIT_CRED_PROXY_URL=${d.publicUrl}`,
  ].join('\n') : '';

  const composeCommand = isDefaultUrl
    ? '    # command: sh -lc "curl -fsSL http://host.docker.internal:18765/container/install.sh | sudo sh && configure-git.sh --global && sleep infinity"'
    : '    # command: sh -lc "curl -fsSL $$GIT_CRED_PROXY_INSTALL_URL/container/install.sh | sudo sh && configure-git.sh --global && sleep infinity"';

  const devcontainerEnv: Record<string, string> = {};
  if (!isDefaultUrl) {
    devcontainerEnv.GIT_CRED_PROXY_INSTALL_URL = d.publicUrl;
    devcontainerEnv.GIT_CRED_PROXY_URL = d.publicUrl;
  }
  const devcontainerEnvJson = JSON.stringify(devcontainerEnv, null, 2).replace(/\n/g, '\n  ');

  const postCreateUrl = isDefaultUrl
    ? `${DEFAULT_PUBLIC_URL}/container/install.sh`
    : '\\"$GIT_CRED_PROXY_INSTALL_URL/container/install.sh\\"';
  const postCreateCommand = `sh -lc 'curl -fsSL ${postCreateUrl} | sudo sh && configure-git.sh --global'`;

  const dockerRunUrl = isDefaultUrl ? DEFAULT_PUBLIC_URL : d.publicUrl;

  return (
    <div>
      <h1 className="page-title">接入</h1>

      <div className="card">
        <h3>工作原理</h3>
        <p>
          宿主机上运行一个只监听 <code>127.0.0.1</code> 的代理服务，内部调用宿主机自己的 <code>git credential</code> 获取凭证。
          容器里安装一个轻量 shell helper（<code>git-credential-hostproxy</code>），它把 Git 的凭证请求通过 HTTP 转发给宿主机代理。
        </p>
        <p>
          Git 支持配置多个 credential helper，按顺序尝试：取凭证时（fill），第一个返回结果的 helper 生效，后面的不再调用；
          存储和删除凭证时（store/erase），所有 helper 都会被通知。
          <code>configure-git.sh</code> 会把 <code>hostproxy</code> 插到链首，已有的 helper 保留在后面作为 fallback。
          配置写入 <code>~/.gitconfig</code>（全局）或 <code>.git/config</code>（仓库级）。
        </p>
      </div>

      <div className="card">
        <h3>1. 挂载 Token 目录并启动容器</h3>
        <p>
          容器需要读取宿主机的 token 才能通过代理鉴权。
          必须挂载整个状态目录（而不是单个 token 文件），这样 token 轮换后容器仍能读到新文件。
          建议挂载到 <code>/run/host-git-cred-proxy</code>（只读）。
        </p>
        <p>宿主机状态目录：<code>{d.stateDir}</code></p>

        <details data-testid="setup-docker-run">
          <summary>docker run 快速验证</summary>
          <pre style={{ marginTop: '0.5rem' }}>
{`docker run --rm \\
  -v "${d.stateDir}:/run/host-git-cred-proxy:ro" \\
  -v vscode:/vscode \\
  --entrypoint bash \\
  ghcr.io/yanhao98/h-devcontainer:main -c '
    curl -fsSL ${dockerRunUrl}/container/install.sh | sudo sh
    configure-git.sh --global
    printf "protocol=https\\nhost=github.com\\n\\n" | git credential fill
  '`}
          </pre>
        </details>

        <details data-testid="setup-compose-snippet">
          <summary>Docker Compose 片段</summary>
          <p style={{ marginTop: '0.5rem' }}>添加到你的 <code>docker-compose.yml</code> 中。</p>
          <pre>
{`services:
  dev:${composeEnvLines ? `\n    environment:\n${composeEnvLines}` : ''}
    volumes:
      - ${d.stateDir}:/run/host-git-cred-proxy:ro
${composeCommand}`}
          </pre>
        </details>

        <details data-testid="setup-devcontainer-snippet">
          <summary>Devcontainer 片段</summary>
          <p style={{ marginTop: '0.5rem' }}>添加到你的 <code>devcontainer.json</code> 中。</p>
          <pre>
{`"mounts": [
  "source=${d.stateDir},target=/run/host-git-cred-proxy,type=bind,readonly"
],${Object.keys(devcontainerEnv).length > 0 ? `\n"containerEnv": ${devcontainerEnvJson},` : ''}
"postCreateCommand": "${postCreateCommand}"`}
          </pre>
        </details>
      </div>

      <div className="card">
        <h3>2. 安装 Helper</h3>
        <p>在容器内运行以下命令，将 <code>git-credential-hostproxy</code> 和 <code>configure-git.sh</code> 安装到 <code>/usr/local/bin</code>。</p>
        <pre data-testid="setup-install-command">{d.installCommand}</pre>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', marginTop: '0.5rem' }}>
          如果不需要 sudo，去掉即可：<code>curl ... | sh</code>；
          或者指定其他目录：<code>INSTALL_DIR="$HOME/.local/bin" curl ... | sh</code>
        </p>
      </div>

      <div className="card">
        <h3>3. 配置 Git</h3>
        <p>将 <code>hostproxy</code> 注册为 Git credential helper 并置于链首。已有的 helper（如 VS Code 自带的）会保留在后面。</p>
        <pre data-testid="setup-configure-command">configure-git.sh --global</pre>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', marginTop: '0.5rem' }}>
          使用 <code>--local</code> 仅对当前仓库生效；使用 <code>--repo PATH</code> 指定其他仓库。
        </p>
      </div>

      <div className="card">
        <h3>4. 验证</h3>
        <p>在容器内运行以下命令，如果返回了 <code>username</code> 和 <code>password</code>，说明凭证代理已生效。</p>
        <pre data-testid="setup-verify-command">printf 'protocol=https\nhost=github.com\n\n' | git credential fill</pre>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', marginTop: '0.5rem' }}>
          或者直接 clone 一个私有仓库验证：<code>git ls-remote https://github.com/你的用户名/私有仓库.git</code>
        </p>
      </div>
    </div>
  );
}
