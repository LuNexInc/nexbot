// Host-side WireGuard peer provisioning for NexBot Connect.
// The desktop app never returns the host private key. The Android device
// creates its own private key and sends only its public key to this module.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";

export const WIREGUARD_DIR = join(DATA_DIR, "wireguard");
export const WIREGUARD_SERVICE = "NexBotConnect";
const HOST_ADDRESS = "10.77.0.1/24";
const HOST_IP = "10.77.0.1";
const DEFAULT_LISTEN_PORT = 51820;

export interface WireGuardPeer {
  deviceId: string;
  publicKey: string;
  address: string;
  createdAt: number;
  revokedAt?: number;
}

interface WireGuardState {
  version: 1;
  privateKey: string;
  publicKey: string;
  endpoint: string;
  listenPort: number;
  peers: WireGuardPeer[];
  appliedAt?: number;
}

export interface WireGuardStatus {
  available: boolean;
  configured: boolean;
  active: boolean;
  endpoint: string;
  listenPort: number;
  address: string;
  peerCount: number;
  reason?: string;
}

export interface WireGuardClientConfig {
  deviceId: string;
  address: string;
  serverAddress: string;
  serverPublicKey: string;
  endpoint: string;
  allowedIps: string;
  dns: string;
  persistentKeepalive: number;
}

function statePath(): string {
  return join(WIREGUARD_DIR, "host.json");
}

function configPath(): string {
  return join(WIREGUARD_DIR, `${WIREGUARD_SERVICE}.conf`);
}

function readState(): WireGuardState | null {
  try {
    const value = JSON.parse(readFileSync(statePath(), "utf8")) as Partial<WireGuardState>;
    if (
      value.version === 1 &&
      typeof value.privateKey === "string" &&
      typeof value.publicKey === "string" &&
      typeof value.endpoint === "string" &&
      typeof value.listenPort === "number" &&
      Array.isArray(value.peers)
    ) {
      return { ...value, peers: value.peers.filter(isPeer) } as WireGuardState;
    }
  } catch {
    // First run or a partially written file.
  }
  return null;
}

function isPeer(value: unknown): value is WireGuardPeer {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<WireGuardPeer>;
  return (
    typeof row.deviceId === "string" &&
    typeof row.publicKey === "string" &&
    typeof row.address === "string" &&
    typeof row.createdAt === "number"
  );
}

function writeState(state: WireGuardState): void {
  mkdirSync(WIREGUARD_DIR, { recursive: true });
  writeFileSync(statePath(), JSON.stringify(state, null, 2), { mode: 0o600 });
}

function existingPath(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  return existsSync(value) ? value : null;
}

function firstExisting(paths: Array<string | undefined>): string | null {
  for (const path of paths) {
    const found = existingPath(path);
    if (found) return found;
  }
  return null;
}

function programFiles(): string[] {
  return [process.env.ProgramW6432, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(
    (value): value is string => Boolean(value),
  );
}

function wgPath(): string | null {
  const roots = programFiles();
  return firstExisting([
    process.env.NEXBOT_WIREGUARD_WG,
    ...roots.map((root) => join(root, "WireGuard", "wg.exe")),
  ]);
}

function managerPath(): string | null {
  const roots = programFiles();
  return firstExisting([
    process.env.NEXBOT_WIREGUARD_BIN,
    ...roots.map((root) => join(root, "WireGuard", "wireguard.exe")),
  ]);
}

function runWg(args: string[], input?: string): string {
  const binary = wgPath();
  if (!binary) throw new Error("WireGuard host tools are not installed");
  return execFileSync(binary, args, {
    input,
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  }).trim();
}

function generateKeyPair(): { privateKey: string; publicKey: string } {
  const privateKey = runWg(["genkey"]);
  const publicKey = runWg(["pubkey"], `${privateKey}\n`);
  if (!privateKey || !publicKey) throw new Error("WireGuard did not return a host key pair");
  return { privateKey, publicKey };
}

function validPublicKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9+/]{42}[A-Za-z0-9+/=]{2}$/.test(value.trim());
}

