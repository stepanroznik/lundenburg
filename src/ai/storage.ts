import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { AiError } from './errors.js';

export interface Account {
  clientId: string; subject: string; issuer: string; email?: string;
  accessToken?: string; refreshToken?: string; idToken?: string;
  expiresAt: number; earliestRefreshAt: number; scopes: string[];
}
export interface Credentials { version: 1; hostId: string; active?: string; pendingClientId?: string; accounts: Record<string, Account> }

export function secureDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()) throw new AiError('configuration');
  fs.chmodSync(directory, 0o700);
}
export function atomicPrivateJson(file: string, data: unknown): void {
  secureDirectory(path.dirname(file));
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new AiError('configuration');
  const temp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
export class CredentialStore {
  readonly file: string;
  constructor(readonly directory: string) { this.file = path.join(directory, 'credentials.json'); }
  read(): Credentials | undefined {
    if (!fs.existsSync(this.file)) return undefined;
    const stat = fs.lstatSync(this.file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new AiError('configuration');
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Credentials;
      if (value.version !== 1 || !/^urn:uuid:[\da-f-]{36}$/.test(value.hostId) || !value.accounts || typeof value.accounts !== 'object') throw Error();
      return value;
    } catch { throw new AiError('configuration'); }
  }
  write(value: Credentials): void { atomicPrivateJson(this.file, value); }
  /** SQLite's OS locks serialize rotating tokens across processes, including crashes. */
  async locked<T>(action: () => Promise<T>): Promise<T> {
    secureDirectory(this.directory);
    const lock = path.join(this.directory, 'session-lock.sqlite');
    try { fs.closeSync(fs.openSync(lock, 'wx', 0o600)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new AiError('configuration'); }
    const stat = fs.lstatSync(lock);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new AiError('configuration');
    const database = new Database(lock, { timeout: 0 });
    const deadline = Date.now() + 120_000;
    try {
      while (true) {
        try { database.exec('BEGIN IMMEDIATE'); break; }
        catch (error) {
          if ((error as { code?: string }).code !== 'SQLITE_BUSY') throw new AiError('configuration');
          if (Date.now() > deadline) throw new AiError('service');
          await delay(100);
        }
      }
      try { return await action(); } finally { database.exec('ROLLBACK'); }
    } finally { database.close(); }
  }
  async initialize(): Promise<Credentials> {
    return this.locked(async () => {
      const saved = this.read(); if (saved) return saved;
      const created: Credentials = { version: 1, hostId: `urn:uuid:${randomUUID()}`, accounts: {} };
      this.write(created); return created;
    });
  }
}
