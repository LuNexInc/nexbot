import { NEX_COLORS, type NexColor, type NexExpression, type NexMotion } from "@/lib/mascot";

export function botInitials(name?: string): string {
  const n = name?.trim();
  if (!n) return "N";
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]![0]!}${words[1]![0]!}`.toUpperCase();
  return n.slice(0, 1).toUpperCase();
}

export function NexAvatar({
  color,
  size = 44,
  label,
  name,
}: {
  color: NexColor;
  expression?: NexExpression;
  size?: number;
  label?: string;
  name?: string;
  motion?: NexMotion;
  motionKey?: number;
}) {
  const fill = NEX_COLORS[color] ?? NEX_COLORS.green;
  const initials = botInitials(name ?? label);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full border border-black/10 font-medium text-ink"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, size * 0.34),
        letterSpacing: "-0.02em",
        background: `linear-gradient(180deg, ${fill}33, ${fill}14)`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22)",
      }}
      role={label ? "img" : undefined}
      aria-label={label ?? name}
      aria-hidden={label || name ? undefined : true}
    >
      {initials}
    </div>
  );
}

export function InitialsAvatar({
  initials,
  size = 32,
}: {
  initials: string;
  size?: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full border border-black/10 bg-black/5 font-medium text-ink-secondary"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        letterSpacing: "-0.02em",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16)",
      }}
    >
      {initials}
    </div>
  );
}
