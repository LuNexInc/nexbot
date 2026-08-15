import { readFileSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import {
  authenticateRemoteToken,
  consumePairingCode,
  createPairingCode,
  createRemoteDevice,
  pairingCodeUrls,
  listRemoteDevices,
  pairingMobileUrls,
  pairingUrls,
  REMOTE_ACCESS_FILE,
  remoteAccessStatus,
  revokeRemoteDevice,
  rotateRemoteDevice,
} from "./remote-access.ts";

describe("NexBot Connect device access", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("stores only public device metadata and authenticates the raw token", () => {
    const created = createRemoteDevice("Charles phone");
    expect(created.token).toMatch(/^nx_[0-9a-f]{64}$/);
    expect(created.device).toMatchObject({ label: "Charles phone", active: true });
    expect(JSON.stringify(listRemoteDevices())).not.toContain(created.token);
    expect(authenticateRemoteToken(created.token)?.id).toBe(created.device.id);
    expect(authenticateRemoteToken("nx_wrong")).toBeNull();
    expect(listRemoteDevices()[0].lastUsedAt).toEqual(expect.any(Number));
  });

  it("rotates and revokes one device without changing another device", () => {
    const first = createRemoteDevice("Phone");
    const second = createRemoteDevice("Tablet");
    const rotated = rotateRemoteDevice(first.device.id)!;
    expect(rotated.token).not.toBe(first.token);
    expect(authenticateRemoteToken(first.token)).toBeNull();
    expect(authenticateRemoteToken(rotated.token)?.id).toBe(first.device.id);

    const revoked = revokeRemoteDevice(first.device.id)!;
    expect(revoked.active).toBe(false);
    expect(authenticateRemoteToken(rotated.token)).toBeNull();
    expect(authenticateRemoteToken(second.token)?.id).toBe(second.device.id);
    expect(rotateRemoteDevice(first.device.id)).toBeNull();
  });

  it("creates one-time six-digit codes without storing the raw code", () => {
    const created = createPairingCode("Charles phone");
    expect(created.code).toMatch(/^\d{6}$/);
    expect(created.expiresAt - created.createdAt).toBe(10 * 60 * 1000);
    expect(readFileSync(REMOTE_ACCESS_FILE, "utf8")).not.toContain(created.code);
    expect(consumePairingCode(created.code)).toMatchObject({ label: "Charles phone" });
    expect(consumePairingCode(created.code)).toBeNull();
    expect(pairingCodeUrls(created.code, 5199, ["100.81.167.4", "192.168.100.8"])[0]).toBe(
      `nexbot://pair?url=${encodeURIComponent("http://192.168.100.8:5199")}&code=${created.code}`,
    );
  });

  it("builds QR-compatible app and mobile links without exposing a token in status", () => {
    const created = createRemoteDevice("QR test");
    const appUrl = pairingUrls(created.token, 8799, ["192.168.1.20"])[0];
    const mobileUrl = pairingMobileUrls(created.token, 8799, ["192.168.1.20"])[0];
    expect(appUrl).toBe(`http://192.168.1.20:8799/?token=${created.token}`);
    expect(mobileUrl).toBe(`http://192.168.1.20:8799/m.html?token=${created.token}`);
    const status = remoteAccessStatus({ remoteAccess: { mode: "off" } }, "127.0.0.1", 8799);
    expect(status).toMatchObject({ mode: "off", enabled: false, restartRequired: false, bind: "127.0.0.1" });
    expect(remoteAccessStatus({ remoteAccess: { mode: "off" } }, "0.0.0.0", 8799)).toMatchObject({
      enabled: true,
      restartRequired: true,
    });
    expect(JSON.stringify(status)).not.toContain(created.token);
  });
});
