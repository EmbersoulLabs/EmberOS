/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@ceo-agent/shared", "@ceo-agent/db", "@ceo-agent/queue", "@ceo-agent/agents"],
  experimental: {
    serverComponentsExternalPackages: ["postgres"],
  },
};

module.exports = nextConfig;
