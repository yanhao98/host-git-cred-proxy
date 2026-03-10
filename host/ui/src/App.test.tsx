import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from './App';
import { adminClient } from './api';

const describeWithDom = typeof document === 'undefined' ? describe.skip : describe;

const mockBootstrapData = {
  adminNonce: '123',
  version: '1.0.0',
  config: {
    host: 'localhost',
    port: 3000,
    publicUrl: 'http://public.url',
    protocols: ['http'],
    allowedHosts: ['github.com'],
    requestHistoryLimit: 100,
    openBrowserOnStart: true
  },
  runtime: null,
  derived: {
    panelUrl: 'http://localhost:3000',
    listenUrl: 'http://localhost:3000',
    publicUrl: 'http://public.url',
    stateDir: '/tmp/state',
    tokenFilePath: '/tmp/token',
    installCommand: 'curl -fsSL http://public.url/container/install.sh | sh'
  }
};

describeWithDom('App Shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(adminClient, 'bootstrap').mockResolvedValue(mockBootstrapData as any);
    vi.spyOn(adminClient, 'getStatus').mockResolvedValue({ running: true } as any);
    vi.spyOn(adminClient, 'getConfig').mockResolvedValue(mockBootstrapData.config as any);
    vi.spyOn(adminClient, 'getRequests').mockResolvedValue([]);
    vi.spyOn(adminClient, 'getLogs').mockResolvedValue({ lines: [], truncated: false });
  });

  it('renders all required data-testid elements', async () => {
    render(<App />);
    
    // Wait for shell to render
    await screen.findByTestId('app-shell');

    // Nav selectors
    expect(screen.getByTestId('nav-overview')).toBeInTheDocument();
    expect(screen.getByTestId('nav-setup')).toBeInTheDocument();
    expect(screen.getByTestId('nav-requests')).toBeInTheDocument();
    expect(screen.getByTestId('nav-logs')).toBeInTheDocument();
    expect(screen.getByTestId('nav-settings')).toBeInTheDocument();

    // Check Overview page selectors
    expect(screen.getByTestId('overview-status')).toBeInTheDocument();
    expect(screen.getByTestId('overview-listen-url')).toBeInTheDocument();
    expect(screen.getByTestId('overview-public-url')).toBeInTheDocument();
    expect(screen.getByTestId('overview-state-dir')).toBeInTheDocument();

    // Setup page
    fireEvent.click(screen.getByTestId('nav-setup'));
    await screen.findByTestId('setup-install-command');
    expect(screen.getByTestId('setup-configure-command')).toBeInTheDocument();
    expect(screen.getByTestId('setup-compose-snippet')).toBeInTheDocument();
    expect(screen.getByTestId('setup-devcontainer-snippet')).toBeInTheDocument();

    // Requests page (empty data returns the empty state element)
    fireEvent.click(screen.getByTestId('nav-requests'));
    await screen.findByTestId('requests-empty');

    // Logs page (empty data returns the empty state element)
    fireEvent.click(screen.getByTestId('nav-logs'));
    await screen.findByTestId('logs-empty');

    // Settings page
    fireEvent.click(screen.getByTestId('nav-settings'));
    await screen.findByTestId('settings-host');
    expect(screen.getByTestId('settings-port')).toBeInTheDocument();
    expect(screen.getByTestId('settings-public-url')).toBeInTheDocument();
    expect(screen.getByTestId('settings-protocols')).toBeInTheDocument();
    expect(screen.getByTestId('settings-allowed-hosts')).toBeInTheDocument();
    expect(screen.getByTestId('settings-save')).toBeInTheDocument();
    expect(screen.getByTestId('settings-restart')).toBeInTheDocument();
    expect(screen.getByTestId('token-rotate')).toBeInTheDocument();
    expect(screen.getByTestId('token-file-path')).toBeInTheDocument();
    
    // Check restart-banner (trigger it manually)
    vi.spyOn(adminClient, 'restart').mockResolvedValue({ ok: true, restarting: true, nextPanelUrl: 'http://localhost' });
    fireEvent.click(screen.getByTestId('settings-restart'));
    await screen.findByTestId('restart-banner');
  });
});
