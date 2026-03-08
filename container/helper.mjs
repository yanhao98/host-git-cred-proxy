#!/usr/bin/env node

import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const operation = process.argv[2] ?? '';
const supportedOperations = new Set(['get', 'store', 'erase']);

if (!supportedOperations.has(operation)) {
  process.exit(0);
}

const proxyUrl = process.env.GIT_CRED_PROXY_URL ?? 'http://host.docker.internal:18765';
const tokenFile =
  process.env.GIT_CRED_PROXY_TOKEN_FILE ?? path.join(__dirname, '..', 'host', 'state', 'token');

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];

    process.stdin.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    process.stdin.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    process.stdin.on('error', reject);
  });
}

function request(url, body, token) {
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];

        res.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    req.on('error', reject);
    req.end(body);
  });
}

async function main() {
  const token = (process.env.GIT_CRED_PROXY_TOKEN ?? (await fs.readFile(tokenFile, 'utf8'))).trim();
  const body = await readStdin();
  const url = new URL(`/${operation}`, proxyUrl);
  const response = await request(url, body, token);

  if (response.statusCode === 200) {
    process.stdout.write(response.body);
    return;
  }

  if (response.body) {
    process.stderr.write(response.body.trimEnd() + '\n');
  } else {
    process.stderr.write(`Proxy request failed with status ${response.statusCode}\n`);
  }

  process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
