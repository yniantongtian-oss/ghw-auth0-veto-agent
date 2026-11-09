export type ReadAction =
  | { type: "list_repos" }
  | { type: "list_open_issues"; repository: string };

export type HighImpactAction =
  | { type: "delete_repo"; repository: string }
  | { type: "close_all_issues"; repository: string }
  | { type: "archive_repo"; repository: string };

export type Action = ReadAction | HighImpactAction;

export type Impact = "read" | "high-impact";

export function repositoryOf(action: Action): string | undefined {
  return "repository" in action ? action.repository : undefined;
}

export function describeAction(action: Action): string {
  const repository = repositoryOf(action);
  return repository ? `${action.type} repository=${repository}` : action.type;
}
