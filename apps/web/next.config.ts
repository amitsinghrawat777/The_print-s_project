import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@prints/shared"],
  // keep the dev badge away from the bottom bar with the order total
  devIndicators: { position: "top-right" },
  // Lets a phone on the same Wi-Fi open the dev server, e.g. ALLOWED_DEV_ORIGINS=192.168.1.20
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS?.split(",").filter(Boolean),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
