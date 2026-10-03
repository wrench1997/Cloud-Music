const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const res = path.join(root, 'android/app/src/main/res');

async function write(relativePath, data) {
  const destination = path.join(root, relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, data);
}

async function main() {
  const source = await fs.readFile(path.join(root, 'public/icon.svg'));
  const glyph = source.toString().match(/\bd="([^"]+)"/)[1];
  await write('public/icon.png', await sharp(source).png().toBuffer());

  // A multi-resolution ICO is used by Windows Explorer, shortcuts and the tray.
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const frames = await Promise.all(sizes.map((size) => sharp(source).resize(size, size).png().toBuffer()));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  frames.forEach((frame, index) => {
    const start = 6 + index * 16;
    header[start] = header[start + 1] = sizes[index] === 256 ? 0 : sizes[index];
    header.writeUInt16LE(1, start + 4);
    header.writeUInt16LE(32, start + 6);
    header.writeUInt32LE(frame.length, start + 8);
    header.writeUInt32LE(offset, start + 12);
    offset += frame.length;
  });
  await write('public/icon.ico', Buffer.concat([header, ...frames]));

  const round = Buffer.from(source.toString().replace('<rect width="512" height="512" rx="120"', '<rect width="512" height="512" rx="256"'));
  // Adaptive layers use a full 108 dp canvas, keeping the mark inside the safe area.
  const foreground = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108"><path fill="#fff" transform="translate(21.6 21.6) scale(2.7)" d="${glyph}"/></svg>`);
  for (const [density, scale] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]) {
    const directory = path.relative(root, path.join(res, `mipmap-${density}`));
    await write(path.join(directory, 'ic_launcher.png'), await sharp(source).resize(48 * scale).png().toBuffer());
    await write(path.join(directory, 'ic_launcher_round.png'), await sharp(round).resize(48 * scale).png().toBuffer());
    await write(path.join(directory, 'ic_launcher_foreground.png'), await sharp(foreground).resize(108 * scale).png().toBuffer());
  }
  const vector = `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">\n    <group android:translateX="21.6" android:translateY="21.6" android:scaleX="2.7" android:scaleY="2.7">\n        <path android:fillColor="#FFFFFFFF" android:pathData="${glyph}" />\n    </group>\n</vector>\n`;
  await write('android/app/src/main/res/drawable/ic_launcher_monochrome.xml', vector);
  await write('android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml', vector);
  await write('android/app/src/main/res/drawable/ic_music_notification.xml', `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">\n    <path android:fillColor="#FFFFFFFF" android:pathData="${glyph}" />\n</vector>\n`);
  console.log('Generated Windows ICO/PNG and Android launcher/adaptive/themed icons from public/icon.svg.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
