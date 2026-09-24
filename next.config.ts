import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Google ADK (P9 agents) is loaded from node_modules at runtime: its optional peers (MikroORM drivers, GCS, express)
  // are not installed and must not be bundled.
  serverExternalPackages: ["@google/adk"],
  // The award memo PDF reads its fonts (IBM Plex, has ₹) from disk at render time; ship them with the award routes.
  outputFileTracingIncludes: {
    "/api/award/*": ["src/lib/award/fonts/*.woff"],
    "/api/award/**/*": ["src/lib/award/fonts/*.woff"],
  },
};

export default nextConfig;
