// cPanel / Phusion Passenger CommonJS Startup Wrapper
// This file serves as the Application Startup File for cPanel "Setup Node.js App".
// Passenger executes this CJS file, sets the working directory, and dynamically imports the ESM build.

const path = require('node:path');
const fs = require('node:fs');

// Ensure the working directory is set to this application root directory
process.chdir(__dirname);

// Manually load .env if available, so environment variables are present before ESM module evaluation
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch (err) {
    console.warn('[app_wrapper] Warning: Failed to load .env using process.loadEnvFile:', err.message);
  }
}

// Pass Passenger's PORT / socket or environment overrides
if (process.env.PORT) {
  process.env.PORT = String(process.env.PORT);
}

// Dynamically import the compiled ESM main entry point
import('./dist/main.js').catch((err) => {
  console.error('[app_wrapper] Fatal error starting application from dist/main.js:', err);
  process.exit(1);
});
