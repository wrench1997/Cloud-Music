const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../out');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('Run npm run build before npm run preview.');
  process.exit(1);
}

const server = http.createServer((request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost:3000');
    let filename = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403); response.end(); return;
    }
    if (fs.existsSync(filename) && fs.statSync(filename).isDirectory()) filename = path.join(filename, 'index.html');
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      response.writeHead(404); response.end('Not found'); return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(filename).on('error', () => response.destroy()).pipe(response);
  } catch { response.writeHead(400); response.end('Bad request'); }
});
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(3000, '127.0.0.1', () => console.log('Preview: http://localhost:3000 (configured Google OAuth origin)'));

// Old preview bookmarks must return to the configured origin before Google sign-in.
const redirect = http.createServer((_request, response) => {
  response.writeHead(302, { Location: 'http://localhost:3000/', 'Cache-Control': 'no-store' });
  response.end();
});
redirect.on('error', (error) => console.error(`Legacy preview redirect: ${error.message}`));
redirect.listen(3077, '127.0.0.1');
function close() { server.close(); redirect.close(); }
process.on('SIGINT', close);
process.on('SIGTERM', close);
