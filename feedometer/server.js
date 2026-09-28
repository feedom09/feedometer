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

    // ── Static File Serving ──
    if (reqPath === '/' || reqPath === '') {
      reqPath = '/shell.html';
    }

    const filePath = path.resolve(ROOT, '.' + reqPath);

    // Security: prevent directory traversal
    if (!filePath.toLowerCase().startsWith(path.resolve(ROOT).toLowerCase())) {
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
    
    // Automatically launch the default browser if not disabled
    if (!process.env.FEEDOMETER_NO_OPEN && !process.env.CI) {
      try {
        if (process.platform === 'win32') {
          exec(`start "" "${appUrl}"`, () => {});
        } else if (process.platform === 'darwin') {
          exec(`open "${appUrl}"`, () => {});
        } else {
          exec(`xdg-open "${appUrl}"`, () => {});
        }
      } catch (_) {}
    }
  });
}

createServer(PORT);
