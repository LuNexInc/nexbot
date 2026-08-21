import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { artifactMime, resolveArtifactPath } from "./artifacts.ts";

describe("local chat artifacts", () => {
  it("resolves allowlisted file URLs and keeps their canonical path", () => {
    const file = join(DATA_DIR, "bots.json");
    if (!existsSync(file)) return;
    expect(resolveArtifactPath(pathToFileURL(file).href)).toBe(realpathSync(file));
  });

  it("rejects traversal and unsupported files", () => {
    expect(resolveArtifactPath(join(DATA_DIR, "..", "secrets.txt"))).toBeNull();
    expect(resolveArtifactPath("https://example.com/file.png")).toBeNull();
  });

  it("reports preview MIME types", () => {
    expect(artifactMime("poster.jpg")).toBe("image/jpeg");
    expect(artifactMime("brief.md")).toMatch(/^text\/markdown/);
  });
});

