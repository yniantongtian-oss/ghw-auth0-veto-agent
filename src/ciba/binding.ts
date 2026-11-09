import { repositoryOf, type Action } from "../types.js";

const DISALLOWED = /[^A-Za-z0-9+\-_.,:# ]/g;

/** Auth0 binding messages are limited to 64 characters from a small alphabet. */
export function bindingMessage(action: Action): string {
  const repository = repositoryOf(action)?.replaceAll("/", ":") ?? "";
  const raw = repository ? `Veto ${action.type} ${repository}` : `Veto ${action.type}`;
  const cleaned = raw.replace(DISALLOWED, "-").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    throw new Error("binding message is empty");
  }
  return cleaned.slice(0, 64);
}

export function authorizationDetails(action: Action): Array<Record<string, string>> {
  const repository = repositoryOf(action);
  return [
    {
      type: "github_repo_mutation",
      action: action.type,
      ...(repository ? { repository } : {}),
    },
  ];
}
