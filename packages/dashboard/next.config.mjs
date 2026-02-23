/**
 * @file packages/dashboard/next.config.mjs
 * @description Defines module behavior for the Adytum workspace.
 */

import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
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
    const gwPort = process.env.GATEWAY_PORT || 7431;
    // Use localhost to avoid EADDRNOTAVAIL on macOS when proxy connects to gateway (127.0.0.1 can fail in some network configs).
    return [
      {
        source: '/api/:path*',
        destination: `http://127.0.0.1:${gwPort}/api/:path*`,
      },
      {
        source: '/socket.io/:path*',
        destination: `http://127.0.0.1:${gwPort}/socket.io/:path*`,
      },
      {
        source: '/ws/:path*',
        destination: `http://127.0.0.1:${gwPort}/ws/:path*`,
      },
    ];
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
