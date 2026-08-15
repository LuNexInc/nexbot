import { describe, expect, it } from "vitest";
import { isTableDivider, parseMarkdownTable, splitPipeRow } from "./markdown";

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
