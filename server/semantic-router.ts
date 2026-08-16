import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";

export type SemanticRoutePeer = {
  id: string;
  name: string;
  title?: string;
  description?: string;
  enabledSkillSlugs?: string[] | null;
  hidden?: boolean;
  kind?: string;
};

export type SemanticRouteDecision = {
  peer: SemanticRoutePeer;
  confidence: number;
  margin: number;
};

export type SemanticRouteScore = {
  peer: SemanticRoutePeer;
  score: number;
};

type Encoder = (texts: string[]) => Promise<number[][]>;

const ROUTER_MODEL = process.env.NEXBOT_ROUTER_MODEL?.trim() || "Xenova/all-MiniLM-L6-v2";
const ROUTER_CACHE_DIR = join(DATA_DIR, "models", "semantic-router");
const DEFAULT_THRESHOLD = 0.28;
const DEFAULT_MARGIN = 0.045;

let encoderState: Promise<Encoder | null> | undefined;
let prototypeCache: { signature: string; vectors: number[][][] } | undefined;

const ROLE_EXAMPLES: Array<{ matches: RegExp; examples: string[] }> = [
  {
    matches: /builder|project|build|implementation|code|file|engineer|developer/i,
    examples: [
      "Implement a feature, fix a bug, or change the code.",
      "Inspect the repository, edit files, or write tests.",
      "Ship a working build or make the project work end to end.",
      "Fix a bug in the code and run the tests.",
    ],
  },
  {
    matches: /spark|writing|idea|creative|concept|draft/i,
    examples: [
      "Brainstorm ideas and suggest new possibilities.",
      "Write a draft, improve copy, or shape a concept.",
      "Develop a creative direction for a product or project.",
      "Improve an app concept or make a product feel more polished.",
    ],
  },
  {
    matches: /research|source|brief|evidence|analysis|competitor|market/i,
    examples: [
      "Investigate a topic and find reliable sources.",
      "Compare options, gather evidence, or research the market.",
      "Prepare a concise sourced briefing.",
    ],
  },
  {
    matches: /communication|message|outreach|email|follow-up|reply/i,
    examples: [
      "Write an email or reply to someone.",
      "Prepare outreach or follow up with a contact.",
      "Turn a conversation into a clear message.",
    ],
  },
  {
    matches: /operation|process|checklist|routine|handoff|follow-through|workflow/i,
    examples: [
      "Organize a process or maintain a checklist.",
      "Schedule recurring work and coordinate follow-through.",
      "Keep an operation or workflow moving.",
    ],
  },
  {
    matches: /creative|design|direction|visual|brand|logo|art/i,
    examples: [
      "Design a screen or improve a visual system.",
      "Explore branding, shape a logo, or review a layout.",
      "Develop visual or art direction.",
      "Improve the visual design and interaction of an app.",
    ],
  },
];

