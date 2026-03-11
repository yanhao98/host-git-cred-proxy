import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { Requests } from './Requests';
import { Logs } from './Logs';
import { adminClient } from '../api';

const IN_DOM = typeof document !== 'undefined';
const describeWithDom = IN_DOM ? describe : describe.skip;

describeWithDom('Requests & Logs UI', () => {
  const getRequestsMock = vi.spyOn(adminClient, 'getRequests');
  const getLogsMock = vi.spyOn(adminClient, 'getLogs');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Requests', () => {
    it('renders empty state initially if no requests', async () => {
      getRequestsMock.mockResolvedValue([]);
      render(<Requests />);

      await waitFor(() => {
        expect(screen.getByTestId('requests-empty')).toBeInTheDocument();
      });
    });

    it('renders populated state with correct columns', async () => {
      const mockRequests = [
        {
          time: '2023-10-27T10:00:00.000Z',
          action: 'fill',
          protocol: 'https',
          host: 'github.com',
          path: 'owner/repo.git',
          outcome: 'ok',
          durationMs: 123
        }
      ];
      getRequestsMock.mockResolvedValue(mockRequests);
      
      render(<Requests />);

      await waitFor(() => {
        expect(screen.getByTestId('requests-table')).toBeInTheDocument();
      });

      const tableContent = screen.getByTestId('requests-table').textContent || '';
      expect(tableContent).toContain('github.com');
      expect(tableContent).toContain('owner/repo.git');
      expect(tableContent).toContain('fill');
      expect(tableContent).toContain('123ms');
      expect(tableContent).toContain('ok');
    });

    it('polls for new requests every 5 seconds', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      getRequestsMock.mockResolvedValue([]);
      render(<Requests />);

      await waitFor(() => {
        expect(getRequestsMock).toHaveBeenCalledTimes(1);
      });

      getRequestsMock.mockResolvedValue([
        {
          time: '2023-10-27T10:00:05.000Z',
          action: 'fill',
          protocol: 'https',
          host: 'github.com',
          path: 'owner/repo.git',
          outcome: 'ok',
          durationMs: 45
        }
      ]);

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(getRequestsMock).toHaveBeenCalledTimes(2);

      await waitFor(() => {
        expect(screen.getByTestId('requests-table')).toBeInTheDocument();
      });
      vi.useRealTimers();
    });
  });

  describe('Logs', () => {
    it('renders empty state initially if no logs', async () => {
      getLogsMock.mockResolvedValue({ lines: [], truncated: false });
      render(<Logs />);

      await waitFor(() => {
        expect(screen.getByTestId('logs-empty')).toBeInTheDocument();
      });
    });

    it('renders populated state', async () => {
      getLogsMock.mockResolvedValue({ lines: ['Server started', 'Proxying request'], truncated: false });
      render(<Logs />);

      await waitFor(() => {
        expect(screen.getByTestId('logs-view')).toBeInTheDocument();
      });

      const logsText = screen.getByTestId('logs-view').textContent || '';
      expect(logsText).toContain('Server started\nProxying request');
      expect(screen.queryByTestId('logs-truncated')).not.toBeInTheDocument();
    });

    it('surfaces truncated=true clearly', async () => {
      getLogsMock.mockResolvedValue({ lines: ['Log line 1', 'Log line 2'], truncated: true });
      render(<Logs />);

      await waitFor(() => {
        expect(screen.getByTestId('logs-truncated')).toBeInTheDocument();
      });

      expect(screen.getByTestId('logs-truncated').textContent).toContain('日志已截断');
    });

    it('polls for new logs every 5 seconds', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      getLogsMock.mockResolvedValue({ lines: ['Log line 1'], truncated: false });
      render(<Logs />);

      await waitFor(() => {
        expect(getLogsMock).toHaveBeenCalledTimes(1);
      });

      getLogsMock.mockResolvedValue({ lines: ['Log line 1', 'Log line 2'], truncated: false });

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(getLogsMock).toHaveBeenCalledTimes(2);

      await waitFor(() => {
        const view = screen.getByTestId('logs-view');
        expect(view.textContent).toContain('Log line 1\nLog line 2');
      });
      vi.useRealTimers();
    });
  });
});
