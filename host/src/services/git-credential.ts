import { spawn } from 'node:child_process';

import type { Config } from './config';
import type { AuditEvent } from './request-log';

export const MAX_BODY_SIZE = 64 * 1024;

export const ACTION_MAP = new Map<string, GitCredentialAction>([
  ['get', 'fill'],
  ['store', 'approve'],
  ['erase', 'reject'],
  ['fill', 'fill'],
  ['approve', 'approve'],
  ['reject', 'reject'],
]);

export type GitCredentialAction = 'fill' | 'approve' | 'reject';

export type GitCredentialCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type HandleCredentialRequestOptions = {
  action: string;
  body: string;
  config: Config;
};

export type HandleCredentialRequestResult = {
  status: number;
  body: string;
  outcome: AuditEvent['outcome'];
  protocol: string;
  host: string;
  path: string;
};

export function parseCredentialBody(body: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of body.split('\n')) {
    if (!line || !line.includes('=')) {
      continue;
    }

    const index = line.indexOf('=');
    const key = line.slice(0, index);
    const value = line.slice(index + 1);
    result[key] = value;
  }

  return result;
}

export async function runGitCredential(action: string, input: string): Promise<GitCredentialCommandResult> {
  return await new Promise<GitCredentialCommandResult>((resolve, reject) => {
    const child = spawn('git', ['credential', action], {
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });

    child.stdin.end(input);
  });
}

export function isMissingCredentialError(stderr: string): boolean {
  const normalized = stderr.toLowerCase();

  return (
    normalized.includes('terminal prompts disabled') ||
    normalized.includes('could not read username') ||
    normalized.includes('could not read password')
  );
}

export async function handleCredentialRequest(
  options: HandleCredentialRequestOptions,
): Promise<HandleCredentialRequestResult> {
  const action = ACTION_MAP.get(options.action);

  if (!action) {
    return {
      status: 404,
      body: 'Not Found\n',
      outcome: 'bad_request',
      protocol: '',
      host: '',
      path: '',
    };
  }

  const attrs = parseCredentialBody(options.body);
  const protocol = attrs.protocol?.toLowerCase() ?? '';
  const host = attrs.host ?? '';
  const path = attrs.path ?? '';

  if (options.config.protocols.length > 0) {
    if (!protocol) {
      return {
        status: 400,
        body: 'Missing protocol\n',
        outcome: 'bad_request',
        protocol,
        host,
        path,
      };
    }

    if (!options.config.protocols.includes(protocol)) {
      return {
        status: 403,
        body: 'Protocol not allowed\n',
        outcome: 'denied',
        protocol,
        host,
        path,
      };
    }
  }

  if (options.config.allowedHosts.length > 0 && host && !options.config.allowedHosts.includes(host)) {
    return {
      status: 403,
      body: 'Host not allowed\n',
      outcome: 'denied',
      protocol,
      host,
      path,
    };
  }

  const result = await runGitCredential(action, options.body);

  if (result.code === 0) {
    return {
      status: 200,
      body: result.stdout,
      outcome: 'ok',
      protocol,
      host,
      path,
    };
  }

  if (action === 'fill' && isMissingCredentialError(result.stderr)) {
    return {
      status: 200,
      body: '',
      outcome: 'empty',
      protocol,
      host,
      path,
    };
  }

  return {
    status: 502,
    body: result.stderr || `git credential ${action} failed\n`,
    outcome: 'error',
    protocol,
    host,
    path,
  };
}
