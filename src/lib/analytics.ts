// Local no-op analytics. Upstream  shipped PostHog + email identify.
// NexBot does not send usage data unless Charles adds a future opt-in provider.

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
