import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // argon2 is a native module and must not be bundled into the server chunk.
  serverExternalPackages: ["argon2"],
  experimental: {
    // Server Actions default to 1 MB. This is one MiB above the largest allowed
    // runtime setting for multipart overhead; application validation enforces
    // IMAGE_UPLOAD_MAX_MB (5 MiB by default) before anything is persisted.
    serverActions: { bodySizeLimit: "51mb" },
  },
};

export default withNextIntl(config);
