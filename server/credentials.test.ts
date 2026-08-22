import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { closeStoreDb, openStoreDb } from "./db.ts";
import { createCredential, credentialsForBot, revealGrantedCredential, setCredentialGrants } from "./credentials.ts";
import { resetSecretCryptoForTests } from "./secret-crypto.ts";

beforeEach(() => { closeStoreDb(); rmSync(DATA_DIR, { recursive: true, force: true }); resetSecretCryptoForTests(); });

describe("credential vault grants", () => {
  it("encrypts values and enforces per-bot access", () => {
    const saved = createCredential({ label: "Staging login", envName: "STAGING_PASSWORD", secret: "very-secret", botIds: ["bot-a"] });
    const raw = openStoreDb().prepare("SELECT json FROM credentials WHERE id = ?").get(saved.id) as { json: string };
    expect(raw.json).not.toContain("very-secret");
    expect(credentialsForBot("bot-a")[0]?.label).toBe("Staging login");
    expect(revealGrantedCredential(saved.id, "bot-a")?.secret).toBe("very-secret");
    expect(revealGrantedCredential(saved.id, "bot-b")).toBeNull();
    setCredentialGrants(saved.id, ["bot-b"]);
    expect(revealGrantedCredential(saved.id, "bot-a")).toBeNull();
    expect(revealGrantedCredential(saved.id, "bot-b")?.secret).toBe("very-secret");
  });
});
