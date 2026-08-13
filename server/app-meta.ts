// App version + public config status (secrets never echoed).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "./config.ts";
import { DATA_DIR } from "./config.ts";

const FALLBACK_VERSION = "0.3.8";

export function appVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (pkg?.version) return String(pkg.version);
  } catch {
    /* packaged layout falls through */
  }
  if (process.env.npm_package_version) return process.env.npm_package_version;
  return FALLBACK_VERSION;
}

export function configStatus(cfg: AppConfig) {
  return {
    xai: { configured: Boolean(cfg.xai?.key) },
    composio: { configured: Boolean(cfg.composio?.key), apiKeyConfigured: Boolean(cfg.composio?.apiKey) },
    box: { configured: Boolean(cfg.box?.token) },
    // not a secret — the sidebar shows it
    profile: { name: cfg.profile?.name ?? "", email: cfg.profile?.email ?? "" },
    // app meta for the settings panel (not secrets)
    dataDir: DATA_DIR,
    version: appVersion(),
    platform: process.platform,
  };
}
