const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createWebApp } = require('./web-app.cjs');
if (!fs.existsSync(path.resolve(__dirname, '../out/index.html'))) {
  console.error('Please build the application first: npm run build');
  process.exit(1);
}
const server = createWebApp();
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(3000, '127.0.0.1', () => console.log('Music web app + download backend: http://localhost:3000'));
const redirect = http.createServer((_request, response) => {
  response.writeHead(302, { Location: 'http://localhost:3000/', 'Cache-Control': 'no-store' }); response.end();
});
redirect.on('error', (error) => console.error(`Legacy preview redirect: ${error.message}`));
redirect.listen(3077, '127.0.0.1');
function close() { server.closeAllConnections(); server.close(); redirect.closeAllConnections(); redirect.close(); }
process.on('SIGINT', close);
process.on('SIGTERM', close);
