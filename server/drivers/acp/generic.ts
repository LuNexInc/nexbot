// Configurable ACP harness. This keeps protocol handling in core.ts and lets
// users add another local ACP CLI without adding a driver source file.
import { createAcpDriver, type AcpSupport } from "./core.ts";

const support: AcpSupport = {
  driverKind: "acp",
  displayName: "Custom ACP",
  models: { default: "default", options: [{ id: "default", label: "Default model" }] },
  defaultCli: "acp-agent",
  nativeSource: "custom.acp",
  loginNote: "The custom ACP CLI is unavailable or needs authentication.",
  spawnArgs: (config, turn) => {
    const model = turn.model && turn.model !== "default" ? turn.model : config.model ?? "";
    const template = config.args?.length ? config.args : [];
    return template.flatMap((arg) => {
      if (arg === "{model}" && !model) return [];
      return [arg.replaceAll("{model}", model)];
    });
  },
  pickAuthMethod: (methods, config) => {
    const ids = methods.map((method) => method.id).filter((id): id is string => typeof id === "string");
    if (config.authMethod && ids.includes(config.authMethod)) return config.authMethod;
    return ids[0] ?? null;
  },
  authFailure: "continue",
  isAuthenticated: () => true,
  buildPromptText: (turn) => turn.system ? `${turn.system}\n\n${turn.text}` : turn.text,
};

export const GenericAcpDriver = createAcpDriver(support);
