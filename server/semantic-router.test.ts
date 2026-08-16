import { describe, expect, it } from "vitest";

import { chooseSemanticRoute, semanticRouteTextVariants, type SemanticRoutePeer } from "./semantic-router.ts";

const spark: SemanticRoutePeer = {
  id: "spark",
  name: "Spark",
  title: "Ideas & creative work",
  description: "Shape rough ideas into clear concepts, drafts, and creative direction.",
};

const research: SemanticRoutePeer = {
  id: "research",
  name: "Research",
  title: "Research & briefings",
  description: "Find useful sources and turn them into concise, sourced briefings.",
};

describe("semantic router input focus", () => {
  it("tries the opening task before trailing constraints", () => {
    const text =
      "Brainstorm three bold visual directions for NexBot. This is a short routing smoke test; do not change files or send anything externally.";

    expect(semanticRouteTextVariants(text)).toEqual([
      "Brainstorm three bold visual directions for NexBot.",
      text,
    ]);
  });
});

describe("semantic router decision gate", () => {
  it("selects the highest-confidence teammate", () => {
    const result = chooseSemanticRoute([
      { peer: spark, score: 0.82 },
      { peer: research, score: 0.57 },
    ]);

    expect(result?.peer.id).toBe("spark");
    expect(result?.confidence).toBe(0.82);
    expect(result?.margin).toBeCloseTo(0.25);
  });

  it("leaves close or weak matches with CoS", () => {
    expect(
      chooseSemanticRoute([
        { peer: spark, score: 0.61 },
        { peer: research, score: 0.59 },
      ]),
    ).toBeNull();
    expect(chooseSemanticRoute([{ peer: spark, score: 0.21 }])).toBeNull();
  });
});
