import type { NexColor } from "./mascot";

export type NexBotTemplate = {
  id: "builder" | "spark" | "research" | "communications" | "operations" | "creative";
  name: string;
  title: string;
  description: string;
  color: NexColor;
};

/** Ready-made NexBots shown in the add flow. Fields stay editable after selection. */
export const NEXBOT_TEMPLATES: readonly NexBotTemplate[] = [
  {
    id: "builder",
    name: "Builder",
    title: "Projects & builds",
    description: "Turn a named project into concrete files, decisions, and next steps.",
    color: "orange",
  },
  {
    id: "spark",
    name: "Spark",
    title: "Ideas & creative work",
    description: "Shape rough ideas into clear concepts, drafts, and creative direction.",
    color: "purple",
  },
  {
    id: "research",
    name: "Research",
    title: "Research & briefings",
    description: "Find useful sources and turn them into concise, sourced briefings.",
    color: "blue",
  },
  {
    id: "communications",
    name: "Communications",
    title: "Messages & outreach",
    description: "Turn important conversations into clear messages, follow-ups, and outreach.",
    color: "cyan",
  },
  {
    id: "operations",
    name: "Operations",
    title: "Processes & follow-through",
    description: "Keep recurring work, checklists, and handoffs moving.",
    color: "teal",
  },
  {
    id: "creative",
    name: "Creative",
    title: "Design & direction",
    description: "Explore concepts, shape visual direction, and refine creative work.",
    color: "coral",
  },
];

/** Keep older persisted card copy aligned with the current NexBot vocabulary. */
export function nexBotCopy(text: string): string {
  return text
    .replace(/\bteammates\b/gi, "NexBots")
    .replace(/\bteammate's\b/gi, "NexBot's")
    .replace(/\bteammate\b/gi, "NexBot");
}
