/** Chat activity pills that are harness guts — hide these; the reply is the story. */

const GUTS_TOOLS = new Set([
  "list_dir",
  "read_file",
  "write_file",
  "delete_file",
  "grep",
  "search_tool",
  "use_tool",
  "search_replace",
  "glob",
  "glob_file_search",
  "str_replace",
  "edit_file",
  "codebase_search",
  "file_search",
  "read",
  "ls",
  "find",
  "cat",
  "bash",
  "shell",
  "tool",
]);

const GUTS_PREFIX =
  /^(list_|read_|write_|edit_|delete_|search_|glob|grep|use_tool|str_replace|apply_patch|codebase_|file_search)/i;

function toolKey(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export type ActivityLike = {
  kind?: string;
  tool?: { name?: string; ok?: boolean };
};

/** True when this activity is internal tool guts and must not render as a pill. */
export function isGutsActivity(message: ActivityLike): boolean {
  if (message.kind !== "activity") return false;
  const name = message.tool?.name?.trim() ?? "";
  if (!name) return true;
  if (/^error:/i.test(name)) return false;
  // ask_bot dispatcher pills — fromBot text bubbles are the story
  if (/^asked\s+@/i.test(name)) return true;
  if (/^@\S+\s*(→|->)\s*@/.test(name)) return true;
  const key = toolKey(name);
  if (GUTS_TOOLS.has(key)) return true;
  if (GUTS_PREFIX.test(key)) return true;
  return false;
}
