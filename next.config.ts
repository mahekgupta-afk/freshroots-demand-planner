import type { NextConfig } from "next";

const config: NextConfig = {
  // Sample CSVs are read at runtime; make sure Vercel bundles them.
  outputFileTracingIncludes: { "/*": ["./data/sample/**", "./config/**"] },
};
export default config;
