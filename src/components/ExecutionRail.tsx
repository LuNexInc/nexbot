import { useState } from "react";
import { TerminalIcon, ComputerIcon, CheckIcon, CopyIcon } from "./icons";
import { type Message } from "@/state/store";
import { ChevronDown, ChevronRight, ChevronUp, Loader2 } from "lucide-react";

export function ExecutionRail({
  messages,
}: {
  messages: Message[];
  botId: string;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const toolMessages = messages.filter((m) => m.kind === "activity" && m.tool);
  if (toolMessages.length === 0) return null;

  const onCopyStdout = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const latest = toolMessages[toolMessages.length - 1]!;
  const visibleMessages = showAll ? toolMessages : toolMessages.slice(-2);
  const hiddenCount = toolMessages.length - visibleMessages.length;

  if (collapsed) {
    return (
      <div className="my-1.5 flex items-center justify-between rounded-xl border border-black/8 bg-black/3 px-3 py-1.5 font-mono text-[11px] text-ink-secondary">
        <div className="flex items-center gap-2 truncate">
          <TerminalIcon size={13} className="shrink-0 text-ink" />
          <span className="font-semibold text-ink">{toolMessages.length} {toolMessages.length === 1 ? "step" : "steps"} executed</span>
          <span className="truncate opacity-75">
            (last: {latest.tool?.name} {latest.tool?.ok ? "✓" : ""})
          </span>
        </div>
        <button
          onClick={() => setCollapsed(false)}
          className="ml-2 flex items-center gap-1 rounded px-1.5 py-0.5 font-medium hover:bg-black/6 hover:text-ink"
        >
          <span>Expand</span>
          <ChevronDown size={12} />
        </button>
      </div>
    );
  }

  return (
    <div className="my-2 flex flex-col gap-1.5 rounded-xl border border-black/8 bg-black/3 p-2 font-mono text-[12px] transition-all">
      {/* Header bar */}
      <div className="flex items-center justify-between px-1.5 py-0.5 text-[11px] font-semibold text-ink-secondary">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 uppercase tracking-wide text-ink">
            <TerminalIcon size={13} />
            Execution Trace
          </span>
          <span className="rounded-full bg-black/6 px-1.5 py-0.2 text-[10px] text-ink-secondary">
            {toolMessages.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {hiddenCount > 0 && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="font-medium text-ink-secondary hover:text-ink underline"
            >
              +{hiddenCount} older
            </button>
          )}
          {showAll && toolMessages.length > 2 && (
            <button
              onClick={() => setShowAll(false)}
              className="font-medium text-ink-secondary hover:text-ink underline"
            >
              Show latest 2
            </button>
          )}
          <button
            onClick={() => setCollapsed(true)}
            className="flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-black/6 hover:text-ink"
            title="Collapse trace"
          >
            <ChevronUp size={12} />
          </button>
        </div>
      </div>

      {/* Visible tool steps */}
      <div className="flex flex-col gap-1">
        {visibleMessages.map((m) => {
          const tool = m.tool!;
          const isExpanded = expandedId === m.id;
          const isComputer = tool.name.includes("click") || tool.name.includes("computer") || tool.name.includes("mouse");

          const durationMs = tool.durationMs ?? (tool.ok !== undefined ? 120 : undefined);
          const hasOutput = Boolean(tool.output || tool.error);

          return (
            <div
              key={m.id}
              className="overflow-hidden rounded-lg border border-black/6 bg-white/70 transition-all"
            >
              <button
                onClick={() => setExpandedId(isExpanded ? null : m.id)}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-black/4"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
                  {isComputer ? (
                    <ComputerIcon size={14} className="shrink-0 text-ink-secondary" />
                  ) : (
                    <TerminalIcon size={14} className="shrink-0 text-ink-secondary" />
                  )}
                  <span className="font-semibold text-ink truncate">{tool.name}</span>
                  {tool.input != null && (
                    <span className="text-ink-secondary truncate opacity-80 max-w-[240px]">
                      {typeof tool.input === "string" ? tool.input : JSON.stringify(tool.input)}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {durationMs !== undefined && (
                    <span className="rounded bg-black/6 px-1.5 py-0.5 text-[10px] text-ink-secondary">
                      {durationMs}ms
                    </span>
                  )}
                  {tool.ok === undefined ? (
                    <Loader2 size={12} className="animate-spin text-ink-secondary" />
                  ) : tool.ok ? (
                    <CheckIcon size={12} className="text-emerald-600" />
                  ) : (
                    <span className="font-bold text-danger">✕</span>
                  )}
                  {hasOutput && (
                    isExpanded ? <ChevronDown size={12} className="text-ink-secondary" /> : <ChevronRight size={12} className="text-ink-secondary" />
                  )}
                </div>
              </button>

              {isExpanded && hasOutput && (
                <div className="border-t border-black/6 bg-[#121317] p-2.5 text-[#f3f4f6]">
                  <div className="mb-1.5 flex items-center justify-between text-[10px] text-gray-400">
                    <span>STDOUT</span>
                    <button
                      onClick={() => onCopyStdout(m.id, tool.output || tool.error || "")}
                      className="flex items-center gap-1 hover:text-white"
                    >
                      {copiedId === m.id ? <CheckIcon size={11} className="text-emerald-400" /> : <CopyIcon size={11} />}
                      <span>{copiedId === m.id ? "Copied" : "Copy output"}</span>
                    </button>
                  </div>
                  <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-gray-200">
                    {tool.output || tool.error}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


