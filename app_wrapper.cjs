const path = require('node:path');
const fs = require('node:fs');

process.chdir(__dirname);

// Keep Prisma thread limits active
process.env.TOKIO_WORKER_THREADS = '1';
process.env.RAYON_NUM_THREADS = '1';
process.env.UV_THREADPOOL_SIZE = '2';

// Load .env variables
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch (err) {}
}

import('./dist/main.js').catch((err) => {
  console.error('[app_wrapper] Fatal error starting dist/main.js:', err);
  process.exit(1);
});
