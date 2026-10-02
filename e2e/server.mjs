import { createServer } from 'node:http';
import { appendFile, cp, mkdir, mkdtemp, readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Test-only server: exercise a copied production build, never the user's app data.
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const built = resolve(project, 'dist');
await stat(resolve(built, 'sw.js')).catch(() => {
  throw new Error('Build SmartRecall first: npm run build');
});
const cache = resolve(project, 'node_modules', '.cache');
await mkdir(cache, { recursive: true });
const fixture = await mkdtemp(resolve(cache, 'smartrecall-pwa-'));
await cp(built, fixture, { recursive: true });
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
let revision = 0;

const server = createServer(async (request, response) => {
  const path = new URL(request.url || '/', 'http://127.0.0.1:4175').pathname;
  if (path === '/__health') {
    response.writeHead(200, { 'Content-Type': 'text/plain' }).end('ready');
    return;
  }
  if (path === '/__test-update' && request.method === 'POST') {
    revision += 1;
    await appendFile(resolve(fixture, 'sw.js'), `\n// Isolated acceptance update ${revision}\n`);
    response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ revision }));
    return;
  }
  if (path === '/__test-shutdown' && request.method === 'POST') {
    response.writeHead(200, { 'Content-Type': 'text/plain' }).end('stopping', () => {
      server.closeAllConnections();
      server.close(() => process.exit(0));
    });
    return;
  }
  let target;
  try {
    target = resolve(fixture, `.${decodeURIComponent(path)}`);
    if (target !== fixture && !target.startsWith(`${fixture}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    if (!(await stat(target).catch(() => null))?.isFile()) target = resolve(fixture, 'index.html');
    const body = await readFile(target);
    response
      .writeHead(200, {
        'Content-Type': types[extname(target)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      })
      .end(body);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(4175, '127.0.0.1', () => {
  console.log('SmartRecall production acceptance server: http://127.0.0.1:4175');
});
