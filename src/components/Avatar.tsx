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
  motion,
  motionKey,
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

  const isThinking = motion === "thinking" || motion === "working";
  const isActing = motion === "launch" || motion === "blink";
  const isSuccess = motion === "success";
  const isAlert = motion === "failure" || motion === "alert";

  return (
    <div
      key={motionKey}
      className="relative flex shrink-0 items-center justify-center rounded-full font-medium text-ink transition-transform duration-200"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, size * 0.34),
        letterSpacing: "-0.02em",
        background: `linear-gradient(180deg, ${fill}2e, ${fill}10)`,
        border: `1px solid ${fill}40`,
        boxShadow: isAlert
          ? `0 0 12px ${NEX_COLORS.red}60, inset 0 1px 0 rgba(255,255,255,0.4)`
          : isSuccess
            ? `0 0 12px ${NEX_COLORS.green}60, inset 0 1px 0 rgba(255,255,255,0.4)`
            : "inset 0 1px 0 rgba(255,255,255,0.3), 0 1px 3px rgba(0,0,0,0.06)",
      }}
      role={label ? "img" : undefined}
      aria-label={label ?? name}
      aria-hidden={label || name ? undefined : true}
    >
      {/* Orbital Thinking Ring */}
      {isThinking && (
        <div
          className="animate-orbital pointer-events-none absolute -inset-1 rounded-full border border-dashed opacity-75"
          style={{ borderColor: fill }}
        />
      )}

      {/* Acting Scanning Beam */}
      {isActing && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
          <div
            className="h-1 w-full opacity-70"
            style={{
              background: `linear-gradient(90deg, transparent, ${fill}, transparent)`,
              animation: "scan-beam 1.2s ease-in-out infinite alternate",
            }}
          />
        </div>
      )}

      {/* Success / Alert Burst */}
      {(isSuccess || isAlert) && (
        <div
          className="animate-spring-pop pointer-events-none absolute -inset-0.5 rounded-full border opacity-50"
          style={{ borderColor: isAlert ? NEX_COLORS.red : NEX_COLORS.green }}
        />
      )}

      <span className="relative z-10 font-semibold">{initials}</span>
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
