import { randomBytes } from 'node:crypto';

export class AdminNonceService {
  private nonce: string;

  constructor() {
    this.nonce = randomBytes(32).toString('hex');
  }

  getNonce(): string {
    return this.nonce;
  }

  refresh(): string {
    this.nonce = randomBytes(32).toString('hex');
    return this.nonce;
  }

  validate(value: string): boolean {
    return value === this.nonce;
  }
}
