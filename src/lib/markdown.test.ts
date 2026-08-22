import { describe, expect, it } from "vitest";
import { isTableDivider, normalizeMarkdown, parseMarkdownTable, splitPipeRow } from "./markdown";

describe("Markdown normalization", () => {
  it("breaks collapsed labelled bullets into separate lines", () => {
    expect(normalizeMarkdown("- **Answer:** first - **Status:** done - **Owner:** Charles")).toBe(
      "- **Answer:** first\n- **Status:** done\n- **Owner:** Charles",
    );
  });

  it("preserves ordinary hyphenated prose and normalizes line endings", () => {
    expect(normalizeMarkdown("A well-known fact -5 is still prose.\r\nNext line.")).toBe("A well-known fact -5 is still prose.\nNext line.");
  });
});

describe("Markdown table parsing", () => {
  it("parses a pipe row and divider", () => {
    expect(splitPipeRow("| Order | Idea | Next move |")).toEqual(["Order", "Idea", "Next move"]);
    expect(isTableDivider(["---", ":---:", "---:"])).toBe(true);
  });

  it("does not treat prose with a pipe as a table row", () => {
    expect(splitPipeRow("A | B")).toBeNull();
    expect(parseMarkdownTable(["A | B", "--- | ---"], 0)).toBeNull();
  });

  it("returns the table rows and the first line after the table", () => {
    const parsed = parseMarkdownTable(
      [
        "| Order | Idea | Next move |",
        "|---|---|---|",
        "| 1 | Pickleball | RSVP |",
        "| 2 | Guest note | Post it |",
        "",
        "More context.",
      ],
      0,
    );
    expect(parsed).toEqual({
      prefix: undefined,
      headers: ["Order", "Idea", "Next move"],
      rows: [
        ["1", "Pickleball", "RSVP"],
        ["2", "Guest note", "Post it"],
      ],
      nextIndex: 4,
    });
  });

  it("recovers a table header appended to the prior sentence", () => {
    const parsed = parseMarkdownTable(
      [
        "Nothing was sent. | Order | Idea | Next move |",
        "|---|---|---|",
        "| 1 | Guest note | Post it |",
      ],
      0,
    );
    expect(parsed?.prefix).toBe("Nothing was sent.");
    expect(parsed?.headers).toEqual(["Order", "Idea", "Next move"]);
  });
});
