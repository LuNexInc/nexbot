import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ServerResponse } from "node:http";

// serveArtifact expects a ServerResponse; this mock provides the slice it
// touches (writeHead/end) and captures state — cast at the library boundary.
function mkRes() {
  const state = { code: 0, headers: {} as Record<string, string>, body: "" };
  const res = {
    writeHead(code: number, headers?: Record<string, string>) {
      state.code = code;
      if (headers) state.headers = headers;
    },
    end(chunk?: string | Buffer) {
      state.body = typeof chunk === "string" ? chunk : chunk != null ? chunk.toString() : "";
    },
  } as unknown as ServerResponse;
  return { res, state };
}

const saved = process.env.NEXBOT_DATA_DIR;

// The harness attaches to this dir as an allowed root via DATA_DIR/desk.
let deskRoot: string;

beforeAll(() => {
  // Sandbox so fixtures land under an allowed root and the real ~/.nexbot is untouched.
  process.env.NEXBOT_DATA_DIR = mkdtempSync(join(tmpdir(), "nexbot-art-"));
  deskRoot = join(process.env.NEXBOT_DATA_DIR, "desk");
  mkdirSync(deskRoot, { recursive: true });
  writeFileSync(join(deskRoot, "ok.txt"), "hello");
  writeFileSync(join(deskRoot, ".env"), "SECRET=1");
  writeFileSync(join(deskRoot, "SECRETS.md"), "# a secret");
  writeFileSync(join(deskRoot, "secrets.txt"), "s");
  writeFileSync(join(deskRoot, "tokens.md"), "t");
  writeFileSync(join(deskRoot, "API_KEYS.md"), "k");
  writeFileSync(join(deskRoot, "auth.json"), "{}");
  writeFileSync(join(deskRoot, "service-account.json"), "{}");
  writeFileSync(join(deskRoot, "harness.json"), "{}");
  writeFileSync(join(deskRoot, "big.bin"), Buffer.alloc(33 * 1024 * 1024));
});

afterAll(() => {
  if (saved === undefined) delete process.env.NEXBOT_DATA_DIR;
  else process.env.NEXBOT_DATA_DIR = saved;
  vi.resetModules();
  if (process.env.NEXBOT_DATA_DIR) rmSync(process.env.NEXBOT_DATA_DIR, { recursive: true, force: true });
});

async function artifacts() {
  vi.resetModules();
  return import("./artifacts.ts");
}

describe("resolveArtifactPath security boundary", () => {
  it("resolves a legit file under the data-dir desk allowed root", async () => {
    const { resolveArtifactPath } = await artifacts();
    expect(resolveArtifactPath(join(deskRoot, "ok.txt"))).toBe(join(deskRoot, "ok.txt"));
  });

  it("resolves a file:// URL for an allowlisted file", async () => {
    const { resolveArtifactPath } = await artifacts();
    expect(resolveArtifactPath(pathToFileURL(join(deskRoot, "ok.txt")).href)).toBe(join(deskRoot, "ok.txt"));
  });

  it("rejects traversal out of the allowed root", async () => {
    const { resolveArtifactPath } = await artifacts();
    expect(resolveArtifactPath(join(deskRoot, "..", "x.txt"))).toBeNull();
  });

  it("rejects non-absolute / unsupported scheme references", async () => {
    const { resolveArtifactPath } = await artifacts();
    expect(resolveArtifactPath("relative/path.txt")).toBeNull();
    expect(resolveArtifactPath("https://example.com/file.png")).toBeNull();
    expect(resolveArtifactPath("")).toBeNull();
  });

  it("denies dotfiles", async () => {
    const { resolveArtifactPath } = await artifacts();
    expect(resolveArtifactPath(join(deskRoot, ".env"))).toBeNull();
  });

  it("denies data-dir token/key files by basename", async () => {
    const { resolveArtifactPath } = await artifacts();
    expect(resolveArtifactPath(join(deskRoot, "harness.json"))).toBeNull();
  });

  it("denies non-dotfile secret basenames (SECRETS.md, credentials, master.key)", async () => {
    const { resolveArtifactPath } = await artifacts();
    expect(resolveArtifactPath(join(deskRoot, "SECRETS.md"))).toBeNull();
    expect(resolveArtifactPath(join(deskRoot, "master.key"))).toBeNull();
    expect(resolveArtifactPath(join(deskRoot, "SECRETS.md"))).toBeNull();
    expect(resolveArtifactPath(join(deskRoot, "master.key"))).toBeNull();
    expect(resolveArtifactPath(join(deskRoot, "secrets.txt"))).toBeNull();
    expect(resolveArtifactPath(join(deskRoot, "tokens.md"))).toBeNull();
    expect(resolveArtifactPath(join(deskRoot, "API_KEYS.md"))).toBeNull();
    expect(resolveArtifactPath(join(deskRoot, "auth.json"))).toBeNull();
    expect(resolveArtifactPath(join(deskRoot, "service-account.json"))).toBeNull();
  });

  it("rejects files over the 32MB artifact size limit", async () => {
    const { resolveArtifactPath } = await artifacts();
    expect(resolveArtifactPath(join(deskRoot, "big.bin"))).toBeNull();
  });

  it("rejects unsupported extensions", async () => {
    const { resolveArtifactPath } = await artifacts();
    expect(resolveArtifactPath(join(deskRoot, "ok.exe"))).toBeNull();
  });

  it("rejects a reference that resolves outside an allowed root via symlink", async () => {
    const { resolveArtifactPath } = await artifacts();
    const outside = join(process.env.NEXBOT_DATA_DIR!, "outside.txt");
    writeFileSync(outside, "secret");
    const link = join(deskRoot, "escape.txt");
    try {
      symlinkSync(outside, link);
    } catch {
      return; // symlink may be unavailable; skip rather than assert
    }
    expect(resolveArtifactPath(link)).toBeNull();
  });

  it("serveArtifact 404s a denied/unknown reference", async () => {
    const { serveArtifact } = await artifacts();
    const { res, state } = mkRes();
    const served = serveArtifact(res, join(deskRoot, ".env"));
    expect(served).toBe(true);
    expect(state.code).toBe(404);
  });

  it("serveArtifact 200s a valid allowlisted file", async () => {
    const { serveArtifact } = await artifacts();
    const { res, state } = mkRes();
    serveArtifact(res, join(deskRoot, "ok.txt"));
    expect(state.code).toBe(200);
    expect(state.body).toContain("hello");
  });

  it("renderArtifactsForReply returns a matching fresh image from the bot out dir", async () => {
    const { renderArtifactsForReply } = await artifacts();
    const bot = "renderbot";
    const out = join(deskRoot, bot, "out");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "render-poster.png"), "png");
    const found = renderArtifactsForReply(bot, "here is the final render poster");
    expect(found.some((a) => a.name === "render-poster.png")).toBe(true);
  });
});
