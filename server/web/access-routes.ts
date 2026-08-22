// /api/steer* (phone surface), /api/harness* (token management), and
// /api/remote-access* (NexBot Connect devices, pairing codes, WireGuard).
import { json, readBody } from "../http-util.ts";
import { loadConfig, saveConfig } from "../config.ts";
import {
  authenticateRemoteToken,
  consumePairingCode,
  createPairingCode,
  createRemoteDevice,
  pairingCodeUrls,
  pairingMobileUrls,
  pairingUrls,
  remoteAccessStatus,
  listRemoteDevices,
  revokeRemoteDevice,
  rotateRemoteDevice,
} from "../remote-access.ts";
import { checkSteerToken, loadSteerToken, rotateSteerToken, tokenFromRequest } from "../steer.ts";
import { bindIsOffLoopback, requestIsLoopback, rotateHarnessToken, loadHarnessToken } from "../harness-auth.ts";
import {
  isWireGuardEndpoint,
  isWireGuardPublicKey,
  provisionWireGuardPeer,
  revokeWireGuardPeer,
  setupWireGuard,
  wireGuardStatus,
} from "../wireguard.ts";
import type { RouteArgs } from "./context.ts";
import { harness } from "./context.ts";

// Owned here since only the steer surface reads it.
let steerToken = loadSteerToken();

