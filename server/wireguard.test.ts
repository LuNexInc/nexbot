import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const saved = process.env.NEXBOT_DATA_DIR;
const VALID_KEY = "A".repeat(43) + "=";

beforeAll(() => {
  process.env.NEXBOT_DATA_DIR = mkdtempSync(join(tmpdir(), "nexbot-wg-"));
  const wg = join(process.env.NEXBOT_DATA_DIR, "wireguard");
  mkdirSync(wg, { recursive: true });
  writeFileSync(
    join(wg, "host.json"),
    JSON.stringify({
      version: 1,
      privateKey: "priv",
      publicKey: "pub",
      endpoint: "vpn.example.com:51820",
      listenPort: 51820,
      peers: [],
    }),
  );
});

afterAll(() => {
  if (saved === undefined) delete process.env.NEXBOT_DATA_DIR;
  else process.env.NEXBOT_DATA_DIR = saved;
  vi.resetModules();
  if (process.env.NEXBOT_DATA_DIR) rmSync(process.env.NEXBOT_DATA_DIR, { recursive: true, force: true });
});

async function wireguard() {
  vi.resetModules();
  return import("./wireguard.ts");
}

describe("NexBot Connect WireGuard", () => {
  it("accepts a valid WireGuard public key and rejects malformed ones", async () => {
    const { isWireGuardPublicKey } = await wireguard();
    expect(isWireGuardPublicKey(VALID_KEY)).toBe(true);
    expect(isWireGuardPublicKey("short")).toBe(false);
    expect(isWireGuardPublicKey("contains\nnewline")).toBe(false);
    expect(isWireGuardPublicKey("not base64!@#")).toBe(false);
  });

  it("validates endpoints (host:port) with bounds and no whitespace/slash", async () => {
    const { isWireGuardEndpoint } = await wireguard();
    expect(isWireGuardEndpoint("vpn.example.com:51820")).toBe(true);
    expect(isWireGuardEndpoint("10.77.0.1:51820")).toBe(true);
    expect(isWireGuardEndpoint("")).toBe(false);
    expect(isWireGuardEndpoint("host")).toBe(false);
    expect(isWireGuardEndpoint("host:0")).toBe(false);
    expect(isWireGuardEndpoint("host:99999")).toBe(false);
    expect(isWireGuardEndpoint("ho st:51820")).toBe(false);
    expect(isWireGuardEndpoint("host/extra:51820")).toBe(false);
  });

  it("renders an interface plus only non-revoked peers", async () => {
    const { wireGuardConfigTextForTest } = await wireguard();
    const cfg = wireGuardConfigTextForTest({
      version: 1,
      privateKey: "priv",
      publicKey: "pub",
      endpoint: "e:1",
      listenPort: 51820,
      peers: [
        { deviceId: "dev", publicKey: "pk", address: "10.77.0.2/32", createdAt: 1 },
        { deviceId: "gone", publicKey: "pk2", address: "10.77.0.3/32", createdAt: 2, revokedAt: 3 },
      ],
    });
    expect(cfg).toContain("[Interface]\nPrivateKey = priv");
    expect(cfg).toContain("[Peer]\n# device dev");
    expect(cfg).not.toContain("# device gone");
  });

  it("does not inject config lines from a hostile deviceId (defense in depth)", async () => {
    const { wireGuardConfigTextForTest } = await wireguard();
    const cfg = wireGuardConfigTextForTest({
      version: 1,
      privateKey: "priv",
      publicKey: "pub",
      endpoint: "e:1",
      listenPort: 51820,
      peers: [{ deviceId: "a\n[Peer]\nPublicKey = injected", publicKey: "pk", address: "10.77.0.2/32", createdAt: 1 }],
    });
    const publicKeyLines = cfg.split("\n").filter((line) => line.startsWith("PublicKey = "));
    expect(publicKeyLines).toEqual(["PublicKey = pk"]);
    expect(cfg.split("\n").filter((line) => line.startsWith("[Peer]"))).toEqual(["[Peer]"]);
  });

  it("rejects a device id that is not a safe identifier", async () => {
    const { provisionWireGuardPeer } = await wireguard();
    expect(() => provisionWireGuardPeer("bad\nid", VALID_KEY)).toThrow(/device id is invalid/);
    expect(() => provisionWireGuardPeer("bad id", VALID_KEY)).toThrow(/device id is invalid/);
  });

  it("rejects a non-WireGuard public key before provisioning", async () => {
    const { provisionWireGuardPeer } = await wireguard();
    expect(() => provisionWireGuardPeer("dev", "notakey")).toThrow(/public key is invalid/);
  });
});
