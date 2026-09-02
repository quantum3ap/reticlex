#!/usr/bin/env node
/**
 * Static file server for developing the front end in a browser.
 *
 * The application ships inside a WebView2 host, but the UI is written to run
 * anywhere: with no host present the bridge falls back to localStorage, so
 * every screen is usable here. Serves the repository root so /frontend,
 * /localization and /presets all resolve exactly as they do in the app.
 *
 *   node scripts/dev-server.js [port]
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://localhost:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);
    // Redirect rather than rewrite: the page's relative URLs reach up to
    // /localization and /presets, exactly as they do under the WebView2 host,
    // so the browser's base URL has to be /frontend/.
    if (pathname === '/' || pathname === '/index.html') {
      response.writeHead(302, { Location: '/frontend/index.html' }).end();
      return;
    }

    // Refuse anything that escapes the repository root.
    const target = resolve(ROOT, `.${normalize(pathname)}`);
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    let filePath = target;
    const info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) filePath = join(filePath, 'index.html');

    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': TYPES[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : 500;
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(status === 404 ? 'Not found' : `Server error: ${error.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`ReticleX dev server: http://localhost:${PORT}/`);
});
