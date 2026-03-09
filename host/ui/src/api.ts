export interface Config {
  host: string;
  port: number;
  publicUrl: string;
  protocols: string[];
  allowedHosts: string[];
  requestHistoryLimit: number;
  openBrowserOnStart: boolean;
}

export interface RuntimeInfo {
  pid: number;
  startedAt: string;
  listenUrl: string;
  panelUrl: string;
  version: string;
  stateDir: string;
}

export interface BootstrapResponse {
  adminNonce: string;
  version: string;
  config: Config;
  runtime: RuntimeInfo | null;
  derived: {
    panelUrl: string;
    listenUrl: string;
    publicUrl: string;
    stateDir: string;
    tokenFilePath: string;
    installCommand: string;
  };
}

export interface StatusResponse {
  running: boolean;
  pid: number;
  startedAt: string;
  listenUrl: string;
  publicUrl: string;
  stateDir: string;
  tokenFilePath: string;
  requestHistoryLimit: number;
}

export interface RestartResponse {
  ok: true;
  restarting: true;
  nextPanelUrl: string;
}

export interface RotateResponse {
  ok: true;
  tokenFilePath: string;
}

class AdminClient {
  private nonce: string | null = null;
  private bootstrapPromise: Promise<BootstrapResponse> | null = null;

  async bootstrap(): Promise<BootstrapResponse> {
    if (this.bootstrapPromise) {
      return this.bootstrapPromise;
    }

    this.bootstrapPromise = fetch('/api/admin/bootstrap')
      .then(res => {
        if (!res.ok) throw new Error('Bootstrap failed');
        return res.json() as Promise<BootstrapResponse>;
      })
      .then(data => {
        this.nonce = data.adminNonce;
        return data;
      })
      .catch(err => {
        this.bootstrapPromise = null;
        throw err;
      });

    return this.bootstrapPromise;
  }

  private async fetchWithNonce(url: string, options: RequestInit = {}): Promise<Response> {
    if (!this.nonce) {
      await this.bootstrap();
    }
    
    const headers = new Headers(options.headers);
    if (this.nonce) {
      headers.set('X-Admin-Nonce', this.nonce);
    }

    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      throw new Error(`API error: ${res.statusText}`);
    }
    return res;
  }

  async getStatus(): Promise<StatusResponse> {
    const res = await fetch('/api/admin/status');
    if (!res.ok) throw new Error('Failed to get status');
    return res.json();
  }

  async getConfig(): Promise<Config> {
    const res = await fetch('/api/admin/config');
    if (!res.ok) throw new Error('Failed to get config');
    return res.json();
  }

  async saveConfig(config: Partial<Config>): Promise<{ ok: boolean, restartRequired: boolean, nextPanelUrl: string }> {
    const res = await this.fetchWithNonce('/api/admin/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });
    return res.json();
  }

  async restart(): Promise<RestartResponse> {
    const res = await this.fetchWithNonce('/api/admin/restart', { method: 'POST' });
    return res.json();
  }

  async rotateToken(): Promise<RotateResponse> {
    const res = await this.fetchWithNonce('/api/admin/token/rotate', { method: 'POST' });
    return res.json();
  }

  async getRequests(): Promise<any[]> {
    const res = await fetch('/api/admin/requests');
    if (!res.ok) throw new Error('Failed to get requests');
    return res.json();
  }

  async getLogs(): Promise<{ lines: string[], truncated: boolean }> {
    const res = await fetch('/api/admin/logs');
    if (!res.ok) throw new Error('Failed to get logs');
    return res.json();
  }
}

export const adminClient = new AdminClient();
