import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root. Without it Turbopack walks upward looking for
  // a lockfile, finds one in the home directory, and warns that it would
  // pull the entire home tree into the build graph.
  turbopack: { root: path.resolve(process.cwd()) },
  // The contract address is read at runtime from the environment. A
  // missing one must surface in the UI as a stated error (§59), never as
  // a fabricated default and never as a build failure.
};

export default config;
