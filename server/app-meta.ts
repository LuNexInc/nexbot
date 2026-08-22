// App version + public config status (secrets never echoed).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "./config.ts";
import { DATA_DIR, wipePassword } from "./config.ts";
import { EVENT_LOG_MAX_BYTES, EVENT_LOG_RETAIN_MS, nativeLogEnabled } from "./event-log.ts";
import { remoteAccessStatus } from "./remote-access.ts";

const FALLBACK_VERSION = "0.0.0-dev";

export function appVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (pkg?.version) return String(pkg.version);
  } catch {
    /* packaged layout falls through */
  }
  // Packaged builds get the version injected by Electron's main process.
  if (process.env.NEXBOT_VERSION) return process.env.NEXBOT_VERSION;
  if (process.env.npm_package_version) return process.env.npm_package_version;
  return FALLBACK_VERSION;
}

export function configStatus(cfg: AppConfig, currentBind?: string) {
  return {
    xai: { configured: Boolean(cfg.xai?.key) },
    composio: { configured: Boolean(cfg.composio?.key), apiKeyConfigured: Boolean(cfg.composio?.apiKey) },
    box: { configured: Boolean(cfg.box?.token) },
    // not a secret — the sidebar shows it
    profile: {
      name: cfg.profile?.name ?? "",
      email: cfg.profile?.email ?? "",
      ...(cfg.profile?.companyName ? { companyName: cfg.profile.companyName } : {}),
    },
    remoteAccess: remoteAccessStatus(cfg, currentBind),
    // app meta for the settings panel (not secrets)
    dataDir: DATA_DIR,
    wipeConfigured: Boolean(wipePassword()),
    version: appVersion(),
    platform: process.platform,
    logs: {
      native: nativeLogEnabled(),
      maxBytes: EVENT_LOG_MAX_BYTES,
      retainDays: Math.round(EVENT_LOG_RETAIN_MS / 86_400_000),
    },
  };
}
