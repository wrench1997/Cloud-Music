const path = require('node:path');
const { createDownloadService } = require('../electron/download-service');
const root = path.join(__dirname, '..');
const service = createDownloadService({ toolsDir: path.join(root, '.local/media-tools'), outputDir: path.join(root, '.local/downloads') });
service.connect({ lan: process.argv.includes('--lan') }).then((info) => {
  console.log(`Download service: ${info.url}#${info.token}`);
  for (const link of info.pairingLinks) console.log(`Android pairing: ${link}`);
  console.log(`MP3 folder: ${info.outputDir}`);
}).catch((error) => { console.error(error.message); process.exitCode = 1; });
process.on('SIGINT', () => service.dispose());
process.on('SIGTERM', () => service.dispose());
