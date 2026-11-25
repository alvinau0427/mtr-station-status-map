/**
 * Production server: serves the built app and exposes the aggregator's
 * snapshot endpoints. Upstream APIs are called only by the aggregator.
 *
 * Usage: node server/line-status-proxy.js [port]
 * Render: PORT and APP_URL are injected as environment variables.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAggregator } from './aggregator.js';

const PORT = Number(process.env.PORT || process.argv[2] || 8787);
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const ROOT = fileURLToPath(new URL('../dist/', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8',
};

const aggregator = createAggregator();
aggregator.start();

const SNAPSHOT_ROUTES = {
  '/api/snapshot': aggregator.handleSnapshot,
  '/api/refresh': aggregator.handleRefresh,
  '/api/full-scan': aggregator.handleFullScan,
};

async function serveStatic(pathname, res) {
  const relative = normalize(pathname).replace(/^([/\\]|\.\.[/\\])+/, '');
  let file = join(ROOT, relative || 'index.html');
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(ROOT, 'index.html');
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

createServer(async (req, res) => {
  const pathname = req.url?.split('?')[0] ?? '/';
  const snapshotHandler = SNAPSHOT_ROUTES[pathname];
  if (snapshotHandler) {
    snapshotHandler(req, res);
    return;
  }

  await serveStatic(pathname, res);
}).listen(PORT, () => {
  console.log(`MTR status app + snapshot server listening on http://localhost:${PORT}`);
});

// Keep the Render free instance warm. Ping the static home page only, so no
// upstream API quota is consumed.
setInterval(() => {
  fetch(APP_URL).then((response) => {
    if (response.ok) console.log('Keep-alive ping succeeded');
  }).catch((error) => {
    console.error('Keep-alive ping failed:', error.message);
  });
}, 14 * 60 * 1000);
