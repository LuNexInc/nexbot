// File-watch + due-cron runner. Extracted from index.ts so the HTTP host
// only wires callbacks.
import { existsSync, watch, type FSWatcher } from "node:fs";

import { dueRoutines, listRoutines, markRan, type Routine } from "./routines.ts";

export type RoutineFireTarget = Pick<Routine, "id" | "botId" | "name" | "prompt">;

export type RoutineRuntime = {
  fireRoutineEvent: (routine: RoutineFireTarget, extra: string) => boolean;
  syncFileWatches: () => void;
  runDueRoutines: () => void;
  closeAll: () => void;
};

export function createRoutineRuntime(opts: {
  botReady: (botId: string) => boolean;
  startRoutine: (botId: string, text: string) => void;
  onFired: () => void;
}): RoutineRuntime {
  const fileWatchers = new Map<string, { watcher: FSWatcher; timer?: ReturnType<typeof setTimeout> }>();

  function closeFileWatch(id: string) {
    const row = fileWatchers.get(id);
    if (!row) return;
    if (row.timer) clearTimeout(row.timer);
    try {
      row.watcher.close();
    } catch {
      /* already closed */
    }
    fileWatchers.delete(id);
  }

  function fireRoutineEvent(routine: RoutineFireTarget, extra: string): boolean {
    if (!opts.botReady(routine.botId)) return false;
    const text = extra
      ? `[Routine: ${routine.name}]\n\n${routine.prompt}\n\n${extra}`
      : `[Routine: ${routine.name}]\n\n${routine.prompt}`;
    markRan(routine.id);
    opts.startRoutine(routine.botId, text);
    opts.onFired();
    return true;
  }

  function syncFileWatches() {
    for (const id of [...fileWatchers.keys()]) closeFileWatch(id);
    for (const routine of listRoutines()) {
      if (!routine.enabled || routine.kind !== "file" || !routine.watchPath) continue;
      const watchPath = routine.watchPath;
      if (!existsSync(watchPath)) continue;
      const routineId = routine.id;
      try {
        const watcher = watch(watchPath, (_event, filename) => {
          const entry = fileWatchers.get(routineId);
          if (!entry) return;
          if (entry.timer) clearTimeout(entry.timer);
          entry.timer = setTimeout(() => {
            const current = listRoutines().find((row) => row.id === routineId);
            if (!current?.enabled || current.kind !== "file") return;
            if (!opts.botReady(current.botId)) return;
            const changed = filename ? String(filename) : watchPath;
            fireRoutineEvent(current, `File changed: ${changed}`);
          }, 400);
        });
        fileWatchers.set(routineId, { watcher });
      } catch {
        /* path missing or unwatchable */
      }
    }
  }

  function runDueRoutines() {
    for (const routine of dueRoutines()) {
      if (!opts.botReady(routine.botId)) continue;
      markRan(routine.id);
      opts.startRoutine(routine.botId, `[Routine: ${routine.name}]\n\n${routine.prompt}`);
      opts.onFired();
    }
  }

  function closeAll() {
    for (const id of [...fileWatchers.keys()]) closeFileWatch(id);
  }

  return { fireRoutineEvent, syncFileWatches, runDueRoutines, closeAll };
}
