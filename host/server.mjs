#!/usr/bin/env node

import http from 'node:http';
import process from 'node:process';
import { spawn } from 'node:child_process';

const host = process.env.GIT_CRED_PROXY_HOST ?? '127.0.0.1';
const port = Number(process.env.GIT_CRED_PROXY_PORT ?? '18765');
const token = process.env.GIT_CRED_PROXY_TOKEN ?? '';

if (!token) {
  process.stderr.write('Missing GIT_CRED_PROXY_TOKEN\n');
  process.exit(1);
}

const allowedProtocols = new Set(
  (process.env.GIT_CRED_PROXY_PROTOCOLS ?? 'https')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

const allowedHosts = new Set(
  (process.env.GIT_CRED_PROXY_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

const actionMap = new Map([
  ['get', 'fill'],
  ['store', 'approve'],
  ['erase', 'reject'],
  ['fill', 'fill'],
  ['approve', 'approve'],
  ['reject', 'reject'],
]);

function parseCredentialBody(body) {
  const result = {};

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;

      if (size > 64 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }

      chunks.push(buffer);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', reject);
  });
}

function runGitCredential(action, input) {
  return new Promise((resolve, reject) => {
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
      resolve({ code: code ?? 1, stdout, stderr });
    });

    child.stdin.end(input);
  });
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end(body);
}

function isMissingCredentialError(stderr) {
  const normalized = stderr.toLowerCase();
  return (
    normalized.includes('terminal prompts disabled') ||
    normalized.includes('could not read username') ||
    normalized.includes('could not read password')
  );
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/healthz') {
      sendText(res, 200, 'ok\n');
      return;
    }

    if (req.method !== 'POST') {
      sendText(res, 405, 'Method Not Allowed\n');
      return;
    }

    const authHeader = req.headers.authorization ?? '';
    if (authHeader !== `Bearer ${token}`) {
      sendText(res, 401, 'Unauthorized\n');
      return;
    }

    const action = actionMap.get(url.pathname.replace(/^\//, ''));
    if (!action) {
      sendText(res, 404, 'Not Found\n');
      return;
    }

    const body = await readBody(req);
    const attrs = parseCredentialBody(body);
    const protocol = attrs.protocol?.toLowerCase();
    const requestHost = attrs.host;

    if (allowedProtocols.size > 0) {
      if (!protocol) {
        sendText(res, 400, 'Missing protocol\n');
        return;
      }

      if (!allowedProtocols.has(protocol)) {
        sendText(res, 403, 'Protocol not allowed\n');
        return;
      }
    }

    if (allowedHosts.size > 0 && requestHost && !allowedHosts.has(requestHost)) {
      sendText(res, 403, 'Host not allowed\n');
      return;
    }

    const result = await runGitCredential(action, body);

    if (result.code === 0) {
      sendText(res, 200, result.stdout);
      return;
    }

    if (action === 'fill' && isMissingCredentialError(result.stderr)) {
      sendText(res, 200, '');
      return;
    }

    sendText(res, 502, result.stderr || `git credential ${action} failed\n`);
  } catch (error) {
    sendText(res, 500, `${error instanceof Error ? error.message : String(error)}\n`);
  }
});

server.listen(port, host, () => {
  process.stdout.write(`Git credential proxy listening on http://${host}:${port}\n`);
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
