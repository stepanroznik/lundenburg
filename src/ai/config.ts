import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { AiError } from './errors.js';
export interface AiConfig { provider: 'chatgpt'; model: string; credentialsDirectory: string }
export function aiConfig(projectRoot: string): AiConfig {
  const file = path.join(projectRoot, 'config/ai.yaml');
  const saved = fs.existsSync(file) ? parse(fs.readFileSync(file, 'utf8')) : {};
  if (saved?.provider && saved.provider !== 'chatgpt') throw new AiError('configuration');
  const directory = process.env.LKP_AI_CREDENTIALS_DIR ?? saved?.credentialsDirectory ?? 'runtime/ai';
  const model = process.env.LKP_AI_MODEL ?? saved?.model ?? 'auto-small';
  if (typeof directory !== 'string' || typeof model !== 'string') throw new AiError('configuration');
  return { provider: 'chatgpt', model, credentialsDirectory: path.resolve(projectRoot, directory) };
}
