import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadLocalEnvFile } from '../config/load-env-file.js';

loadLocalEnvFile();

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is missing from .env');

const url = new URL(databaseUrl);
if (url.protocol !== 'mysql:') throw new Error('DATABASE_URL must use the mysql: protocol');
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
  throw new Error('This setup command is restricted to a local MySQL server');
}

const database = url.pathname.slice(1);
const username = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
const safeIdentifier = /^[a-zA-Z0-9_]+$/;
if (!safeIdentifier.test(database) || !safeIdentifier.test(username)) {
  throw new Error('Database and user names may contain only letters, numbers, and underscores');
}
if (!password || /[\0\r\n]/u.test(password)) {
  throw new Error('DATABASE_URL must contain a non-empty password without control characters');
}

const mysqlBin = process.env['MYSQL_CLIENT_BIN'] ?? '/Volumes/ExternalSSD/MySQL/server/bin/mysql';
const socket = process.env['MYSQL_SOCKET'] ?? '/Volumes/ExternalSSD/MySQL/mysql.sock';
if (!existsSync(mysqlBin)) throw new Error(`MySQL client not found at ${mysqlBin}`);
if (!existsSync(socket)) throw new Error(`MySQL socket not found at ${socket}`);

const sqlString = (value: string): string =>
  `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
const sql = `
CREATE DATABASE IF NOT EXISTS \`${database}\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS ${sqlString(username)}@'localhost'
  IDENTIFIED WITH caching_sha2_password BY ${sqlString(password)};
ALTER USER ${sqlString(username)}@'localhost'
  IDENTIFIED WITH caching_sha2_password BY ${sqlString(password)};
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES
  ON \`${database}\`.* TO ${sqlString(username)}@'localhost';
`;

console.log('Enter the MySQL root password at the prompt. It will not be stored or displayed.');
const result = spawnSync(
  mysqlBin,
  ['--protocol=SOCKET', `--socket=${socket}`, '--user=root', '--password'],
  { input: sql, stdio: ['pipe', 'inherit', 'inherit'] },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`MySQL database ${database} and application user ${username} are ready.`);
