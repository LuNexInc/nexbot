import { useEffect, useState } from "react";
import { BookOpen, Trash2, X } from "lucide-react";
import { api, useStore } from "@/state/store";

export type Skill = {
  slug: string;
  name: string;
  description: string;
  path: string;
  source: "nexbot" | "claude";
  valid: boolean;
  error?: string;
};

/** List + create local SKILL.md files. Shared by the Skills panel and Team Setup. */
export function SkillsBody({ nested = false }: { nested?: boolean }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const load = () => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d) => setSkills(d.skills ?? []))
      .catch(() => {});
  };
  useEffect(load, []);

  const rowClass = nested ? "rounded-lg bg-inset p-3" : "rounded-xl bg-card p-3";

  return (
    <div>
      <p className="text-[13px] leading-relaxed text-ink-secondary">
        Local SKILL.md files on this PC. Create and delete here (desk-wide). Turn each
        skill on or off per agent under the bot gear. Drop files in{" "}
        <code className="text-ink">~/.nexbot/skills</code> or save one below. Also lists{" "}
        <code className="text-ink">~/.claude/skills</code>.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {skills.length === 0 && (
          <div className="rounded-lg bg-inset px-3 py-3 text-[13px] text-ink-secondary">
            No local skills yet. Create one here, or put a SKILL.md under{" "}
            <code className="text-ink">~/.nexbot/skills</code>.
          </div>
        )}
        {skills.map((s) => (
          <div key={s.path} className={rowClass}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[14px] font-medium text-ink">{s.name}</div>
                <div className="mt-0.5 text-[12px] text-ink-secondary">{s.description || s.error}</div>
                <div className="mt-1 text-[11px] text-ink-secondary">
                  {s.source} · {s.valid ? "ok" : "invalid"}
                </div>
              </div>
              {s.source === "nexbot" && (
                <button
                  onClick={() => api(`/api/skills/${s.slug}`, { method: "DELETE" }).then(load)}
                  className="text-ink-secondary hover:text-danger"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className={nested ? "mt-3" : "mt-4 rounded-xl bg-card p-3"}>
        <div className="flex items-center gap-2 text-[14px] font-medium text-ink">
          <BookOpen size={14} />
          New skill
        </div>
        <input
          className="mt-2 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="mt-2 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button
          onClick={() => {
            if (!name.trim() || !description.trim()) return;
            api("/api/skills", { method: "POST", body: JSON.stringify({ name, description }) }).then(() => {
              setName("");
              setDescription("");
              load();
            });
          }}
          className="pressable mt-2 w-full rounded-lg bg-raised py-2 text-[13px] text-ink hover:bg-raised-hover"
        >
          Save
        </button>
      </div>
    </div>
  );
}

export function SkillsPanel() {
  const { dispatch } = useStore();

  return (
    <aside className="glass-heavy animate-panel-in flex h-full w-[400px] shrink-0 flex-col border-l border-black/8">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[15px] font-semibold text-ink">Skills</span>
        <button
          onClick={() => dispatch({ type: "toggleSkills", open: false })}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-5">
        <SkillsBody />
      </div>
    </aside>
  );
}
