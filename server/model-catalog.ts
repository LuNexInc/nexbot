import type { ModelCatalog } from "./contracts.ts";
import { execFileCli } from "./cli-spawn.ts";

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,100}$/;

function labelFor(id: string): string {
  return id
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parsedOption(id: string, label?: string): { id: string; label: string } | null {
  const cleanId = id.trim();
  if (!MODEL_ID.test(cleanId)) return null;
  return { id: cleanId, label: label?.trim() || labelFor(cleanId) };
}

/** Parse the small human-readable catalogs exposed by local provider CLIs.
 * Warnings and headings are ignored. The fallback is returned unchanged when
 * a CLI emits no recognizable model ids. */
export function parseCliModelCatalog(output: string, fallback: ModelCatalog): ModelCatalog {
  const options: Array<{ id: string; label: string }> = [];
  let markedDefault: string | undefined;

  for (const rawLine of output.replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let id: string | undefined;
    let label: string | undefined;
    let isDefault = false;

    // agy: model-id<TAB>Display label
    const tab = line.match(/^([A-Za-z0-9][A-Za-z0-9._/-]{1,100})\s+(.+)$/);
    if (tab && /\t|\s{2,}/.test(line)) {
      id = tab[1];
      label = tab[2].replace(/\s+\(default\)\s*$/i, "").trim();
      isDefault = /\(default\)/i.test(tab[2]);
    }

    // grok: * grok-4.6 (default) or - grok-4.5
    if (!id) {
      const bullet = line.match(/^[-*•]\s+([^\s]+)(?:\s+\((default)\))?(?:\s+[-–—:]\s*(.*))?$/i);
      if (bullet) {
        id = bullet[1];
        isDefault = Boolean(bullet[2]);
        label = bullet[3] || undefined;
      }
    }

    // Also accept a bare id, which is useful for future CLIs that print one
    // model per line without labels.
    if (!id) {
      const bare = line.match(/^([A-Za-z][A-Za-z0-9._/-]{1,100})(?:\s+\((default)\))?$/i);
      if (bare && /[0-9._/-]/.test(bare[1])) {
        id = bare[1];
        isDefault = Boolean(bare[2]);
      }
    }

    const option = id ? parsedOption(id, label) : null;
    if (!option || options.some((item) => item.id === option.id)) continue;
    options.push(option);
    if (isDefault) markedDefault = option.id;
  }

  if (!options.length) return fallback;
  const fallbackDefault = options.some((item) => item.id === fallback.default) ? fallback.default : options[0].id;
  return { default: markedDefault ?? fallbackDefault, options };
}

/** Read a CLI's model list without allowing discovery failure to make the
 * provider unavailable. The process is hidden on Windows by execFileCli. */
export function discoverCliModels(
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
  fallback: ModelCatalog,
): Promise<ModelCatalog> {
  return new Promise((resolve) => {
    execFileCli(command, args, { timeout: 8_000, maxBuffer: 512 * 1024, env }, (error, stdout) => {
      if (error) return resolve(fallback);
      resolve(parseCliModelCatalog(stdout, fallback));
    });
  });
}