function validEndpoint(value: string): boolean {
  if (!value || value.length > 255 || /[\s/\\]/.test(value)) return false;
  const split = value.lastIndexOf(":");
  if (split < 1 || split === value.length - 1) return false;
  const port = Number(value.slice(split + 1));
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function nextAddress(peers: WireGuardPeer[]): string {
  const used = new Set(peers.map((peer) => peer.address));
  for (let last = 2; last <= 254; last += 1) {
    const address = `10.77.0.${last}/32`;
    if (!used.has(address)) return address;
  }
  throw new Error("NexBot Connect has reached its peer limit");
}

function renderConfig(state: WireGuardState): string {
  const peers = state.peers.filter((peer) => !peer.revokedAt);
  const sections = [
    `[Interface]\nPrivateKey = ${state.privateKey}\nAddress = ${HOST_ADDRESS}\nListenPort = ${state.listenPort}`,
    ...peers.map((peer) => `[Peer]\n# device ${peer.deviceId.replace(/[^\w.-]/g, "_")}\nPublicKey = ${peer.publicKey}\nAllowedIPs = ${peer.address}`),
  ];
  return `${sections.join("\n\n")}\n`;
}

function serviceIsActive(): boolean {
  try {
    // WireGuard prefixes tunnel service names with `WireGuardTunnel$` on
    // Windows. The manager commands still take the short tunnel name.
    const output = execFileSync("sc.exe", ["query", `WireGuardTunnel$${WIREGUARD_SERVICE}`], { encoding: "utf8", timeout: 5000, windowsHide: true });
    return /STATE\s+:\s+\d+\s+RUNNING/i.test(output);
  } catch {
    return false;
  }
}

function applyService(state: WireGuardState): void {
  const manager = managerPath();
  if (!manager) throw new Error("WireGuard for Windows is not installed on the host");
  mkdirSync(WIREGUARD_DIR, { recursive: true });
  writeFileSync(configPath(), renderConfig(state), { mode: 0o600 });
  try {
    execFileSync(manager, ["/uninstalltunnelservice", WIREGUARD_SERVICE], { encoding: "utf8", timeout: 20_000, windowsHide: true });
  } catch {
    // First install, or a service that is already absent.
  }
  execFileSync(manager, ["/installtunnelservice", configPath()], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  state.appliedAt = Date.now();
  writeState(state);
}

export function wireGuardStatus(): WireGuardStatus {
  const wg = wgPath();
  const manager = managerPath();
  const state = readState();
  const available = Boolean(wg && manager);
  return {
    available,
    configured: Boolean(state),
    active: Boolean(state && serviceIsActive()),
    endpoint: state?.endpoint ?? "",
    listenPort: state?.listenPort ?? DEFAULT_LISTEN_PORT,
    address: HOST_ADDRESS,
    peerCount: state?.peers.filter((peer) => !peer.revokedAt).length ?? 0,
    ...(available ? {} : { reason: "Install WireGuard for Windows or set NEXBOT_WIREGUARD_BIN and NEXBOT_WIREGUARD_WG." }),
  };
}

export function setupWireGuard(options: { endpoint: string; listenPort?: number }): WireGuardStatus {
  const endpoint = options.endpoint.trim();
  const listenPort = options.listenPort ?? DEFAULT_LISTEN_PORT;
  if (!validEndpoint(endpoint)) throw new Error("WireGuard endpoint must be a host and UDP port, for example vpn.example.com:51820");
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) throw new Error("WireGuard listen port is invalid");
  const previous = readState();
  const keys = previous ?? { ...generateKeyPair(), version: 1 as const, peers: [] as WireGuardPeer[] };
  const state: WireGuardState = { ...keys, endpoint, listenPort, peers: previous?.peers ?? [] };
  applyService(state);
  return wireGuardStatus();
}

export function provisionWireGuardPeer(deviceId: string, publicKey: string): WireGuardClientConfig {
  const state = readState();
  if (!state) throw new Error("Set up the NexBot WireGuard host before pairing a VPN device");
  if (!/^[\w.-]{1,64}$/.test(deviceId)) throw new Error("The device id is invalid");
  if (!validPublicKey(publicKey)) throw new Error("The Android WireGuard public key is invalid");
  const existing = state.peers.find((peer) => peer.deviceId === deviceId && !peer.revokedAt);
  if (existing && existing.publicKey !== publicKey) throw new Error("This device already has a different active VPN key; revoke it first");
  const peer = existing ?? {
    deviceId,
    publicKey: publicKey.trim(),
    address: nextAddress(state.peers),
    createdAt: Date.now(),
  };
  if (!existing) state.peers.push(peer);
  applyService(state);
  return {
    deviceId,
    address: peer.address,
    serverAddress: `${HOST_IP}/32`,
    serverPublicKey: state.publicKey,
    endpoint: state.endpoint,
    allowedIps: `${HOST_IP}/32`,
    // This tunnel is for NexBot host access, not a full internet tunnel. Do not
    // advertise the host as a DNS server because NexBot does not run one.
    dns: "",
    persistentKeepalive: 25,
  };
}

export function revokeWireGuardPeer(deviceId: string): boolean {
  const state = readState();
  if (!state) return false;
  const peer = state.peers.find((row) => row.deviceId === deviceId && !row.revokedAt);
  if (!peer) return false;
  peer.revokedAt = Date.now();
  applyService(state);
  return true;
}

export function isWireGuardPublicKey(value: unknown): value is string {
  return validPublicKey(value);
}

export function isWireGuardEndpoint(value: string): boolean {
  return validEndpoint(value);
}

export function wireGuardConfigTextForTest(state: Parameters<typeof renderConfig>[0]): string {
  return renderConfig(state);
}
