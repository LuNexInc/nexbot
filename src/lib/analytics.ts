// Local no-op analytics. NexBot does not ship product telemetry.

let ready = false;

export function initAnalytics() {
  ready = true;
}

export function track(_event: string, _props?: Record<string, unknown>) {
  void ready;
}

export function identifyEmail(_email: string) {
  // Profile email may still be saved locally via /api/config in Onboarding.
}

// first-run onboarding gate (local only)
const GATE_KEY = "nexbot-email-gate";
export function emailGateDone(): boolean {
  return Boolean(localStorage.getItem(GATE_KEY));
}
export function setEmailGateDone(status: "submitted" | "skipped") {
  localStorage.setItem(GATE_KEY, status);
}
