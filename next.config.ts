import type { NextConfig } from "next";

const detailPageStudioOrigins = [
  "https://commerce-os-detail-page-studio.vercel.app",
  "https://commerce-os-detail-page-studio-pzxe.vercel.app",
  "https://commerce-os-detail-page-studio-git-agent-ops-l-6edf36-a2bsangsa.vercel.app",
  "https://commerce-os-detail-page-studio-git-isolated-op-4a07df-a2bsangsa.vercel.app",
];
const localNetworkPolicy = `(self ${detailPageStudioOrigins
  .map((origin) => `"${origin}"`)
  .join(" ")})`;

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/api/product-launch-tracker/optimized",
          destination: "/api/product-launch-tracker/normalized-optimized",
        },
        {
          source: "/api/product-launch-tracker/state",
          destination: "/api/product-launch-tracker/normalized-state",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Permissions-Policy",
            value: [
              `local-network=${localNetworkPolicy}`,
              `loopback-network=${localNetworkPolicy}`,
              `local-network-access=${localNetworkPolicy}`,
            ].join(", "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
