import { describe, expect, it } from "vitest";
import { parseCliModelCatalog } from "./model-catalog.ts";

const fallback = {
  default: "fallback-model",
  options: [{ id: "fallback-model", label: "Fallback model" }],
};

describe("CLI model catalogs", () => {
  it("parses grok's default marker and bullet list", () => {
    expect(parseCliModelCatalog("Available models:\n* grok-4.6 (default)\n- grok-4.5\n", fallback)).toEqual({
      default: "grok-4.6",
      options: [
        { id: "grok-4.6", label: "Grok 4.6" },
        { id: "grok-4.5", label: "Grok 4.5" },
      ],
    });
  });

  it("parses tab-separated agy ids and labels", () => {
    expect(parseCliModelCatalog("gemini-3.7-flash-medium\tGemini 3.7 Flash Medium\ngpt-oss-120b-medium\tGPT-OSS 120B Medium", fallback)).toEqual({
      default: "gemini-3.7-flash-medium",
      options: [
        { id: "gemini-3.7-flash-medium", label: "Gemini 3.7 Flash Medium" },
        { id: "gpt-oss-120b-medium", label: "GPT-OSS 120B Medium" },
      ],
    });
  });

  it("keeps the fallback when output is warnings or empty", () => {
    expect(parseCliModelCatalog("warning: not logged in\nAvailable models:", fallback)).toEqual(fallback);
  });
});
