import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';

const distributionRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));
const assetRoot = resolve(distributionRoot, 'assets');
const index = readFile(resolve(distributionRoot, 'index.html'), 'utf8');
const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

export function registerMiniAppStatic<LoggerType extends FastifyBaseLogger>(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    LoggerType
  >,
): void {
  app.get('/mini-app/assets/*', async (request, reply) => {
    const relativePath = (request.params as { '*': string })['*'];
    const path = resolve(assetRoot, relativePath);
    if (!path.startsWith(`${assetRoot}${sep}`)) return reply.notFound();
    const contentType = contentTypes[extname(path)] ?? 'application/octet-stream';
    return reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .type(contentType)
      .send(await readFile(path));
  });
  const sendIndex = async (_request: FastifyRequest, reply: FastifyReply) =>
    reply
      .header('cache-control', 'no-cache')
      .type('text/html; charset=utf-8')
      .send(await index);
  app.get('/mini-app', sendIndex);
  app.get('/mini-app/', sendIndex);
  app.get('/mini-app/*', sendIndex);
}
