import React from 'react';
import { type BootstrapResponse } from '../api';

export function Setup({ bootstrapData }: { bootstrapData: BootstrapResponse }) {
  const d = bootstrapData.derived;
  return (
    <div>
      <h1 className="page-title">Setup</h1>
      
      <div className="card">
        <h3>Install Script</h3>
        <pre data-testid="setup-install-command">{d.installCommand}</pre>
      </div>

      <div className="card">
        <h3>Configure Git</h3>
        <pre data-testid="setup-configure-command">git config --global credential.helper hostproxy</pre>
      </div>

      <div className="card">
        <h3>Docker Compose Snippet</h3>
        <pre data-testid="setup-compose-snippet">
          {`services:\n  app:\n    environment:\n      - GIT_CREDENTIAL_HOSTPROXY_URL=${d.publicUrl}\n    volumes:\n      - ${d.tokenFilePath}:/run/secrets/host-git-cred-token:ro`}
        </pre>
      </div>

      <div className="card">
        <h3>Devcontainer Snippet</h3>
        <pre data-testid="setup-devcontainer-snippet">
          {`"mounts": [\n  "source=${d.tokenFilePath},target=/run/secrets/host-git-cred-token,type=bind,consistency=cached"\n],\n"containerEnv": {\n  "GIT_CREDENTIAL_HOSTPROXY_URL": "${d.publicUrl}"\n}`}
        </pre>
      </div>
    </div>
  );
}
