import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

export function loadLocalEnvFile(): void {
  if (existsSync('.env')) loadEnvFile('.env');
}
