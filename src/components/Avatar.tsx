import {
  Blocks,
  Compass,
  ListChecks,
  MessageCircle,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { NEX_COLORS, NEX_PASTELS, type NexColor, type NexExpression, type NexMotion } from "@/lib/mascot";

export function botInitials(name?: string): string {
  const n = name?.trim();
  if (!n) return "N";
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]![0]!}${words[1]![0]!}`.toUpperCase();
  return n.slice(0, 1).toUpperCase();
}

/**
 * Role marks stay recognizable when the bot name is one of the seeded roles.
 * Custom names keep initials until the user gives them a known role name.
 */
export function botLogoForName(name?: string): LucideIcon | null {
  const profile = name?.trim().toLowerCase() ?? "";
  if (/\b(chief of staff|luna|staff)\b/.test(profile)) return Compass;
  if (/\b(research|researcher|index|brief|writing|knowledge)\b/.test(profile)) return Search;
  if (/\b(builder|forge|build|project|engineer)\b/.test(profile)) return Blocks;
  if (/\b(communication|communications|comms|message|outreach)\b/.test(profile)) return MessageCircle;
  if (/\b(operation|operations|ops|desk|inbox)\b/.test(profile)) return ListChecks;
  if (/\b(creative|spark|design|idea)\b/.test(profile)) return Sparkles;
  return null;
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
  const surface = NEX_PASTELS[color] ?? NEX_PASTELS.green;
  const initials = botInitials(name ?? label);
  const Logo = botLogoForName(name ?? label);

  const isThinking = motion === "thinking";
  const isWorking = motion === "working";
  const isWaiting = motion === "waiting";
  const isHandover = motion === "handover";
  const isActing = motion === "launch" || motion === "blink" || isWorking;
  const isSuccess = motion === "success" || motion === "celebrate";
  const isAlert = motion === "failure" || motion === "alert";
  const isPop = motion === "arrive" || motion === "customize" || motion === "surprise";
  const rootMotionClass =
    motion === "switch"
      ? "animate-avatar-switch"
      : isPop
        ? "animate-spring-pop"
        : "";

  return (
    <div
      key={motionKey}
      className={`relative flex shrink-0 items-center justify-center rounded-full font-medium text-ink transition-transform duration-200 ${rootMotionClass}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, size * 0.34),
        letterSpacing: "-0.02em",
        background: `linear-gradient(180deg, ${surface}e6, ${surface}99)`,
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

      {/* Working scan: a finite-width pass keeps tool activity legible without
       * turning the whole icon into a spinner. */}
      {isWorking && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
          <div
            className="animate-scan-beam absolute inset-y-0 left-0 w-1/3 opacity-55"
            style={{
              background: `linear-gradient(90deg, transparent, ${fill}80, transparent)`,
            }}
          />
        </div>
      )}

      {/* Waiting is intentionally quiet: one small status dot, not a busy loop. */}
      {isWaiting && (
        <span
          className="animate-waiting-pulse pointer-events-none absolute -right-0.5 -top-0.5 size-2 rounded-full border border-white/80"
          style={{ backgroundColor: fill }}
        />
      )}

      {/* Handover: a single pass communicates movement between teammates. */}
      {isHandover && (
        <span className="pointer-events-none absolute inset-x-[-10px] top-1/2 h-px overflow-hidden">
          <span
            className="animate-handover-flight absolute inset-y-0 left-0 w-1/2"
            style={{ background: `linear-gradient(90deg, transparent, ${fill}, transparent)` }}
          />
        </span>
      )}

      {/* Acting Scanning Beam */}
      {isActing && !isWorking && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
          <div
            className="animate-scan-beam h-1 w-full opacity-70"
            style={{
              background: `linear-gradient(90deg, transparent, ${fill}, transparent)`,
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

      {Logo ? (
        <Logo
          className="relative z-10"
          size={Math.max(15, Math.round(size * 0.46))}
          strokeWidth={1.85}
          aria-hidden="true"
        />
      ) : (
        <span className="relative z-10 font-semibold">{initials}</span>
      )}
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
