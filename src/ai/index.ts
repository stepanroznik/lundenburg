import type Database from 'better-sqlite3';
import { AiService, type AiLog } from './service.js';
import { ChatGptAuth } from './auth.js';
import { CredentialStore } from './storage.js';
import { aiConfig } from './config.js';

export { AiService, responseText, type AiRequest, type AiResponse, type AiLog } from './service.js';
export { AiError, usageSettings } from './errors.js';
export { ChatGptAuth } from './auth.js';
export { CredentialStore } from './storage.js';
export { aiConfig } from './config.js';
export { germanEpg } from './metadata.js';

/** Shared entry point for preparation jobs; caller owns the persistent SQLite database. */
export function createAiService(database: Database.Database, projectRoot: string, log?: AiLog): AiService {
  const config = aiConfig(projectRoot);
  return new AiService(database, new ChatGptAuth(new CredentialStore(config.credentialsDirectory)), undefined, log);
}
