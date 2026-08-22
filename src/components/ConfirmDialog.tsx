import { useEffect, useRef } from "react";

/** Styled confirmation for destructive actions. Replaces window.confirm so
 * the app keeps one consistent dialog language. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="glass-floating w-full max-w-[380px] rounded-2xl p-5 shadow-2xl animate-spring-pop">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {body && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-secondary">{body}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="pressable min-h-9 rounded-lg border border-black/10 px-3.5 text-[13px] font-medium text-ink-secondary hover:bg-black/6 hover:text-ink"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={cnx(
              "pressable min-h-9 rounded-lg px-3.5 text-[13px] font-semibold text-white",
              danger ? "bg-danger hover:opacity-90" : "bg-ink hover:opacity-90",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function cnx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
