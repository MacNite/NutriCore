import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // argon2 is a native module and must not be bundled into the server chunk.
  serverExternalPackages: ["argon2"],
};

export default withNextIntl(config);
