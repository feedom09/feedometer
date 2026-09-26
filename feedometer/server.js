/**
 * server.js — Zero-Dependency High-Performance Local Server for FeedOmeter 2.1
 * Built-in Node.js HTTP module with visual builder API proxy bridge and auto-port finding.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let PORT = 3000;
const ROOT = __dirname;

// In-memory store for feeds created by Visual RSS Studio (keyed by random ID)
const SAVED_FEEDS = new Map();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.xml': 'application/xml; charset=utf-8'
};

function createServer(port) {
  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:' + port}`);
    let reqPath = decodeURIComponent(parsedUrl.pathname);

    // ── Visual Builder Local API Handlers ──
    if (reqPath === '/api/builder/proxy') {
      const targetUrl = parsedUrl.searchParams.get('url');
      if (!targetUrl) {
        res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
        res.end('Missing url parameter');
        return;
      }
      try {
        const { fetchProxyPage } = await import('./workers/services/visual-builder-engine.js');
        const renderMode = parsedUrl.searchParams.get('render_mode') || 'auto';
        const proxyResult = await fetchProxyPage(targetUrl, null, { renderMode });
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'X-Frame-Options': 'ALLOWALL'
        });
        res.end(proxyResult.html);
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(`<html><body><h3>⚠️ Failed to load website into Visual Studio</h3><p>${err.message}</p></body></html>`);
      }
      return;
    }

    if (reqPath === '/api/builder/evaluate' && req.method === 'POST') {
      let bodyStr = '';
      req.on('data', chunk => { bodyStr += chunk; });
      req.on('end', async () => {
        try {
          const body = JSON.parse(bodyStr || '{}');
          const { fetchProxyPage, evaluateSelectorConfig } = await import('./workers/services/visual-builder-engine.js');
          const pageResult = await fetchProxyPage(body.url);
          const evalRes = evaluateSelectorConfig(pageResult.html, body.url, body.selectors || {});
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ status: 'success', matchCount: evalRes.matchCount, items: evalRes.items }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ status: 'error', message: e.message }));
        }
      });
      return;
    }

    if (reqPath === '/api/builder/save-config' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ status: 'success', message: 'Config saved locally' }));
      return;
    }

    if (reqPath === '/api/builder/feed') {
      const targetUrl = parsedUrl.searchParams.get('url');
      try {
        const { fetchProxyPage, evaluateSelectorConfig, buildRssXmlFromItems } = await import('./workers/services/visual-builder-engine.js');
        const pageResult = await fetchProxyPage(targetUrl);
        const evalRes = evaluateSelectorConfig(pageResult.html, targetUrl, {});
        const xml = buildRssXmlFromItems(evalRes.items, targetUrl);
        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(xml);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
        res.end('Feed generation error: ' + e.message);
      }
      return;
    }

    // ── Save exact selected-articles XML and return a stable feed URL ──
    if (reqPath === '/api/builder/save-feed' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
        SAVED_FEEDS.set(id, body);
        const feedUrl = `http://localhost:${port}/api/builder/saved-feed/${id}`;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ feedId: id, feedUrl }));
      });
      return;
    }

    // ── Serve a previously saved exact feed ──
    if (reqPath.startsWith('/api/builder/saved-feed/')) {
      const id = reqPath.replace('/api/builder/saved-feed/', '');
      const xml = SAVED_FEEDS.get(id);
      if (!xml) {
        res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
        res.end('Feed not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
      res.end(xml);
      return;
    }

    // ── Static File Serving ──
    if (reqPath === '/' || reqPath === '') {
      reqPath = '/shell.html';
    }

    const filePath = path.join(ROOT, reqPath);

    // Security: prevent directory traversal
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden');
      return;
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + reqPath);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });

    fs.createReadStream(filePath).pipe(res);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log('⚠️ Port ' + port + ' is busy, trying ' + (port + 1) + '...');
      createServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(port, () => {
    // The batch launcher supplies a local-API URL for end-to-end Worker tests.
    // Ordinary `node server.js` usage remains unchanged and opens the default shell.
    let appUrl = process.env.FEEDOMETER_START_URL || ('http://localhost:' + port + '/shell.html');
    try {
      const launchUrl = new URL(appUrl);
      if (launchUrl.hostname === 'localhost' && launchUrl.port === '3000' && port !== 3000) {
        launchUrl.port = String(port);
        appUrl = launchUrl.toString();
      }
    } catch (_) {}
    console.log('================================================================');
    console.log('🚀 FeedOmeter 2.1 is running at: ' + appUrl);
    console.log('================================================================');
    console.log('💡 Opening FeedOmeter in your browser...');
    console.log('💡 Press Ctrl+C at any time to stop the server.\n');
    
    // Automatically launch the default browser
    try {
      if (process.platform === 'win32') {
        exec(`start "" "${appUrl}"`);
      } else if (process.platform === 'darwin') {
        exec(`open "${appUrl}"`);
      } else {
        exec(`xdg-open "${appUrl}"`);
      }
    } catch (_) {}
  });
}

createServer(PORT);
