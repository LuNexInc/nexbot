import { accessSync, constants } from "node:fs";

import { DATA_DIR } from "./config.ts";
import { integrityCheck } from "./db.ts";

export type DoctorStatus = "pass" | "warn" | "fail";
export interface DoctorCheck { id: string; status: DoctorStatus; detail: string }

export function localDoctorChecks(input: { cuaReady: boolean; queuedTurns: number; runningJobs: number }): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  let writable = true;
  try { accessSync(DATA_DIR, constants.R_OK | constants.W_OK); } catch { writable = false; }
  checks.push({ id: "data-dir", status: writable ? "pass" : "fail", detail: writable ? `${DATA_DIR} is readable and writable.` : `${DATA_DIR} is not readable and writable.` });
  let integrity: string;
  try { integrity = integrityCheck(); } catch (error) { integrity = error instanceof Error ? error.message : String(error); }
  checks.push({ id: "sqlite", status: integrity === "ok" ? "pass" : "fail", detail: `SQLite integrity: ${integrity}` });
  checks.push({ id: "local-computer", status: input.cuaReady ? "pass" : "warn", detail: input.cuaReady ? "Local CUA is ready." : "Local CUA is unavailable. Chat and file work still function." });
  checks.push({ id: "queue", status: input.queuedTurns > 25 ? "warn" : "pass", detail: `${input.queuedTurns} queued user turn(s).` });
  checks.push({ id: "jobs", status: input.runningJobs > 10 ? "warn" : "pass", detail: `${input.runningJobs} running job(s).` });
  return checks;
}
export function doctorOverall(checks: DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "pass";
}
