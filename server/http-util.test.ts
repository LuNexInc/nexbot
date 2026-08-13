import { describe, expect, it } from "vitest";
import { portBusyHint } from "./http-util.ts";

describe("portBusyHint", () => {
  it("tells the operator to quit the installed tray app", () => {
    const msg = portBusyHint(8799);
    expect(msg).toContain("EADDRINUSE");
    expect(msg).toContain("8799");
    expect(msg).toContain("tray");
    expect(msg).toMatch(/Quit/);
    expect(msg).toContain("5199");
    expect(msg).toContain("UI only");
  });
});
