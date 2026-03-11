import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Settings } from './Settings';
import { adminClient, type BootstrapResponse, type Config } from '../api';

const IN_DOM = typeof document !== 'undefined';
const describeWithDom = IN_DOM ? describe : describe.skip;

const bootstrapData: BootstrapResponse = {
  adminNonce: 'nonce',
  version: '0.1.0',
  config: {
    host: '127.0.0.1',
    port: 18765,
    publicUrl: 'http://127.0.0.1:18765',
    protocols: ['https'],
    allowedHosts: ['github.com'],
    requestHistoryLimit: 100,
    openBrowserOnStart: false,
  },
  runtime: {
    pid: 123,
    startedAt: '2024-01-01T00:00:00.000Z',
    listenUrl: 'http://127.0.0.1:18765',
    panelUrl: 'http://127.0.0.1:18765',
    version: '0.1.0',
    stateDir: '/tmp/state',
  },
  derived: {
    panelUrl: 'http://127.0.0.1:18765',
    listenUrl: 'http://127.0.0.1:18765',
    publicUrl: 'http://127.0.0.1:18765',
    stateDir: '/tmp/state',
    tokenFilePath: '/tmp/state/token',
    installCommand: 'curl -fsSL http://127.0.0.1:18765/container/install.sh | sudo sh',
  },
};

const configResponse: Config = {
  host: '127.0.0.1',
  port: 18765,
  publicUrl: 'http://127.0.0.1:18765',
  protocols: ['https'],
  allowedHosts: ['github.com'],
  requestHistoryLimit: 100,
  openBrowserOnStart: false,
};

describeWithDom('Settings restart and token rotation UX', () => {
  const getConfigMock = vi.spyOn(adminClient, 'getConfig');
  const saveConfigMock = vi.spyOn(adminClient, 'saveConfig');
  const restartMock = vi.spyOn(adminClient, 'restart');
  const rotateTokenMock = vi.spyOn(adminClient, 'rotateToken');
  const onRefresh = vi.fn();
  const assignMock = vi.fn();

  beforeEach(() => {
    getConfigMock.mockResolvedValue(configResponse);
    saveConfigMock.mockResolvedValue({ ok: true, restartRequired: true, nextPanelUrl: 'http://127.0.0.1:18766' });
    restartMock.mockResolvedValue({ ok: true, restarting: true, nextPanelUrl: 'http://127.0.0.1:18766' });
    rotateTokenMock.mockResolvedValue({ ok: true, tokenFilePath: '/tmp/state/token.next' });
    onRefresh.mockReset();
    assignMock.mockReset();
    vi.stubGlobal('location', { ...window.location, assign: assignMock });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('surfaces restartRequired and nextPanelUrl after save', async () => {
    render(<Settings bootstrapData={bootstrapData} onRefresh={onRefresh} />);

    await waitFor(() => expect(screen.getByTestId('settings-save')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(screen.getByTestId('save-status')).toHaveTextContent('需要重启'));
    expect(screen.getByTestId('save-next-panel-url')).toHaveTextContent('http://127.0.0.1:18766');
  });

  it('rejects invalid ports before sending the admin request', async () => {
    render(<Settings bootstrapData={bootstrapData} onRefresh={onRefresh} />);

    await waitFor(() => expect(screen.getByTestId('settings-port')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('settings-port'), { target: { value: '70000' } });
    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(screen.getByTestId('save-status')).toHaveTextContent('端口必须是 1 到 65535 之间的整数'));
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it('shows restart banner and redirects after exactly 1500ms', async () => {
    render(<Settings bootstrapData={bootstrapData} onRefresh={onRefresh} />);

    await waitFor(() => expect(screen.getByTestId('settings-restart')).toBeInTheDocument());
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-restart'));
      await Promise.resolve();
    });

    expect(screen.getByTestId('restart-banner')).toHaveTextContent('http://127.0.0.1:18766');
    expect(assignMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1499);
    });
    expect(assignMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(assignMock).toHaveBeenCalledWith('http://127.0.0.1:18766');
  });

  it('updates token path metadata after rotate without exposing secrets', async () => {
    render(<Settings bootstrapData={bootstrapData} onRefresh={onRefresh} />);

    await waitFor(() => expect(screen.getByTestId('token-rotate')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('token-rotate'));

    await waitFor(() => expect(screen.getByTestId('rotate-status')).toHaveTextContent('Token 已轮换'));
    expect(screen.getByTestId('token-file-path')).toHaveTextContent('/tmp/state/token.next');
    expect(screen.queryByText(/[a-f0-9]{64}/i)).not.toBeInTheDocument();
  });

  it('offers a reload path after a failed save', async () => {
    saveConfigMock.mockRejectedValueOnce(new Error('stale nonce'));
    render(<Settings bootstrapData={bootstrapData} onRefresh={onRefresh} />);

    await waitFor(() => expect(screen.getByTestId('settings-save')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(screen.getByTestId('save-status')).toHaveTextContent('stale nonce'));
    fireEvent.click(screen.getByTestId('settings-reload'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
