import { describe, expect, it, beforeEach } from "vitest";
import type { IncomingMessage } from "node:http";
import { mkdirSync } from "node:fs";

import { DATA_DIR } from "./config.ts";
import {
  authorizeHarnessRequest,
  bindIsOffLoopback,
  checkHarnessToken,
  isLoopbackAddress,
  isPublicHarnessPath,
  isSteerLanPath,
  loadHarnessToken,
  rotateHarnessToken,
} from "./harness-auth.ts";

function fakeReq(addr: string): IncomingMessage {
  return { socket: { remoteAddress: addr } } as IncomingMessage;
}

describe("harness-auth helpers", () => {
  beforeEach(() => {
    mkdirSync(DATA_DIR, { recursive: true });
    delete process.env.NEXBOT_TEST_REMOTE;
  });

  it("recognizes loopback forms", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.20")).toBe(false);
    expect(isLoopbackAddress("0.0.0.0")).toBe(false);
    expect(bindIsOffLoopback("0.0.0.0")).toBe(true);
    expect(bindIsOffLoopback("127.0.0.1")).toBe(false);
  });

  it("checks the harness token in constant time", () => {
    const a = loadHarnessToken();
    expect(a.length).toBeGreaterThan(20);
    expect(checkHarnessToken(a)).toBe(true);
    expect(checkHarnessToken("nope")).toBe(false);
    const b = rotateHarnessToken();
    expect(b).not.toBe(a);
    expect(checkHarnessToken(a)).toBe(false);
    expect(checkHarnessToken(b)).toBe(true);
  });

  it("classifies public vs steer-lan paths", () => {
    expect(isPublicHarnessPath("GET", "/api/health")).toBe(true);
    expect(isPublicHarnessPath("POST", "/api/webhooks/github")).toBe(true);
    expect(isPublicHarnessPath("GET", "/m.html")).toBe(true);
    expect(isPublicHarnessPath("GET", "/api/bots")).toBe(false);
    expect(isSteerLanPath("POST", "/api/steer/jobs")).toBe(true);
    expect(isSteerLanPath("GET", "/api/steer/bots")).toBe(true);
    expect(isSteerLanPath("GET", "/api/steer")).toBe(false);
    expect(isSteerLanPath("POST", "/api/steer/rotate")).toBe(false);
  });

  it("trusts loopback and rejects a remote caller without a token", () => {
    const loop = authorizeHarnessRequest(fakeReq("127.0.0.1"), "GET", "/api/bots", undefined, false);
    expect(loop).toEqual({ ok: true });
    const remote = authorizeHarnessRequest(fakeReq("10.0.0.8"), "GET", "/api/bots", undefined, false);
    expect(remote.ok).toBe(false);
  });

  it("lets a remote caller through with the harness token or a steer-lan path", () => {
    const token = loadHarnessToken();
    const ok = authorizeHarnessRequest(fakeReq("10.0.0.8"), "GET", "/api/bots", token, false);
    expect(ok).toEqual({ ok: true });
    const steer = authorizeHarnessRequest(fakeReq("10.0.0.8"), "GET", "/api/steer/bots", "ignored", true);
    expect(steer).toEqual({ ok: true });
    const leak = authorizeHarnessRequest(fakeReq("10.0.0.8"), "GET", "/api/steer", undefined, false);
    expect(leak.ok).toBe(false);
  });
});
