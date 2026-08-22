// Security-gate coverage: the loopback browser defense (Host / Origin /
// Sec-Fetch-Site), artifact-serving denials, and write-only webhook secrets.
// The integration half boots the real harness like index.test.ts does, with
// one pinned unknown driver so the suite is deterministic offline.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import { resolveArtifactPath } from "./artifacts.ts";
import { requestLooksCrossSite } from "./harness-auth.ts";
import { createRoutine, listRoutines, publicRoutines } from "./routines.ts";

// ── unit: the cross-site detector ──────────────────────────────────────
describe("requestLooksCrossSite", () => {
  const bind = "127.0.0.1";

  it("accepts plain local requests (curl, Electron, the Vite proxy)", () => {
    expect(requestLooksCrossSite({ headers: { host: "127.0.0.1:8799" } }, bind)).toBe(false);
    expect(requestLooksCrossSite({ headers: { host: "localhost:8799" } }, bind)).toBe(false);
  });

  it("accepts the dev UI origin proxied to the harness", () => {
    expect(
      requestLooksCrossSite({ headers: { host: "127.0.0.1:8799", origin: "http://127.0.0.1:5199" } }, bind),
    ).toBe(false);
  });

  it("rejects a rebound foreign Host", () => {
    expect(requestLooksCrossSite({ headers: { host: "evil.example:8799" } }, bind)).toBe(true);
  });

  it("requires a Host header", () => {
    expect(requestLooksCrossSite({ headers: {} }, bind)).toBe(true);
  });

  it("rejects a foreign Origin or Referer", () => {
    expect(
      requestLooksCrossSite({ headers: { host: "127.0.0.1:8799", origin: "http://evil.example" } }, bind),
    ).toBe(true);
    expect(
      requestLooksCrossSite({ headers: { host: "127.0.0.1:8799", referer: "http://evil.example/page" } }, bind),
    ).toBe(true);
  });

  it("honors the browser's own cross-site marker", () => {
    expect(
      requestLooksCrossSite({ headers: { host: "127.0.0.1:8799", "sec-fetch-site": "cross-site" } }, bind),
    ).toBe(true);
    expect(
      requestLooksCrossSite({ headers: { host: "127.0.0.1:8799", "sec-fetch-site": "same-origin" } }, bind),
    ).toBe(false);
  });
});

// ── unit: artifact serving denials ─────────────────────────────────────
describe("artifact serving denials", () => {
  it("never serves the harness's own credentials", () => {
    mkdirSync(join(DATA_DIR, "wireguard"), { recursive: true });
    writeFileSync(join(DATA_DIR, "harness.json"), '{"token":"secret-token"}');
    writeFileSync(join(DATA_DIR, "steer.json"), '{"token":"secret-token"}');
    writeFileSync(join(DATA_DIR, "wireguard", "host.json"), '{"privateKey":"secret"}');
    expect(resolveArtifactPath(join(DATA_DIR, "harness.json"))).toBeNull();
    expect(resolveArtifactPath(join(DATA_DIR, "steer.json"))).toBeNull();
    expect(resolveArtifactPath(join(DATA_DIR, "wireguard", "host.json"))).toBeNull();
  });

  it("never serves dotfiles, but desk output still resolves", () => {
    const out = join(DATA_DIR, "desk", "sec-test", "out");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, ".env"), "SECRET=1");
    writeFileSync(join(out, "report.md"), "# report");
    expect(resolveArtifactPath(join(out, ".env"))).toBeNull();
    expect(resolveArtifactPath(join(out, "report.md"))).toBe(realpathSync(join(out, "report.md")));
  });
});

// ── unit: webhook secrets are write-only ───────────────────────────────
describe("routine webhook secrets", () => {
  it("public payloads carry hasSecret, never the value", () => {
    const routine = createRoutine({
      botId: "sec-test-bot",
      name: "hook",
      prompt: "p",
      kind: "webhook",
      webhookSecret: "s3cret-value",
      enabled: true,
    });
    const row = publicRoutines().find((r) => r.id === routine.id);
    expect(row).toBeDefined();
    expect(row!.webhookSecret).toBeUndefined();
    expect(row!.hasSecret).toBe(true);
    // the internal copy still carries the secret for header verification
    const internal = listRoutines().find((r) => r.id === routine.id);
    expect(internal?.webhookSecret).toBe("s3cret-value");
  });
});

// ── integration: the live server rejects cross-site API calls ─────────
const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const PORT = 28800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;

let child: ChildProcess;
let home: string;
let stderr = "";

const rawStatus = (headers: Record<string, string>, path = "/api/bots"): Promise<number> =>
  new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: PORT, path, method: "GET", headers },
      (res) => {
        resolve(res.statusCode ?? 0);
        res.resume();
      },
    );
    req.on("error", reject);
    req.end();
  });

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "nexbot-sec-test-"));
  mkdirSync(join(home, ".nexbot"), { recursive: true });
  writeFileSync(
    join(home, ".nexbot", "config.json"),
    JSON.stringify({ instances: { ghost: { driver: "not-a-real-driver", displayName: "Ghost" } } }),
  );
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home,
      USERPROFILE: home,
      NEXBOT_PORT: String(PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr!.on("data", (c) => (stderr += c));
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server never came up. stderr:\n${stderr}`);
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}. stderr:\n${stderr}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}, 30_000);

afterAll(async () => {
  child?.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.on("close", () => resolve());
    setTimeout(() => (child.kill("SIGKILL"), resolve()), 5_000).unref?.();
  });
  rmSync(home, { recursive: true, force: true });
});

describe("live harness cross-site gate", () => {
  it("serves normal loopback API requests", async () => {
    const res = await fetch(`${BASE}/api/bots`);
    expect(res.status).toBe(200);
  });

  it("rejects an API call with a foreign Origin header", async () => {
    const res = await fetch(`${BASE}/api/bots`, { headers: { origin: "http://evil.example" } });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/cross-origin/i);
  });

  it("rejects an API call with a rebound Host header", async () => {
    expect(await rawStatus({ host: "evil.example:8799" })).toBe(403);
  });

  it("rejects an API call the browser marks cross-site", async () => {
    expect(await rawStatus({ host: `127.0.0.1:${PORT}`, "sec-fetch-site": "cross-site" })).toBe(403);
  });

  it("keeps public paths (health, webhooks) reachable regardless", async () => {
    expect(await rawStatus({ host: "evil.example:8799" }, "/api/health")).toBe(200);
  });
});
