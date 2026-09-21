/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@ceo-agent/shared", "@ceo-agent/db", "@ceo-agent/queue", "@ceo-agent/agents"],
  experimental: {
    serverComponentsExternalPackages: ["postgres", "ioredis", "bullmq"],
  },
  async redirects() {
    return [
      {
        source: "/w/:slug/campaigns/:id/ai-stories/new",
        destination: "/w/:slug/campaigns/:id/ai-stories/episodes/new",
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
