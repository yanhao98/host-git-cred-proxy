import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { Overview } from './Overview';
import { Setup } from './Setup';
import { adminClient, type BootstrapResponse } from '../api';

const IN_DOM = typeof document !== 'undefined';
const describeWithDom = IN_DOM ? describe : describe.skip;

describeWithDom('Overview & Setup UI', () => {

  const mockBootstrapData: BootstrapResponse = {
    adminNonce: 'test-nonce',
    version: '1.0.0',
    config: {
      host: '127.0.0.1',
      port: 18765,
      publicUrl: 'http://test.docker.internal:18765',
      protocols: ['https', 'http'],
      allowedHosts: ['github.com'],
      requestHistoryLimit: 100,
      openBrowserOnStart: false,
    },
    runtime: {
      pid: 1234,
      startedAt: '2023-10-27T10:00:00.000Z',
      listenUrl: 'http://127.0.0.1:18765',
      panelUrl: 'http://127.0.0.1:18765',
      version: '1.0.0',
      stateDir: '/test/state/dir',
    },
    derived: {
      panelUrl: 'http://127.0.0.1:18765',
      listenUrl: 'http://127.0.0.1:18765',
      publicUrl: 'http://test.docker.internal:18765',
      stateDir: '/test/state/dir',
      tokenFilePath: '/test/state/dir/token',
      installCommand: 'curl -fsSL http://test.docker.internal:18765/container/install.sh | sudo sh',
    },
  };

  const mockStatus = {
    running: true,
    pid: 1234,
    startedAt: '2023-10-27T10:00:00.000Z',
    listenUrl: 'http://127.0.0.1:18765',
    publicUrl: 'http://test.docker.internal:18765',
    stateDir: '/test/state/dir',
    tokenFilePath: '/test/state/dir/token',
    requestHistoryLimit: 100,
  };

  beforeEach(() => {
    vi.spyOn(adminClient, 'getStatus').mockResolvedValue(mockStatus as any);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('Overview', () => {
    it('renders static bootstrap data correctly', async () => {
      render(<Overview bootstrapData={mockBootstrapData} />);

      expect(screen.getByTestId('overview-listen-url').textContent).toBe('http://127.0.0.1:18765');
      expect(screen.getByTestId('overview-public-url').textContent).toBe('http://test.docker.internal:18765');
      expect(screen.getByTestId('overview-protocol-whitelist').textContent).toBe('https, http');
      expect(screen.getByTestId('overview-host-whitelist').textContent).toBe('github.com');
      expect(screen.getByTestId('overview-state-dir').textContent).toBe('/test/state/dir');
      expect(screen.getByTestId('overview-token-file-path').textContent).toBe('/test/state/dir/token');
      
      await waitFor(() => {
        expect(screen.getByTestId('overview-status').textContent).toBe('运行中');
      });
    });

    it('renders dynamic status data correctly', async () => {
      render(<Overview bootstrapData={mockBootstrapData} />);

      await waitFor(() => {
        expect(screen.getByTestId('overview-status').textContent).toBe('运行中');
        expect(screen.getByTestId('overview-start-time').textContent).not.toBe('暂无');
      });
    });

    it('shows "不限制" if allowedHosts is empty', async () => {
      const data = {
        ...mockBootstrapData,
        config: { ...mockBootstrapData.config, allowedHosts: [] },
      };
      render(<Overview bootstrapData={data} />);
      expect(screen.getByTestId('overview-host-whitelist').textContent).toBe('不限制');

      await waitFor(() => {
        expect(screen.getByTestId('overview-status').textContent).toBe('运行中');
      });
    });
  });

  describe('Setup', () => {
    it('renders snippets securely based on derived data', () => {
      render(<Setup bootstrapData={mockBootstrapData} />);

      const installCommand = screen.getByTestId('setup-install-command').textContent;
      expect(installCommand).toContain('http://test.docker.internal:18765/container/install.sh');

      const configureCommand = screen.getByTestId('setup-configure-command').textContent;
      expect(configureCommand).toContain('configure-git.sh --global');

      const composeSnippet = screen.getByTestId('setup-compose-snippet').textContent;
      expect(composeSnippet).toContain('GIT_CRED_PROXY_URL=http://test.docker.internal:18765');
      expect(composeSnippet).toContain('GIT_CRED_PROXY_INSTALL_URL=http://test.docker.internal:18765');
      expect(composeSnippet).toContain('/test/state/dir:/run/host-git-cred-proxy:ro');
      expect(composeSnippet).toContain('curl -fsSL $$GIT_CRED_PROXY_INSTALL_URL/container/install.sh');
      expect(composeSnippet).toContain('configure-git.sh --global');

      const devcontainerSnippet = screen.getByTestId('setup-devcontainer-snippet').textContent;
      expect(devcontainerSnippet).toContain('"GIT_CRED_PROXY_URL": "http://test.docker.internal:18765"');
      expect(devcontainerSnippet).toContain('"GIT_CRED_PROXY_INSTALL_URL": "http://test.docker.internal:18765"');
      expect(devcontainerSnippet).toContain('source=/test/state/dir,target=/run/host-git-cred-proxy,type=bind,readonly');
      expect(devcontainerSnippet).toContain('configure-git.sh --global');
    });

    it('never leaks token plaintext', () => {
      const { container } = render(<Setup bootstrapData={mockBootstrapData} />);
      const content = container.textContent || '';
      const hexPattern = /[a-f0-9]{64}/i;
      expect(hexPattern.test(content)).toBe(false);
    });
  });
});
