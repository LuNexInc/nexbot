import { describe, expect, it } from "vitest";
import { userFacingError } from "./user-errors.ts";

// The transcript is a customer surface: whatever the provider/driver layers
// throw at us, none of the internal vocabulary may survive the mapping.
const NEVER = [/exited \d/, /codex|grokAgent|claude\.sdk/i, /\{"/, /[A-Za-z]:\\/, /stderr/i, /ENOENT/, /spawn/i];

describe("userFacingError", () => {
  it("maps known failure shapes to calm guidance", () => {
    expect(userFacingError('codex exited 1 before turn/completed: ":{"message":"failed to renew cache TTL')).toBe(
      "The AI engine stopped before finishing. Your request is saved — try again, and check Doctor in App Settings if it keeps happening.",
    );
    expect(userFacingError("grokAgent exited 1 before the prompt result")).toMatch(/AI engine stopped/);
    expect(userFacingError("`codex` CLI not found")).toMatch(/could not start on this PC/);
    expect(userFacingError("No AI provider is ready: nothing available")).toMatch(/signed in/);
    expect(userFacingError("claude.sdk initialize timed out")).toMatch(/took too long/);
    expect(userFacingError("the bot is already working — interrupt it first")).toMatch(/Still working/);
    expect(userFacingError("operator takeover is active")).toMatch(/Manual control/);
  });

  it("strips internals from unknown failures instead of passing them through", () => {
    const out = userFacingError('rpc error: {"code":-32000} at C:\\Users\\Charles\\.nexbot\\x.json (spawn ENOENT)');
    for (const pattern of NEVER) expect(out).not.toMatch(pattern);
  });

  it("falls back to a clean sentence for garbage or empty input", () => {
    expect(userFacingError('{"a":1}')).toMatch(/Something went wrong/);
    expect(userFacingError("")).toMatch(/Something went wrong/);
    expect(userFacingError("x".repeat(500))).toMatch(/Something went wrong|^\S.{6,}\S$/);
  });
});
