import { describe, expect, it } from "vitest";
import type { AcpConfig } from "./core.ts";
import type { SendTurnInput } from "../../contracts.ts";
import { acpBuildPromptText, acpPickAuthMethod, acpSpawnArgs } from "./generic.ts";

const turn = (overrides: Partial<SendTurnInput> = {}): SendTurnInput => ({
  threadId: "t1",
  text: "do the thing",
  ...overrides,
});

const cfg = (overrides: Partial<AcpConfig> = {}): AcpConfig => ({ cli: "acp-agent", fullAuto: false, ...overrides });

describe("acp generic driver config", () => {
  it("spawnArgs replaces {model} from the turn/effective model", () => {
    const config = cfg({ args: ["--model", "{model}", "{extra}"] });
    expect(acpSpawnArgs(config, turn({ model: "grok-4.5" }))).toEqual(["--model", "grok-4.5", "{extra}"]);
    expect(acpSpawnArgs(cfg({ ...config, model: "grok-4.5" }), turn())).toEqual(["--model", "grok-4.5", "{extra}"]);
    expect(acpSpawnArgs(config, turn({ model: "default" }))).toEqual(["{extra}"]);
  });

  it("drops a split --model/{model} pair with no model", () => {
    expect(acpSpawnArgs(cfg({ args: ["--model", "{model}", "--verbose"] }), turn())).toEqual(["--verbose"]);
    expect(acpSpawnArgs(cfg({ args: ["-m", "{model}"] }), turn())).toEqual([]);
  });

  it("spawnArgs drops {model}-referencing args when no model is set", () => {
    expect(acpSpawnArgs(cfg({ args: ["--model={model}", "--verbose"] }), turn())).toEqual(["--verbose"]);
  });

  it("pickAuthMethod prefers config.authMethod, then the first available", () => {
    const methods = [{ id: "a" }, { id: "b" }];
    expect(acpPickAuthMethod(methods, cfg({ authMethod: "b" }))).toBe("b");
    expect(acpPickAuthMethod(methods, cfg())).toBe("a");
    expect(acpPickAuthMethod([], cfg())).toBeNull();
  });

  it("buildPromptText prepends the persona when present", () => {
    expect(acpBuildPromptText(turn({ system: "You are R" }))).toBe("You are R\n\ndo the thing");
    expect(acpBuildPromptText(turn())).toBe("do the thing");
  });
});
