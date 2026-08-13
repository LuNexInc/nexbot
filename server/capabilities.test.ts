import { describe, expect, it } from "vitest";

import { detectCapabilities } from "./capabilities.ts";

describe("capabilities", () => {
  it("does not claim local CUA from platform alone", () => {
    const cap = detectCapabilities({ electron: true, cuaReady: false });
    expect(cap.localComputer.available).toBe(false);
    expect(cap.localComputer.reasonCode).toBe("cua-driver-missing");
    expect(cap.screenPreview.available).toBe(true);
  });

  it("browser mode fails closed", () => {
    const cap = detectCapabilities({ electron: false, cuaReady: false });
    expect(cap.screenPreview.available).toBe(false);
    expect(cap.dictation.available).toBe(false);
    expect(cap.localComputer.available).toBe(false);
    expect(cap.localComputer.reasonCode).toBe("needs-desktop-app");
  });

  it("reports CUA when the connection file is ready", () => {
    const cap = detectCapabilities({ electron: true, cuaReady: true });
    expect(cap.localComputer).toMatchObject({ available: true, support: "supported" });
  });
});
