import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  transpilePackages: ["@understudy/protocol", "@understudy/characters"],
  serverExternalPackages: ["pg", "ws"],
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
};

export default config;
