/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  assetPrefix: './',
  images: {
    unoptimized: true
  },
  webpack: (config) => {
    config.externals.push('better-sqlite3');
    return config;
  }
}

module.exports = nextConfig
