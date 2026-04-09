/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    GHOST_SEARCH_URL: process.env.GHOST_SEARCH_URL || 'http://localhost:8000',
  },
};

export default nextConfig;
