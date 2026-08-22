import { describe, expect, it } from "vitest";

import {
  isWireGuardEndpoint,
  isWireGuardPublicKey,
  wireGuardConfigTextForTest,
} from "./wireguard.ts";

describe("WireGuard host provisioning", () => {
  it("validates endpoints and public keys without accepting shell syntax", () => {
    expect(isWireGuardEndpoint("vpn.example.com:51820")).toBe(true);
    expect(isWireGuardEndpoint("192.168.1.8:51820")).toBe(true);
    expect(isWireGuardEndpoint("https://vpn.example.com:51820")).toBe(false);
    expect(isWireGuardEndpoint("vpn.example.com:bad")).toBe(false);
    expect(isWireGuardEndpoint("vpn.example.com:51820 && whoami")).toBe(false);
    expect(isWireGuardPublicKey("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=")).toBe(true);
    expect(isWireGuardPublicKey("not-a-wireguard-key")).toBe(false);
  });

  it("renders only active peers into the host tunnel configuration", () => {
    const config = wireGuardConfigTextForTest({
      version: 1,
      privateKey: "host-private",
      publicKey: "host-public",
      endpoint: "vpn.example.com:51820",
      listenPort: 51820,
      peers: [
        { deviceId: "phone", publicKey: "phone-public", address: "10.77.0.2/32", createdAt: 1 },
        { deviceId: "revoked", publicKey: "revoked-public", address: "10.77.0.3/32", createdAt: 1, revokedAt: 2 },
      ],
    });
    expect(config).toContain("PrivateKey = host-private");
    expect(config).toContain("PublicKey = phone-public");
    expect(config).not.toContain("revoked-public");
  });
});
