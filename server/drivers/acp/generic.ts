// Configurable ACP harness. This keeps protocol handling in core.ts and lets
// users add another local ACP CLI without adding a driver source file.
import { createAcpDriver, type AcpConfig, type AcpSupport } from "./core.ts";
import type { SendTurnInput } from "../../contracts.ts";

/** Build CLI argv (after the binary name) for the custom ACP CLI. A `{model}`
 * token is replaced with the effective model; when no model is set, any arg
 * that references `{model}` is dropped (and a split `--model`/`-m` switch with
 * it) so no dangling flag or empty `--model=` reaches the CLI. */
export function acpSpawnArgs(config: AcpConfig, turn: SendTurnInput): string[] {
  const model = turn.model && turn.model !== "default" ? turn.model : config.model ?? "";
  const template = config.args?.length ? config.args : [];
  const out: string[] = [];
  for (let i = 0; i < template.length; i++) {
    const arg = template[i];
    if (!model && /^--model$|^-m$/i.test(arg) && template[i + 1]?.includes("{model}")) {
      i++;
      continue;
    }
    if (arg.includes("{model}") && !model) continue;
    out.push(arg.replaceAll("{model}", model));
  }
  return out;
}

/** Pick the ACP authenticate methodId from initialize's advertised list. */
export function acpPickAuthMethod(methods: Array<{ id?: string }>, config: AcpConfig): string | null {
  const ids = methods.map((method) => method.id).filter((id): id is string => typeof id === "string");
  if (config.authMethod && ids.includes(config.authMethod)) return config.authMethod;
  return ids[0] ?? null;
}

/** Compose the session/prompt text, prepending the persona system prompt. */
export function acpBuildPromptText(turn: SendTurnInput): string {
  return turn.system ? `${turn.system}\n\n${turn.text}` : turn.text;
}

const support: AcpSupport = {
  driverKind: "acp",
  displayName: "Custom ACP",
  models: { default: "default", options: [{ id: "default", label: "Default model" }] },
  defaultCli: "acp-agent",
  nativeSource: "custom.acp",
  loginNote: "The custom ACP CLI is unavailable or needs authentication.",
  spawnArgs: acpSpawnArgs,
  pickAuthMethod: acpPickAuthMethod,
  authFailure: "continue",
  isAuthenticated: () => true,
  buildPromptText: acpBuildPromptText,
};

export const GenericAcpDriver = createAcpDriver(support);
