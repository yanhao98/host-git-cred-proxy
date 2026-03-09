import { randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { chmod, rename, writeFile } from 'node:fs/promises';

import { ensureStateFile } from './state-dir';

const TOKEN_FILE_NAME = 'token';
const TOKEN_TMP_FILE_NAME = 'token.tmp';
const STATE_FILE_MODE = 0o600;

export class TokenService {
  private readonly stateDir: string;
  private readonly tokenFilePath: string;
  private token: string;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    this.tokenFilePath = ensureStateFile(stateDir, TOKEN_FILE_NAME);

    const existingToken = readFileSync(this.tokenFilePath, 'utf-8').trim();
    if (existingToken.length > 0) {
      this.token = existingToken;
      return;
    }

    this.token = generateToken();
    writeFileSync(this.tokenFilePath, `${this.token}\n`, {
      encoding: 'utf-8',
    });
    chmodSync(this.tokenFilePath, STATE_FILE_MODE);
  }

  getToken(): string {
    return this.token;
  }

  validateBearer(authHeader: string): boolean {
    const parts = authHeader.split(' ');
    if (parts.length !== 2) {
      return false;
    }

    const [scheme, candidateToken] = parts;
    if (scheme !== 'Bearer' || candidateToken.length === 0) {
      return false;
    }

    return candidateToken === this.token;
  }

  async rotate(): Promise<{ tokenFilePath: string }> {
    const nextToken = generateToken();
    const tokenTmpPath = ensureStateFile(this.stateDir, TOKEN_TMP_FILE_NAME);

    await writeFile(tokenTmpPath, `${nextToken}\n`, {
      encoding: 'utf-8',
    });
    await chmod(tokenTmpPath, STATE_FILE_MODE);
    await rename(tokenTmpPath, this.tokenFilePath);

    this.token = nextToken;

    return {
      tokenFilePath: this.tokenFilePath,
    };
  }
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}
