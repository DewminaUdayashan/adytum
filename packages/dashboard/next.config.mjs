import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@adytum/shared'],
  webpack: (config) => {
    // In this monorepo, gateway depends on React 18 (via ink) and dashboard
    // uses React 19. Ensure webpack resolves React from dashboard's own
    // node_modules first to prevent version mismatch.
    config.resolve.modules = [
      resolve(__dirname, 'node_modules'),
      ...(config.resolve.modules || ['node_modules']),
    ];
    return config;
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:3001/api/:path*',
      },
    ];
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
