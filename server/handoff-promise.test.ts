import { describe, expect, it } from "vitest";
import {
  clearHandoffPromisesForTarget,
  handoffPromisesForTarget,
  recordHandoffPromise,
  takeNextHandoffPromiseForTarget,
} from "./handoff-promise.ts";

describe("handoff promise", () => {
  it("ignores a self-promise or missing ids", () => {
    expect(recordHandoffPromise({ fromBotId: "a", fromThreadId: "t", toBotId: "a", request: "x" })).toBeNull();
    expect(recordHandoffPromise({ fromBotId: "", fromThreadId: "t", toBotId: "b", request: "x" })).toBeNull();
  });

  it("records and pops FIFO for a target", () => {
    recordHandoffPromise({ fromBotId: "a", fromThreadId: "ta", toBotId: "b", request: "first" });
    recordHandoffPromise({ fromBotId: "c", fromThreadId: "tc", toBotId: "b", request: "second" });

    expect(handoffPromisesForTarget("b").length).toBe(2);
    const first = takeNextHandoffPromiseForTarget("b");
    expect(first?.request).toBe("first");
    expect(first?.fromBotId).toBe("a");
    expect(takeNextHandoffPromiseForTarget("b")?.request).toBe("second");
    expect(takeNextHandoffPromiseForTarget("b")).toBeNull();
  });

  it("resolves only the target's own promises", () => {
    recordHandoffPromise({ fromBotId: "a", fromThreadId: "ta", toBotId: "b", request: "to-b" });
    recordHandoffPromise({ fromBotId: "a", fromThreadId: "ta", toBotId: "d", request: "to-d" });

    expect(takeNextHandoffPromiseForTarget("b")?.request).toBe("to-b");
    expect(takeNextHandoffPromiseForTarget("b")).toBeNull();
    expect(handoffPromisesForTarget("d").length).toBe(1);
  });

  it("clear removes a target's promises", () => {
    recordHandoffPromise({ fromBotId: "a", fromThreadId: "ta", toBotId: "b", request: "x" });
    clearHandoffPromisesForTarget("b");
    expect(takeNextHandoffPromiseForTarget("b")).toBeNull();
  });
});
