import React from 'react';
import { type BootstrapResponse } from '../api';

export function Setup({ bootstrapData }: { bootstrapData: BootstrapResponse }) {
  const d = bootstrapData.derived;
  return (
    <div>
      <h1 className="page-title">Setup</h1>
      
      <div className="card">
        <h3>1. Install Script</h3>
        <p>Run this script in your container to install the Git helper.</p>
        <pre data-testid="setup-install-command">{d.installCommand}</pre>
      </div>

      <div className="card">
        <h3>2. Configure Git</h3>
        <p>Configure Git to use the proxy helper globally in the container.</p>
        <pre data-testid="setup-configure-command">configure-git.sh --global</pre>
      </div>

      <div className="card">
        <h3>Token Directory Mount Guidance</h3>
        <p>
          You must mount the containing state directory rather than the single token file itself. 
          This ensures the token can be rotated automatically. Mount the directory to a safe path like <code>/run/host-git-cred-proxy</code>.
        </p>
        <p>The host token directory is located at: <code>{d.stateDir}</code></p>
      </div>

      <div className="card">
        <h3>Docker Compose Snippet</h3>
        <p>Example snippet to add to your <code>docker-compose.yml</code>.</p>
        <pre data-testid="setup-compose-snippet">
{`services:
  dev:
    environment:
      - INSTALL_DIR=/usr/local/bin
      - GIT_CRED_PROXY_INSTALL_URL=${d.publicUrl}
      - GIT_CRED_PROXY_URL=${d.publicUrl}
      - GIT_CRED_PROXY_TOKEN_FILE=/run/host-git-cred-proxy/token
    volumes:
      - ${d.stateDir}:/run/host-git-cred-proxy:ro
    # Example command to run on startup:
    # command: sh -lc "curl -fsSL $$GIT_CRED_PROXY_INSTALL_URL/container/install.sh | sh && $$INSTALL_DIR/configure-git.sh --global && sleep infinity"`}
        </pre>
      </div>

      <div className="card">
        <h3>Devcontainer Snippet</h3>
        <p>Example snippet to add to your <code>devcontainer.json</code>.</p>
        <pre data-testid="setup-devcontainer-snippet">
{`"mounts": [
  "source=${d.stateDir},target=/run/host-git-cred-proxy,type=bind,readonly"
],
"containerEnv": {
  "INSTALL_DIR": "/usr/local/bin",
  "GIT_CRED_PROXY_INSTALL_URL": "${d.publicUrl}",
  "GIT_CRED_PROXY_URL": "${d.publicUrl}",
  "GIT_CRED_PROXY_TOKEN_FILE": "/run/host-git-cred-proxy/token"
},
"postCreateCommand": "sh -lc 'curl -fsSL \\"$GIT_CRED_PROXY_INSTALL_URL/container/install.sh\\" | sh && \\"$INSTALL_DIR/configure-git.sh\\" --global'"`}
        </pre>
      </div>
    </div>
  );
}
