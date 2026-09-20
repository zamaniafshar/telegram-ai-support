import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
export function loadLocalEnvFile() {
    if (existsSync('.env'))
        loadEnvFile('.env');
}
//# sourceMappingURL=load-env-file.js.map