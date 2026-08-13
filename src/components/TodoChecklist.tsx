import { Check, Circle, Loader2, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import type { TodoItem } from "@/state/types";

const STATUS_LABEL: Record<TodoItem["status"], string> = {
  pending: "Pending",
  in_progress: "Doing",
  completed: "Done",
  cancelled: "Cancelled",
};

function StatusIcon({ status }: { status: TodoItem["status"] }) {
  if (status === "completed") return <Check size={13} className="text-success" />;
  if (status === "cancelled") return <Minus size={13} className="text-ink-secondary" />;
  if (status === "in_progress") return <Loader2 size={13} className="animate-spin text-accent" />;
  return <Circle size={12} className="text-ink-secondary" />;
}

export function TodoChecklist({ items }: { items: TodoItem[] }) {
  if (!items.length) return null;
  const open = items.filter((t) => t.status === "pending" || t.status === "in_progress").length;
  return (
    <div className="border-t border-hairline/40 px-5 py-2">
      <div className="mx-auto max-w-[900px] rounded-xl border border-black/8 bg-black/4 px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between px-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-secondary">
          <span>Checklist</span>
          <span>
            {open} open · {items.length} total
          </span>
        </div>
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li
              key={item.id}
              className={cn(
                "flex items-start gap-2 rounded-lg px-1 py-0.5 text-[13px] leading-snug",
                item.status === "cancelled" && "text-ink-secondary line-through",
                item.status === "completed" && "text-ink-secondary",
                item.status === "in_progress" && "text-ink",
              )}
            >
              <span className="mt-0.5 shrink-0">
                <StatusIcon status={item.status} />
              </span>
              <span className="min-w-0 flex-1">{item.content}</span>
              <span className="shrink-0 text-[11px] text-ink-secondary">{STATUS_LABEL[item.status]}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