function peerTexts(peer: SemanticRoutePeer): string[] {
  const metadata = [
    peer.name,
    peer.title,
    peer.description,
    ...(peer.enabledSkillSlugs ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  const specificRole = `${peer.name} ${peer.title ?? ""}`;
  const roleExamples = (
    /^(?:creative|visual)|design\s*(?:&|and)\s*direction/i.test(specificRole)
      ? ROLE_EXAMPLES.find((entry) => entry.matches.source.includes("design"))
      : /^(?:spark)|ideas?\s*(?:&|and)\s*creative/i.test(specificRole)
        ? ROLE_EXAMPLES.find((entry) => entry.matches.source.includes("spark"))
        : ROLE_EXAMPLES.find((entry) => entry.matches.test(metadata))
  )?.examples;
  if (!roleExamples) return [metadata, "Work on the task that best matches this teammate's role and skills."];
  return [`${peer.name} — ${peer.title ?? "specialist"}`, ...roleExamples];
}

function isCoordinator(peer: SemanticRoutePeer): boolean {
  return /chief of staff/i.test(`${peer.name} ${peer.title ?? ""}`) || peer.kind === "group";
}

function isConversational(text: string): boolean {
  return /^(?:hi|hey|hello|what(?:'s| is) up|thanks|thank you|good morning|good night)\b/i.test(text.trim());
}

/**
 * Keep short task constraints from drowning out the user's opening intent.
 * The first sentence is tried first; the full message remains as a fallback
 * for requests whose useful context starts later.
 */
export function semanticRouteTextVariants(text: string): string[] {
  const input = text.trim();
  if (!input) return [];
  const firstSentence = input.match(/^(.{12,400}?[.!?])(?:\s|$)/s)?.[1]?.trim();
  return firstSentence && firstSentence !== input ? [firstSentence, input] : [input];
}

function dot(a: number[], b: number[]): number {
  let value = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) value += a[index] * b[index];
  return value;
}

/** Pick a route only when the best candidate is clear enough to act on. */
export function chooseSemanticRoute(
  scores: SemanticRouteScore[],
  threshold = DEFAULT_THRESHOLD,
  minimumMargin = DEFAULT_MARGIN,
): SemanticRouteDecision | null {
  const ranked = [...scores].sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < threshold) return null;
  const margin = best.score - (ranked[1]?.score ?? 0);
  if (ranked.length > 1 && margin < minimumMargin) return null;
  return {
    peer: best.peer,
    confidence: Math.max(0, Math.min(1, best.score)),
    margin: Math.max(0, margin),
  };
}

function tensorVectors(output: { data: ArrayLike<number>; dims?: readonly number[] }, count: number): number[][] {
  const data = Array.from(output.data, Number);
  const dims = output.dims ?? [];
  const dimension = Number(dims[dims.length - 1] ?? 0);
  if (!dimension || data.length < dimension * count) throw new Error("semantic router returned an invalid embedding tensor");
  return Array.from({ length: count }, (_, index) => data.slice(index * dimension, (index + 1) * dimension));
}

async function loadEncoder(): Promise<Encoder | null> {
  try {
    mkdirSync(ROUTER_CACHE_DIR, { recursive: true });
    const { env, pipeline } = await import("@huggingface/transformers");
    env.cacheDir = ROUTER_CACHE_DIR;
    env.useFSCache = true;
    env.logLevel = 50;
    const extractor = await pipeline("feature-extraction", ROUTER_MODEL, { dtype: "q8" });
    return async (texts: string[]) => {
      const output = await extractor(texts, { pooling: "mean", normalize: true });
      return tensorVectors(output as unknown as { data: ArrayLike<number>; dims?: readonly number[] }, texts.length);
    };
  } catch (error) {
    console.warn(`semantic router unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function getEncoder(): Promise<Encoder | null> {
  if (!encoderState) {
    encoderState = loadEncoder().then((encoder) => {
      // Keep transient model-download or filesystem failures retryable. A
      // later turn can recover without requiring a harness restart.
      if (!encoder) encoderState = undefined;
      return encoder;
    });
  }
  return encoderState;
}

/**
 * Classify a user message against the live, visible teammate roster.
 * The model is loaded lazily and cached under ~/.nexbot so normal startup
 * stays fast and no provider tokens are spent on routing.
 */
export async function semanticRoute(
  text: string,
  peers: SemanticRoutePeer[],
): Promise<SemanticRouteDecision | null> {
  const input = text.trim();
  const candidates = peers.filter((peer) => !peer.hidden && !isCoordinator(peer));
  if (!input || isConversational(input) || candidates.length === 0) return null;

  const encoder = await getEncoder();
  if (!encoder) return null;

  const profileTexts = candidates.flatMap(peerTexts);
  const signature = profileTexts.join("\n---\n");
  let prototypeVectors: number[][][];
  if (prototypeCache?.signature === signature && prototypeCache.vectors.length === candidates.length) {
    prototypeVectors = prototypeCache.vectors;
  } else {
    const encoded = await encoder(profileTexts);
    let offset = 0;
    prototypeVectors = candidates.map((peer) => {
      const count = peerTexts(peer).length;
      const vectors = encoded.slice(offset, offset + count);
      offset += count;
      return vectors;
    });
    prototypeCache = { signature, vectors: prototypeVectors };
  }

  for (const queryText of semanticRouteTextVariants(input)) {
    const [query] = await encoder([queryText]);
    if (!query) continue;
    const queryScores = candidates.map((peer, index) => ({
      peer,
      score: Math.max(...prototypeVectors[index].map((vector) => dot(query, vector))),
    }));
    const decision = chooseSemanticRoute(queryScores);
    if (decision) return decision;
  }
  return null;
}

/** Test hook: clear the lazy model and roster caches without touching disk. */
export function resetSemanticRouterForTests(): void {
  encoderState = undefined;
  prototypeCache = undefined;
}
