import { appendFile, readFile, writeFile } from 'node:fs/promises';

import { ensureStateFile } from './state-dir';

const REQUESTS_FILE_NAME = 'requests.ndjson';
const VALID_OUTCOMES = new Set(['ok', 'empty', 'denied', 'bad_request', 'error'] as const);

export type AuditEvent = {
  time: string;
  action: string;
  protocol: string;
  host: string;
  path: string;
  statusCode: number;
  outcome: 'ok' | 'empty' | 'denied' | 'bad_request' | 'error';
  durationMs: number;
};

export async function appendAuditEvent(stateDir: string, event: AuditEvent, limit: number): Promise<void> {
  const requestsFilePath = ensureStateFile(stateDir, REQUESTS_FILE_NAME);
  const redactedEvent = sanitizeAuditEvent(event);

  await appendFile(requestsFilePath, `${JSON.stringify(redactedEvent)}\n`, {
    encoding: 'utf-8',
  });

  const normalizedLimit = normalizePositiveInteger(limit);
  const fileContent = await readFile(requestsFilePath, 'utf-8');
  const lines = toNonEmptyLines(fileContent);

  if (lines.length <= normalizedLimit) {
    return;
  }

  const trimmedLines = lines.slice(-normalizedLimit);
  await writeFile(requestsFilePath, `${trimmedLines.join('\n')}\n`, {
    encoding: 'utf-8',
  });
}

export async function readAuditEvents(stateDir: string, limit?: number): Promise<AuditEvent[]> {
  const requestsFilePath = ensureStateFile(stateDir, REQUESTS_FILE_NAME);
  const fileContent = await readFile(requestsFilePath, 'utf-8');

  const events = toNonEmptyLines(fileContent)
    .map(parseAuditEventLine)
    .filter((event): event is AuditEvent => event !== null);

  if (typeof limit === 'number') {
    if (!Number.isInteger(limit) || limit <= 0) {
      return [];
    }

    return events.slice(-limit);
  }

  return events;
}

function sanitizeAuditEvent(event: AuditEvent): AuditEvent {
  return {
    time: event.time,
    action: event.action,
    protocol: event.protocol,
    host: event.host,
    path: event.path,
    statusCode: event.statusCode,
    outcome: event.outcome,
    durationMs: event.durationMs,
  };
}

function parseAuditEventLine(line: string): AuditEvent | null {
  try {
    const parsed = JSON.parse(line);
    if (!isObjectRecord(parsed)) {
      return null;
    }

    const { time, action, protocol, host, path, statusCode, outcome, durationMs } = parsed;

    if (
      typeof time !== 'string' ||
      typeof action !== 'string' ||
      typeof protocol !== 'string' ||
      typeof host !== 'string' ||
      typeof path !== 'string' ||
      typeof statusCode !== 'number' ||
      typeof durationMs !== 'number' ||
      !Number.isFinite(statusCode) ||
      !Number.isFinite(durationMs) ||
      !isAuditOutcome(outcome)
    ) {
      return null;
    }

    return {
      time,
      action,
      protocol,
      host,
      path,
      statusCode,
      outcome,
      durationMs,
    };
  } catch {
    return null;
  }
}

function toNonEmptyLines(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function normalizePositiveInteger(value: number): number {
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAuditOutcome(value: unknown): value is AuditEvent['outcome'] {
  return typeof value === 'string' && VALID_OUTCOMES.has(value as AuditEvent['outcome']);
}
