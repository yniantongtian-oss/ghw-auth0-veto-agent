import type { Action } from "./types.js";

export class ParseError extends Error {
  readonly name = "ParseError";

  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

const REPO = "([a-z0-9_.-]+/[a-z0-9_.-]+)";
const PLEASE = "(?:please\\s+)?";

const LIST_REPOS = new RegExp(`^${PLEASE}(?:list|show|get)\\s+(?:my\\s+)?(?:repos|repositories)$`, "i");
const LIST_ISSUES = new RegExp(
  `^${PLEASE}(?:list|show|get)\\s+(?:my\\s+)?(?:open\\s+)?issues(?:\\s+(?:in|for|on))?\\s+${REPO}$`,
  "i",
);
const DELETE_REPO = new RegExp(`^${PLEASE}delete\\s+(?:the\\s+)?repo(?:sitory)?\\s+${REPO}$`, "i");
const CLOSE_ISSUES = new RegExp(
  `^${PLEASE}close\\s+(?:all\\s+|every\\s+)?issues(?:\\s+(?:in|for|on))?\\s+${REPO}$`,
  "i",
);
const ARCHIVE_REPO = new RegExp(`^${PLEASE}archive\\s+(?:the\\s+)?repo(?:sitory)?\\s+${REPO}$`, "i");

export function parseCommand(input: string): Action {
  const cleaned = input.trim().replace(/\s+/g, " ");
  if (!cleaned) throw new ParseError(usage());
  if (LIST_REPOS.test(cleaned)) return { type: "list_repos" };

  const issues = takeRepo(cleaned, LIST_ISSUES);
  if (issues) return { type: "list_open_issues", repository: issues };

  const deleted = takeRepo(cleaned, DELETE_REPO);
  if (deleted) return { type: "delete_repo", repository: deleted };

  const closed = takeRepo(cleaned, CLOSE_ISSUES);
  if (closed) return { type: "close_all_issues", repository: closed };

  const archived = takeRepo(cleaned, ARCHIVE_REPO);
  if (archived) return { type: "archive_repo", repository: archived };

  throw new ParseError(`Could not understand "${cleaned}".\n${usage()}`);
}

export function usage(): string {
  return [
    "Commands:",
    "  list repos",
    "  list open issues <owner/repo>",
    "  delete repo <owner/repo>",
    "  close all issues <owner/repo>",
    "  archive repo <owner/repo>",
    "  approve <auth_req_id>",
    "  deny <auth_req_id>",
    "  pending",
    "  login",
  ].join("\n");
}

function takeRepo(original: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(original);
  if (!match?.[1]) return undefined;
  const lower = original.toLowerCase();
  const at = lower.indexOf(match[1].toLowerCase());
  if (at < 0) return match[1];
  return original.slice(at, at + match[1].length);
}
