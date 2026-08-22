import { describe, expect, it } from "vitest";
import { routingDirective, suggestSpecialistRoutes, type RoutingPeer } from "./routing.ts";

const peers: RoutingPeer[] = [
  {
    id: "spark",
    name: "Spark",
    title: "Ideas & creative work",
    description: "Drafts and researches clear positioning.",
    enabledSkillSlugs: ["idea-shaping", "source-briefing"],
  },
  {
    id: "research",
    name: "Research",
    title: "Research & briefings",
    description: "Find sources and write sourced briefings.",
    enabledSkillSlugs: ["source-research", "source-briefing"],
  },
  {
    id: "builder",
    name: "Builder",
    title: "Projects & builds",
    description: "Turn projects into concrete files.",
    enabledSkillSlugs: ["project-build-plan"],
  },
];

describe("Chief of Staff routing hints", () => {
  it("routes a research plus writing request to both configured specialists", () => {
    const routes = suggestSpecialistRoutes("Research current sources, then draft the landing-page outline.", peers);
    expect(routes.map((route) => route.peer.name)).toEqual(["Spark", "Research"]);
  });

  it("does not route a greeting", () => {
    expect(suggestSpecialistRoutes("hey, what's up?", peers)).toEqual([]);
  });

  it("honors a custom Spark role that owns writing and research", () => {
    const customSpark = { ...peers[0], title: "Writing & research" };
    const routes = suggestSpecialistRoutes("Research current sources for this launch.", [customSpark, peers[1]]);
    expect(routes.map((route) => route.peer.name)).toEqual(["Spark"]);
  });

  it("names the assignment and requires a handoff", () => {
    const routes = suggestSpecialistRoutes("Build the project files and tests.", peers);
    const directive = routingDirective(routes);
    expect(directive).toMatch(/@Builder/);
    expect(directive).toMatch(/ask_bot/);
    expect(directive).toMatch(/before doing specialist work yourself/i);
  });
});

describe("renamed specialists", () => {
  const renamed = { ...peers[2], name: "Engineer", title: "Engineering & builds" };

  it("still routes engineering work to a renamed Builder by its capability", () => {
    const routes = suggestSpecialistRoutes("Build the project files and tests.", [renamed, peers[0], peers[1]]);
    expect(routes.map((route) => route.peer.name)).toEqual(["Engineer"]);
  });

  it("never leaks the old seed role name into the directive", () => {
    const routes = suggestSpecialistRoutes("Build the project files and tests.", [renamed]);
    const directive = routingDirective(routes);
    expect(directive).toMatch(/@Engineer/);
    expect(directive).not.toMatch(/Builder/);
  });
});
