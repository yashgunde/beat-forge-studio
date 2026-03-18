import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Turbopack: force tone to ESM entry (UMD build/Tone.js has no named exports)
  // Note: Next.js 15.2.x uses experimental.turbo, not the top-level turbopack key
  experimental: {
    turbo: {
      resolveAlias: {
        tone: 'tone/build/esm/index.js',
      },
    },
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      os: false,
    };
    return config;
  },
};

export default nextConfig;
