const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createDownloadService } = require('../electron/download-service');

function createWebApp({ root = path.resolve(__dirname, '../out'), service = createDownloadService({ toolsDir: path.resolve(__dirname, '../.local/media-tools'), outputDir: path.resolve(__dirname, '../.local/downloads') }) } = {}) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };
  const server = http.createServer(async (request, response) => {
    try {
      const port = server.address().port;
      const origins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
      const origin = `http://${request.headers.host}`;
      if (!origins.includes(origin)) { response.writeHead(403); response.end(); return; }
      const url = new URL(request.url, origin);
      if (url.pathname.startsWith('/api/download/')) {
        response.setHeader('Cache-Control', 'no-store');
        if ((request.headers.origin && request.headers.origin !== origin) || request.headers['sec-fetch-site'] === 'cross-site') {
          response.writeHead(403, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: '请在应用页面中使用下载功能。' })); return;
        }
        if (url.pathname === '/api/download/bootstrap' && request.method === 'GET') {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ url: '/api/download', token: '', integrated: true })); return;
        }
        request.url = url.pathname.slice('/api/download'.length) + url.search;
        await service.handleLocal(request, response); return;
      }
      let filename = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) { response.writeHead(403); response.end(); return; }
      if (fs.existsSync(filename) && fs.statSync(filename).isDirectory()) filename = path.join(filename, 'index.html');
      if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) { response.writeHead(404); response.end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(filename).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      if (response.headersSent) response.destroy();
      else { response.writeHead(500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: error.message })); }
    }
  });
  server.on('close', () => service.dispose());
  return server;
}
module.exports = { createWebApp };
