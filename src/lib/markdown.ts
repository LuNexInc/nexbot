export interface MarkdownTable {
  prefix?: string;
  headers: string[];
  rows: string[][];
  nextIndex: number;
}

/** Parse a pipe-delimited Markdown row. We require a leading or trailing pipe
 * so ordinary prose that happens to contain a pipe stays ordinary prose. */
export function splitPipeRow(line: string): string[] | null {
  const value = line.trim();
  if (!value.includes("|")) return null;
  const leading = value.startsWith("|");
  const trailing = value.endsWith("|");
  if (!leading && !trailing) return null;
  const body = value.slice(leading ? 1 : 0, value.length - (trailing ? 1 : 0));
  const cells = body.split("|").map((cell) => cell.trim());
  return cells.length >= 2 ? cells : null;
}

export function isTableDivider(cells: string[]): boolean {
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

/** Parse one complete Markdown table starting at `start`, if present. */
export function parseMarkdownTable(lines: string[], start: number): MarkdownTable | null {
  const divider = splitPipeRow(lines[start + 1] ?? "");
  if (!divider || !isTableDivider(divider)) return null;

  let headers = splitPipeRow(lines[start] ?? "");
  let prefix: string | undefined;
  if (!headers || headers.length !== divider.length) {
    // Some providers collapse a paragraph and the following table header onto
    // one line. Recover the trailing pipe row when its column count matches
    // the divider on the next line.
    const line = lines[start] ?? "";
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] !== "|") continue;
      const candidate = splitPipeRow(line.slice(index));
      if (candidate && candidate.length === divider.length) {
        headers = candidate;
        prefix = line.slice(0, index).trimEnd();
        break;
      }
    }
  }
  if (!headers || divider.length !== headers.length) return null;

  const rows: string[][] = [];
  let nextIndex = start + 2;
  while (nextIndex < lines.length) {
    const row = splitPipeRow(lines[nextIndex]);
    if (!row || isTableDivider(row)) break;
    rows.push(row);
    nextIndex += 1;
  }
  return { prefix, headers, rows, nextIndex };
}
