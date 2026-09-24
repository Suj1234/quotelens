import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The award memo PDF reads its fonts (IBM Plex, has ₹) from disk at render time; ship them with the award routes.
  outputFileTracingIncludes: {
    "/api/award/*": ["src/lib/award/fonts/*.woff"],
    "/api/award/**/*": ["src/lib/award/fonts/*.woff"],
  },
};

export default nextConfig;
