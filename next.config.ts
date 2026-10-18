import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  outputFileTracingIncludes: {
    "/*": ["./drizzle/**/*"],
  },
  poweredByHeader: false,
};

export default nextConfig;
