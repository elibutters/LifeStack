import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// Local dev keeps one .env at the repo root. On Vercel, env comes from project settings.
const rootEnv = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  transpilePackages: ["@lifestack/db"],
  poweredByHeader: false,
};

export default config;
