import { useState } from "react";
import { CheckIcon, CopyIcon, DeskIcon, TerminalIcon } from "./icons";
import { useStore } from "@/state/store";
import { api } from "@/state/api";

export function CodeBlock({
  code,
  language = "text",
  botId,
}: {
  code: string;
  language?: string;
  botId?: string;
}) {
  const { dispatch } = useStore();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const lines = code.trim().split("\n");
  const lineCount = lines.length;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* fallback */
    }
  };

  const onSaveToDesk = async () => {
    if (!botId) return;
    try {
      const ext = language === "python" ? "py" : language === "typescript" ? "ts" : language === "javascript" ? "js" : "txt";
      const filename = `snippet-${Date.now()}.${ext}`;
      await api(`/api/bots/${botId}/desk/inbox`, {
        method: "POST",
        body: JSON.stringify({ filename, content: code }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      /* ignore */
    }
  };

  const onRunInTerminal = () => {
    if (!botId) return;
    dispatch({
      type: "send",
      botId,
      text: `Run this in terminal:\n\`\`\`${language}\n${code}\n\`\`\``,
    });
  };

  return (
    <div className="my-2.5 overflow-hidden rounded-xl border border-white/10 bg-[#121317] text-gray-200 shadow-lg">
      {/* Code Header Bar */}
      <div className="flex items-center justify-between border-b border-white/8 bg-[#18191f] px-3.5 py-2 text-[12px]">
        <div className="flex items-center gap-2 font-mono text-gray-400">
          <span className="font-semibold uppercase text-gray-300">{language}</span>
          <span>•</span>
          <span>{lineCount} {lineCount === 1 ? "line" : "lines"}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onCopy}
            className="pressable flex items-center gap-1 rounded-md px-2 py-1 text-gray-400 hover:bg-white/8 hover:text-gray-200"
            title="Copy snippet"
          >
            {copied ? <CheckIcon size={13} className="text-emerald-400" /> : <CopyIcon size={13} />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
          {botId && (
            <button
              onClick={onSaveToDesk}
              className="pressable flex items-center gap-1 rounded-md px-2 py-1 text-gray-400 hover:bg-white/8 hover:text-gray-200"
              title="Save file to bot's desk inbox"
            >
              <DeskIcon size={13} />
              <span>{saved ? "Saved" : "Save to Desk"}</span>
            </button>
          )}
          {botId && (
            <button
              onClick={onRunInTerminal}
              className="pressable flex items-center gap-1 rounded-md px-2 py-1 text-gray-400 hover:bg-white/8 hover:text-gray-200"
              title="Run code snippet in terminal"
            >
              <TerminalIcon size={13} />
              <span>Run</span>
            </button>
          )}
        </div>
      </div>

      {/* Code Content */}
      <div className="overflow-x-auto p-3.5 font-mono text-[13px] leading-relaxed text-gray-100">
        <pre className="m-0">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}


