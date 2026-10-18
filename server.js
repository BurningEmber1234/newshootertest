#!/usr/bin/env node
/**
 * Zero-dependency static file server for RIFT//STRIKE.
 *
 *   npm run dev            # http://localhost:4173
 *   PORT=8080 npm run dev  # custom port
 *
 * The site is plain HTML/CSS/JS, so this only needs Node's standard library.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function resolvePath(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  } catch {
    return null;
  }

  // Never serve dotfiles/dot-directories (.git, .env, …) or dependencies.
  const segments = pathname.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment.startsWith('.') || segment === 'node_modules')) {
    return null;
  }

  const resolved = path.resolve(ROOT, '.' + path.posix.normalize(pathname));

  // Refuse anything that escapes the project directory.
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) return null;
  return { filePath: resolved, pathname: path.posix.normalize(pathname) };
}

async function sendFile(res, filePath, urlPath) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return sendNotFound(res);
  }

  if (stat.isDirectory()) {
    if (!urlPath.endsWith('/')) {
      // Redirect "/dir" -> "/dir/" so relative links resolve correctly.
      res.writeHead(301, { Location: urlPath + '/' });
      return res.end();
    }
    return sendFile(res, path.join(filePath, 'index.html'), urlPath + 'index.html');
  }

  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });

  if (res.req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

function sendNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 — Not found');
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end('Method not allowed');
  }

  const target = resolvePath(req.url || '/');
  if (!target) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 — Forbidden');
  }

  if (target.filePath === ROOT) {
    return sendFile(res, path.join(ROOT, 'index.html'), '/index.html');
  }
  return sendFile(res, target.filePath, target.pathname);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try: PORT=${PORT + 1} npm run dev`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
  console.log(`RIFT//STRIKE running at http://${shown}:${PORT}`);
  console.log('Press Ctrl+C to stop.');
});
