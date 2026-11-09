import type { Action, Impact } from "./types.js";

const HIGH_IMPACT = new Set<Action["type"]>([
  "delete_repo",
  "close_all_issues",
  "archive_repo",
]);

export function impactOf(action: Action): Impact {
  return HIGH_IMPACT.has(action.type) ? "high-impact" : "read";
}
