import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const distributionRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));
const assetRoot = resolve(distributionRoot, 'assets');
const index = readFile(resolve(distributionRoot, 'index.html'), 'utf8');
const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
};
export function registerMiniAppStatic(app) {
    app.get('/mini-app/assets/*', async (request, reply) => {
        const relativePath = request.params['*'];
        const path = resolve(assetRoot, relativePath);
        if (!path.startsWith(`${assetRoot}${sep}`))
            return reply.notFound();
        const contentType = contentTypes[extname(path)] ?? 'application/octet-stream';
        return reply
            .header('cache-control', 'public, max-age=31536000, immutable')
            .type(contentType)
            .send(await readFile(path));
    });
    const sendIndex = async (_request, reply) => reply
        .header('cache-control', 'no-cache')
        .type('text/html; charset=utf-8')
        .send(await index);
    app.get('/mini-app', sendIndex);
    app.get('/mini-app/', sendIndex);
    app.get('/mini-app/*', sendIndex);
}
//# sourceMappingURL=static.js.map