export async function handleAccessRoutes(args: RouteArgs): Promise<boolean> {
  const { req, res, method, path, url, remoteDevice } = args;
  if (
    !path.startsWith("/api/steer") &&
    !path.startsWith("/api/harness") &&
    !path.startsWith("/api/remote-access")
  ) {
    return false;
  }
  const { store, cfg, startTurn } = harness;

  if (method === "GET" && path === "/api/steer") {
    return json(res, 200, {
      token: steerToken,
      path: `/m.html#token=${steerToken}`,
      bind: harness.BIND,
      port: harness.PORT,
    });
  }
  if (method === "POST" && path === "/api/steer/rotate") {
    steerToken = rotateSteerToken();
    return json(res, 200, { token: steerToken, path: `/m.html#token=${steerToken}` });
  }
  if (method === "GET" && path === "/api/steer/bots") {
    const provided = tokenFromRequest(req.headers.authorization, url.searchParams.get("token"));
    if (!checkSteerToken(provided) && !authenticateRemoteToken(provided)) return json(res, 401, { error: "bad steer token" });
    return json(res, 200, {
      bots: store.bots
        .filter((b) => !b.hidden && b.kind !== "group")
        .map((b) => ({ id: b.id, name: b.name, busy: !!b.busy, color: b.color })),
    });
  }
  if (method === "GET" && path === "/api/harness") {
    return json(res, 200, {
      token: loadHarnessToken(),
      bind: harness.BIND,
      offLoopback: bindIsOffLoopback(harness.BIND),
      port: harness.PORT,
    });
  }
  // ── NexBot Connect (host setup; device tokens authorize remote clients) ──
  if (path === "/api/remote-access" && method === "GET") {
    if (!requestIsLoopback(req)) return json(res, 403, { error: "Connect setup is available on the host app only" });
    return json(res, 200, remoteAccessStatus(cfg, harness.BIND, harness.WEB_PORT));
  }
  if (path === "/api/remote-access" && (method === "PUT" || method === "PATCH")) {
    if (!requestIsLoopback(req)) return json(res, 403, { error: "Connect setup is available on the host app only" });
    const body = await readBody(req);
    const requestedMode = body.mode === "lan" || body.enabled === true ? "lan" : body.mode === "off" || body.enabled === false ? "off" : null;
    if (!requestedMode) return json(res, 400, { error: "mode must be lan or off" });
    saveConfig({ remoteAccess: { mode: requestedMode } });
    Object.assign(cfg, loadConfig());
    return json(res, 200, remoteAccessStatus(cfg, harness.BIND, harness.WEB_PORT));
  }
  if (path === "/api/remote-access/devices" && method === "POST") {
    if (!requestIsLoopback(req)) return json(res, 403, { error: "Connect setup is available on the host app only" });
    const body = await readBody(req);
    const created = createRemoteDevice(body.label);
    const urls = pairingUrls(created.token, harness.WEB_PORT);
    const mobileUrls = pairingMobileUrls(created.token, harness.WEB_PORT);
    return json(res, 201, { device: created.device, token: created.token, pairingUrl: urls[0], pairingUrls: urls, mobileUrl: mobileUrls[0], mobileUrls });
  }
  if (path === "/api/remote-access/codes" && method === "POST") {
    if (!requestIsLoopback(req)) return json(res, 403, { error: "Pairing code setup is available on the host app only" });
    if (!bindIsOffLoopback(harness.BIND)) return json(res, 409, { error: "Restart NexBot after enabling Private LAN mode before creating a code" });
    const body = await readBody(req);
    const requestedDeviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
    if (requestedDeviceId && !listRemoteDevices().some((device) => device.id === requestedDeviceId && device.active)) {
      return json(res, 404, { error: "no active device with that id" });
    }
    const created = createPairingCode(body.label, requestedDeviceId || undefined);
    const urls = pairingCodeUrls(created.code, harness.WEB_PORT);
    return json(res, 201, { code: created.code, label: created.label, deviceId: created.deviceId, createdAt: created.createdAt, expiresAt: created.expiresAt, pairingUrl: urls[0], pairingUrls: urls });
  }
  if (path === "/api/remote-access/pair" && method === "POST") {
    if (!bindIsOffLoopback(harness.BIND)) return json(res, 409, { error: "NexBot Connect is not listening on the LAN" });
    if (!harness.allowPairingAttempt(req)) return json(res, 429, { error: "Too many pairing attempts. Wait one minute." });
    const body = await readBody(req);
    const pairing = consumePairingCode(body.code);
    if (!pairing) return json(res, 401, { error: "The pairing code is invalid or expired" });
    const created = pairing.deviceId ? rotateRemoteDevice(pairing.deviceId) : createRemoteDevice(body.label || pairing.label);
    if (!created) return json(res, 404, { error: "the device is no longer available" });
    return json(res, 201, { device: created.device, token: created.token });
  }
  let m = path.match(/^\/api\/remote-access\/devices\/([\w-]+)\/rotate$/);
  if (m && method === "POST") {
    if (!requestIsLoopback(req)) return json(res, 403, { error: "Connect setup is available on the host app only" });
    const rotated = rotateRemoteDevice(m[1]);
    if (!rotated) return json(res, 404, { error: "no active device with that id" });
    const urls = pairingUrls(rotated.token, harness.WEB_PORT);
    const mobileUrls = pairingMobileUrls(rotated.token, harness.WEB_PORT);
    return json(res, 200, { device: rotated.device, token: rotated.token, pairingUrl: urls[0], pairingUrls: urls, mobileUrl: mobileUrls[0], mobileUrls });
  }
  m = path.match(/^\/api\/remote-access\/devices\/([\w-]+)(?:\/revoke)?$/);
  if (m && (method === "DELETE" || (method === "POST" && path.endsWith("/revoke")))) {
    if (!requestIsLoopback(req)) return json(res, 403, { error: "Connect setup is available on the host app only" });
    const revoked = revokeRemoteDevice(m[1]);
    if (!revoked) return json(res, 404, { error: "no device with that id" });
    try {
      revokeWireGuardPeer(m[1]);
    } catch {
      // The access token is revoked even when an optional host VPN is offline.
    }
    return json(res, 200, { device: revoked });
  }
  if (path === "/api/remote-access/device" && method === "GET") {
    if (!remoteDevice) return json(res, 401, { error: "a NexBot Connect device token is required" });
    return json(res, 200, { device: remoteDevice });
  }
  if (path === "/api/remote-access/wireguard" && method === "GET") {
    if (!requestIsLoopback(req)) return json(res, 403, { error: "WireGuard setup is available on the host app only" });
    return json(res, 200, wireGuardStatus());
  }
  if (path === "/api/remote-access/wireguard" && (method === "POST" || method === "PUT")) {
    if (!requestIsLoopback(req)) return json(res, 403, { error: "WireGuard setup is available on the host app only" });
    const body = await readBody(req);
    const endpoint = String(body.endpoint ?? "").trim();
    const listenPort = body.listenPort === undefined ? undefined : Number(body.listenPort);
    if (!isWireGuardEndpoint(endpoint)) return json(res, 400, { error: "endpoint must be a host and UDP port, for example vpn.example.com:51820" });
    try {
      return json(res, 200, setupWireGuard({ endpoint, listenPort }));
    } catch (error) {
      return json(res, 503, { error: error instanceof Error ? error.message : String(error), code: "WIREGUARD_UNAVAILABLE" });
    }
  }
  m = path.match(/^\/api\/remote-access\/devices\/([\w-]+)\/wireguard$/);
  if (m && method === "POST") {
    if (!requestIsLoopback(req) && (remoteDevice as { id?: string } | null)?.id !== m[1]) return json(res, 403, { error: "A device can provision only its own VPN peer" });
    const body = await readBody(req);
    const publicKey = String(body.publicKey ?? "").trim();
    if (!isWireGuardPublicKey(publicKey)) return json(res, 400, { error: "publicKey must be a WireGuard public key" });
    try {
      return json(res, 200, { vpn: provisionWireGuardPeer(m[1], publicKey) });
    } catch (error) {
      return json(res, 503, { error: error instanceof Error ? error.message : String(error), code: "WIREGUARD_UNAVAILABLE" });
    }
  }
  if (method === "POST" && path === "/api/harness/rotate") {
    return json(res, 200, { token: rotateHarnessToken() });
  }
  if (method === "POST" && path === "/api/steer/jobs") {
    const provided = tokenFromRequest(req.headers.authorization, url.searchParams.get("token"));
    if (!checkSteerToken(provided) && !authenticateRemoteToken(provided)) return json(res, 401, { error: "bad steer token" });
    const body = await readBody(req);
    const text = String(body.text ?? "").trim();
    const botIds = Array.isArray(body.botIds) ? body.botIds.map(String) : [];
    if (!text || !botIds.length) return json(res, 400, { error: "text and botIds required" });
    const started: string[] = [];
    for (const id of botIds) {
      const b = store.bot(id);
      if (!b || b.busy || b.hidden || b.kind === "group") continue;
      await startTurn(id, `[Steer]\n\n${text}`).catch(() => {});
      started.push(id);
    }
    return json(res, 202, { started });
  }
  return false;
}
