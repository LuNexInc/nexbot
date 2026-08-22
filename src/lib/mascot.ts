export const NEX_COLOR_NAMES = [
  "green",
  "blue",
  "red",
  "orange",
  "purple",
  "cyan",
  "pink",
  "yellow",
  "teal",
  "coral",
] as const;

export type NexColor = (typeof NEX_COLOR_NAMES)[number];

export const NEX_COLORS: Record<NexColor, string> = {
  green: "#8FB9A4",
  blue: "#8FA3C4",
  red: "#C9898E",
  orange: "#C4A078",
  purple: "#A394C2",
  cyan: "#7EAEB8",
  pink: "#C496A8",
  yellow: "#C4B27A",
  teal: "#7EB8AE",
  coral: "#C49688",
};

/** Soft surfaces used for bot cards and role tiles. Keep the stronger marks above
 * for icons, borders, and status feedback so text contrast stays readable. */
export const NEX_PASTELS: Record<NexColor, string> = {
  green: "#D9F1E3",
  blue: "#DCE7F8",
  red: "#F6DCDD",
  orange: "#F5E6D2",
  purple: "#E9E2F6",
  cyan: "#D9F0F3",
  pink: "#F4DEE7",
  yellow: "#F5EED1",
  teal: "#D8EEE8",
  coral: "#F3DFD8",
};

export const NEX_EXPRESSIONS = [
  "deadpan",
  "friendly",
  "focused",
  "thinking",
  "excited",
  "sleepy",
  "surprised",
  "skeptical",
  "worried",
  "mischievous",
] as const;

export type NexExpression = (typeof NEX_EXPRESSIONS)[number];

export const NEX_MOTIONS = [
  "arrive",
  "switch",
  "customize",
  "alert",
  "thinking",
  "working",
  "waiting",
  "handover",
  "launch",
  "success",
  "celebrate",
  "blink",
  "surprise",
  "failure",
] as const;

export type NexMotion = "none" | (typeof NEX_MOTIONS)[number];

export type NexMotionPhase = {
  /** Human-readable state for motion previews and accessibility copy. */
  label: string;
  /** The visual language used by NexAvatar for this state. */
  motion: NexMotion;
  /** One-shot animations use a finite duration; looping states use null. */
  durationMs: number | null;
  /** Short explanation used by the motion map and future tooltips. */
  description: string;
};

/**
 * The NexBot motion vocabulary. Keep idle still and reserve motion for a
 * meaningful state change so the sidebar does not compete with the answer.
 */
export const NEX_MOTION_PHASES: Record<string, NexMotionPhase> = {
  idle: {
    label: "Ready",
    motion: "none",
    durationMs: null,
    description: "Still mark with no ambient loop.",
  },
  thinking: {
    label: "Thinking",
    motion: "thinking",
    durationMs: null,
    description: "Slow orbital ring while the bot decides what to do.",
  },
  working: {
    label: "Working",
    motion: "working",
    durationMs: null,
    description: "Focused scan while a tool or task is running.",
  },
  waiting: {
    label: "Waiting",
    motion: "waiting",
    durationMs: null,
    description: "One small pulse while a dependency or approval is pending.",
  },
  handover: {
    label: "Handing over",
    motion: "handover",
    durationMs: 420,
    description: "A short outbound pass when work moves to a teammate.",
  },
  success: {
    label: "Complete",
    motion: "success",
    durationMs: 420,
    description: "One spring ring, then settle back to still.",
  },
  alert: {
    label: "Needs attention",
    motion: "alert",
    durationMs: 420,
    description: "One restrained warning pulse for a blocked or failed turn.",
  },
  arrive: {
    label: "Added",
    motion: "arrive",
    durationMs: 260,
    description: "Soft scale-in when a NexBot joins the workspace.",
  },
  switch: {
    label: "Selected",
    motion: "switch",
    durationMs: 220,
    description: "Short turn when the active teammate changes.",
  },
};

type MascotMessage = {
  kind: string;
  tool?: { ok?: boolean };
};

export type MascotBotProfile = {
  name: string;
  title?: string;
  description?: string;
  mascotExpression?: NexExpression | null;
  busy?: boolean;
  unread?: boolean;
  messages?: MascotMessage[];
};

/**
 * Selects a face from live state first, then from what the bot is about.
 * The keyword groups deliberately overlap as little as possible so a bot's
 * visual identity stays stable while its title and description are edited.
 */
export function expressionForBot(bot: MascotBotProfile): NexExpression {
  if (bot.mascotExpression) return bot.mascotExpression;

  const last = bot.messages?.[bot.messages.length - 1];

  if (last?.kind === "activity" && last.tool?.ok === false) return "worried";
  if (bot.busy) return "focused";
  if (bot.unread) return "surprised";
  if (last?.kind === "options") return "thinking";

  const profile = `${bot.name} ${bot.title ?? ""} ${bot.description ?? ""}`.toLowerCase();
  const matches = (words: RegExp) => words.test(profile);

  if (matches(/\b(code|coding|developer|development|engineer|engineering|build|debug|program|software)\b/)) {
    return "focused";
  }
  if (matches(/\b(research|researcher|search|investigate|strategy|strategist|study|learn|knowledge)\b/)) {
    return "thinking";
  }
  if (matches(/\b(marketing|growth|launch|campaign|social|sales|outreach|brand)\b/)) {
    return "excited";
  }
  if (matches(/\b(overnight|night|background|async|queue|batch|long-running)\b/)) {
    return "sleepy";
  }
  if (matches(/\b(monitor|monitoring|incident|alert|watch|status|uptime)\b/)) {
    return "surprised";
  }
  if (matches(/\b(review|reviewer|audit|critic|critique|quality|qa|test|legal)\b/)) {
    return "skeptical";
  }
  if (matches(/\b(security|secure|compliance|risk|privacy|finance|financial)\b/)) {
    return "worried";
  }
  if (matches(/\b(design|designer|creative|brainstorm|art|illustration|music|story)\b/)) {
    return "mischievous";
  }
  if (matches(/\b(support|help|success|onboarding|coach|teacher|guide|welcome)\b/)) {
    return "friendly";
  }

  return "deadpan";
}
