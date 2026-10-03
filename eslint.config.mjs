import nextVitals from 'eslint-config-next/core-web-vitals';
import globals from 'globals';

const config = [
  ...nextVitals,
  { ignores: ['dist/**', 'release/**', 'android/**', '.local/**'] },
  { files: ['electron/**/*.js', 'tests/**/*.js', 'scripts/**/*.cjs', 'src/lib/google-drive.js'], languageOptions: { globals: globals.node } },
];

export default config;
