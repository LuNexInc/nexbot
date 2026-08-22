// Construction N: four thick nodes, two verticals, one diagonal.
// Optional draftsman guides for large/hero uses.
type NexMarkProps = {
  className?: string;
  /** 0 = mark only. 1 = hairline circle + cross. */
  guides?: number;
  title?: string;
};

export function NexMark({ className, guides = 0, title = "NexBot" }: NexMarkProps) {
  const ink = "currentColor";
  return (
    <svg
      className={className}
      viewBox="0 0 240 240"
      fill="none"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {guides > 0 && (
        <g stroke={ink} strokeOpacity={0.18} strokeWidth="1.25">
          <circle cx="120" cy="120" r="86" />
          <path d="M120 24 V216 M24 120 H216" />
          <circle cx="120" cy="120" r="2.5" fill={ink} fillOpacity={0.35} stroke="none" />
        </g>
      )}
      <g stroke={ink} strokeWidth="10" strokeLinecap="round">
        <path d="M76 64 V176" />
        <path d="M164 64 V176" />
        <path d="M76 64 L164 176" />
      </g>
      <g fill={ink}>
        <circle cx="76" cy="64" r="16" />
        <circle cx="164" cy="64" r="16" />
        <circle cx="76" cy="176" r="16" />
        <circle cx="164" cy="176" r="16" />
        {guides > 0 && (
          <g fillOpacity={0.55}>
            <circle cx="76" cy="120" r="5" />
            <circle cx="164" cy="120" r="5" />
            <circle cx="120" cy="120" r="5" />
          </g>
        )}
      </g>
    </svg>
  );
}
