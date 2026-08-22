import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";

import { DATA_DIR } from "./config.ts";
import {
  decryptSecret,
  encryptSecret,
  isSecretEnvelope,
  resetSecretCryptoForTests,
} from "./secret-crypto.ts";

describe("secret-crypto", () => {
  beforeEach(() => {
    resetSecretCryptoForTests();
    mkdirSync(DATA_DIR, { recursive: true });
  });

  it("round-trips a secret through an envelope", () => {
    const env = encryptSecret("ck_test_value");
    expect(isSecretEnvelope(env)).toBe(true);
    expect(JSON.stringify(env)).not.toContain("ck_test_value");
    expect(decryptSecret(env)).toBe("ck_test_value");
  });

  it("passes through legacy plaintext strings", () => {
    expect(decryptSecret("already-plain")).toBe("already-plain");
    expect(decryptSecret({ nope: true })).toBeUndefined();
  });

  it("rejects a tampered envelope", () => {
    const env = encryptSecret("hello");
    env.ct = Buffer.from("nope").toString("base64");
    expect(() => decryptSecret(env)).toThrow();
  });
});

describe("config encrypt-on-disk", () => {
  beforeEach(async () => {
    resetSecretCryptoForTests();
    mkdirSync(DATA_DIR, { recursive: true });
  });

  it("writes envelopes and migrates leftover plaintext", async () => {
    const { saveConfig, loadConfig } = await import("./config.ts");
    saveConfig({ composio: { key: "ck_plain_on_save" } });
    const disk = JSON.parse(
      (await import("node:fs")).readFileSync(join(DATA_DIR, "config.json"), "utf8"),
    );
    expect(JSON.stringify(disk)).not.toContain("ck_plain_on_save");
    expect(isSecretEnvelope(disk.composio.key)).toBe(true);
    expect(loadConfig().composio?.key).toBe("ck_plain_on_save");

    writeFileSync(
      join(DATA_DIR, "config.json"),
      JSON.stringify({ composio: { key: "ck_legacy_plaintext" }, box: { token: "tok_legacy" } }, null, 2),
    );
    resetSecretCryptoForTests();
    const migrated = loadConfig();
    expect(migrated.composio?.key).toBe("ck_legacy_plaintext");
    expect(migrated.box?.token).toBe("tok_legacy");
    const after = JSON.parse(
      (await import("node:fs")).readFileSync(join(DATA_DIR, "config.json"), "utf8"),
    );
    expect(JSON.stringify(after)).not.toContain("ck_legacy_plaintext");
    expect(JSON.stringify(after)).not.toContain("tok_legacy");
    expect(isSecretEnvelope(after.composio.key)).toBe(true);
  });

  it("clears a secret when given an empty string", async () => {
    const { saveConfig, loadConfig } = await import("./config.ts");
    saveConfig({ box: { token: "tok_to_clear" } });
    expect(loadConfig().box?.token).toBe("tok_to_clear");
    saveConfig({ box: { token: "" } });
    expect(loadConfig().box?.token).toBeUndefined();
  });
});
