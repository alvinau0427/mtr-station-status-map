/**
 * Production server: serves the built app and proxies the two upstream APIs.
 *   /api/line-status -> https://tnews.mtr.com.hk/alert/ryg_line_status.xml
 *   /api/schedule    -> https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php<query>
 *
 * Usage: node server/line-status-proxy.js [port]
 * Render: PORT and APP_URL are injected as environment variables.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || process.argv[2] || 8787);
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const ROOT = fileURLToPath(new URL('../dist/', import.meta.url));

const ROUTES = [
  { prefix: '/api/line-status', target: 'https://tnews.mtr.com.hk/alert/ryg_line_status.xml', type: 'text/xml; charset=utf-8', ttl: 60 },
  { prefix: '/api/schedule', target: 'https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php', type: 'application/json; charset=utf-8', ttl: 10 },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8',
};

const cache = new Map();

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
  const route = ROUTES.find((r) => req.url?.startsWith(r.prefix));
  if (!route) {
    await serveStatic(req.url?.split('?')[0] ?? '/', res);
    return;
  }

  const query = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const cacheKey = `${route.prefix}${query}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < route.ttl * 1000) {
    res.writeHead(200, {
      'Content-Type': route.type,
      'Cache-Control': `public, max-age=${route.ttl}`,
      'Access-Control-Allow-Origin': '*',
      'X-Cache': 'HIT',
    });
    res.end(cached.body);
    return;
  }

  try {
    const upstream = await fetch(`${route.target}${query}`, {
      headers: { 'User-Agent': 'mtr-station-status-map/1.0.0', Accept: '*/*' },
    });
    const body = await upstream.text();
    if (upstream.ok) cache.set(cacheKey, { at: Date.now(), body });
    const headers = {
      'Content-Type': route.type,
      'Cache-Control': `public, max-age=${route.ttl}`,
      'Access-Control-Allow-Origin': '*',
      'X-Cache': 'MISS',
    };
    const retryAfter = upstream.headers.get('retry-after');
    if (upstream.status === 429 && retryAfter) headers['Retry-After'] = retryAfter;
    res.writeHead(upstream.status, headers);
    res.end(body);
  } catch (error) {
    if (cached) {
      res.writeHead(200, {
        'Content-Type': route.type,
        'Cache-Control': `public, max-age=${route.ttl}`,
        'Access-Control-Allow-Origin': '*',
        'X-Cache': 'STALE',
      });
      res.end(cached.body);
    } else {
      res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end(`Upstream error: ${error.message}`);
    }
  }
}).listen(PORT, () => {
  console.log(`MTR status app + proxy listening on http://localhost:${PORT}`);
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
