// The chat transcript is a customer-facing surface. Raw driver/CLI internals
// — exit codes, JSON fragments, binary names, filesystem paths — never
// belong in it: they read as unreliability and leak implementation detail.
// Full diagnostics stay in the events/ and native/ logs for the operator;
// this maps failures to short, honest, human sentences.

const RULES: Array<{ test: RegExp; message: string }> = [
  {
    test: /exited \d+ before|exit_before_result/i,
    message: "The AI engine stopped before finishing. Your request is saved — try again, and check Doctor in App Settings if it keeps happening.",
  },
  {
    test: /cli not found|spawn failed|ENOENT|spawn_error/i,
    message: "The AI engine could not start on this PC. Check Doctor in App Settings for setup steps.",
  },
  {
    test: /no ai provider is ready/i,
    message: "No AI engine is signed in yet. Sign in to one of the supported agent apps, then try again.",
  },
  {
    test: /timed?.?out|timeout/i,
    message: "The AI engine took too long to answer. Try again — your request is saved.",
  },
  {
    test: /already working|a turn is already running/i,
    message: "Still working on the previous request. Queue the message or stop the current one first.",
  },
  {
    test: /operator takeover/i,
    message: "Manual control is active for this teammate. Release it to let them work.",
  },
  {
    test: /body too large|invalid json body/i,
    message: "That message was too large or malformed. Try sending a smaller version.",
  },
  {
    test: /interrupted|cancelled/i,
    message: "Stopped before finishing.",
  },
];

/** Map any internal failure string to chat-safe text. Unknown failures are
 * stripped of internals (JSON, paths, code tokens) rather than passed
 * through verbatim. */
export function userFacingError(raw: string): string {
  const text = String(raw ?? "");
  for (const rule of RULES) {
    if (rule.test.test(text)) return rule.message;
  }
  const cleaned = text
    .replace(/\{[^{}]*\}/g, " ")
    .replace(/[A-Za-z]:\\[^\s"']*/g, " ")
    .replace(/\b(?:\/[\w.-]+)+\b/g, " ")
    .replace(/`([^`]{1,60})`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length >= 8 && cleaned.length <= 160) return cleaned;
  return "Something went wrong running this request. Try again — your message is saved.";
}
