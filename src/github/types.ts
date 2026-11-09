export type Repo = {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  archived: boolean;
  description: string;
  openIssues: number;
};

export type Issue = {
  repository: string;
  number: number;
  title: string;
  state: "open" | "closed";
};

export class GitHubError extends Error {
  readonly name = "GitHubError";

  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export function splitRepository(repository: string): { owner: string; name: string } {
  const [owner, name, extra] = repository.split("/");
  if (!owner || !name || extra !== undefined) {
    throw new GitHubError(`repository must be owner/name, received ${repository}`, 400);
  }
  return { owner, name };
}

export interface GitHubClient {
  listRepos(): Promise<Repo[]>;
  listOpenIssues(repository: string): Promise<Issue[]>;
  deleteRepo(repository: string): Promise<void>;
  closeAllIssues(repository: string): Promise<number[]>;
  archiveRepo(repository: string): Promise<void>;
}
