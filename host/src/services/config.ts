import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ensureStateFile } from './state-dir';

const CONFIG_FILE_NAME = 'config.json';
const STATE_FILE_MODE = 0o600;

export type Config = {
  host: string;
  port: number;
  publicUrl: string;
  protocols: string[];
  allowedHosts: string[];
  requestHistoryLimit: number;
  openBrowserOnStart: boolean;
};

export const DEFAULT_CONFIG: Config = {
  host: '127.0.0.1',
  port: 18765,
  publicUrl: 'http://host.docker.internal:18765',
  protocols: ['https'],
  allowedHosts: [],
  requestHistoryLimit: 200,
  openBrowserOnStart: false,
};

export function loadConfig(stateDir: string): Config {
  const configPath = path.resolve(stateDir, CONFIG_FILE_NAME);

  if (!existsSync(configPath)) {
    const defaultConfig = normalizeConfig(DEFAULT_CONFIG);
    saveConfig(stateDir, defaultConfig);

    return applyEnvOverrides(defaultConfig);
  }

  ensureStateFile(stateDir, CONFIG_FILE_NAME);

  const parsedConfig = parseConfigFile(configPath);
  const normalizedConfig = normalizeConfig({
    ...DEFAULT_CONFIG,
    ...parsedConfig,
  });

  return applyEnvOverrides(normalizedConfig);
}

export function saveConfig(stateDir: string, config: Config): void {
  const configPath = ensureStateFile(stateDir, CONFIG_FILE_NAME);
  const normalizedConfig = normalizeConfig(config);
  const serialized = `${JSON.stringify(normalizedConfig, null, 2)}\n`;

  writeFileSync(configPath, serialized, {
    encoding: 'utf-8',
  });
  chmodSync(configPath, STATE_FILE_MODE);
}

function applyEnvOverrides(config: Config): Config {
  const envOverrides: Partial<Record<keyof Config, unknown>> = {};

  if (isNonEmptyString(process.env.GIT_CRED_PROXY_HOST)) {
    envOverrides.host = process.env.GIT_CRED_PROXY_HOST;
  }

  if (isNonEmptyString(process.env.GIT_CRED_PROXY_PORT)) {
    envOverrides.port = process.env.GIT_CRED_PROXY_PORT;
  }

  if (isNonEmptyString(process.env.GIT_CRED_PROXY_PUBLIC_URL)) {
    envOverrides.publicUrl = process.env.GIT_CRED_PROXY_PUBLIC_URL;
  }

  if (typeof process.env.GIT_CRED_PROXY_PROTOCOLS === 'string') {
    envOverrides.protocols = splitCommaSeparated(process.env.GIT_CRED_PROXY_PROTOCOLS);
  }

  if (typeof process.env.GIT_CRED_PROXY_ALLOWED_HOSTS === 'string') {
    envOverrides.allowedHosts = splitCommaSeparated(process.env.GIT_CRED_PROXY_ALLOWED_HOSTS);
  }

  return normalizeConfig({
    ...config,
    ...envOverrides,
  });
}

function parseConfigFile(configPath: string): Record<string, unknown> {
  const raw = readFileSync(configPath, 'utf-8').trim();

  if (raw.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (!isObjectRecord(parsed)) {
      throw new Error('config.json must contain a JSON object');
    }

    return parsed;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse config at ${configPath}: ${reason}`);
  }
}

function normalizeConfig(input: Partial<Record<keyof Config, unknown>>): Config {
  const host = normalizeHost(input.host);
  const port = normalizePort(input.port);

  return {
    host,
    port,
    publicUrl: normalizePublicUrl(input.publicUrl),
    protocols: normalizeProtocols(input.protocols),
    allowedHosts: normalizeAllowedHosts(input.allowedHosts),
    requestHistoryLimit: normalizePositiveInteger(input.requestHistoryLimit, DEFAULT_CONFIG.requestHistoryLimit),
    openBrowserOnStart:
      typeof input.openBrowserOnStart === 'boolean' ? input.openBrowserOnStart : DEFAULT_CONFIG.openBrowserOnStart,
  };
}

function normalizeHost(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_CONFIG.host;
  }

  const host = value.trim();
  return host.length > 0 ? host : DEFAULT_CONFIG.host;
}

function normalizePublicUrl(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_CONFIG.publicUrl;
  }

  const publicUrl = value.trim();
  if (publicUrl.startsWith('http://') || publicUrl.startsWith('https://')) {
    return publicUrl;
  }

  return DEFAULT_CONFIG.publicUrl;
}

function normalizePort(value: unknown): number {
  const port = normalizePositiveInteger(value, DEFAULT_CONFIG.port);
  return port >= 1 && port <= 65_535 ? port : DEFAULT_CONFIG.port;
}

function normalizeProtocols(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_CONFIG.protocols];
  }

  const normalized = normalizeStringList(value);
  return normalized.length > 0 ? normalized : [...DEFAULT_CONFIG.protocols];
}

function normalizeAllowedHosts(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return normalizeStringList(value);
}

function normalizeStringList(values: unknown[]): string[] {
  const unique = new Set<string>();

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized.length === 0) {
      continue;
    }

    unique.add(normalized);
  }

  return [...unique];
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    return fallback;
  }

  return numericValue;
}

function splitCommaSeparated(value: string): string[] {
  return value.split(',');
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
