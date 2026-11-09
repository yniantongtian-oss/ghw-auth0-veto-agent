import { updateJson } from "../json-file.js";
import type { Logger } from "../log.js";
import { GitHubError, splitRepository, type GitHubClient, type Issue, type Repo } from "./types.js";

type StoredRepo = {
  owner: string;
  name: string;
  private: boolean;
  archived: boolean;
  description: string;
};

type StoredIssue = {
  repository: string;
  number: number;
  title: string;
  state: "open" | "closed";
};

type GithubFile = {
  repos: StoredRepo[];
  issues: StoredIssue[];
  audit: Array<{ op: string; repository?: string; at: string }>;
};

export function seedGithubState(): GithubFile {
  return {
    repos: [
      {
        owner: "acme",
        name: "widgets",
        private: false,
        archived: false,
        description: "Demo widget service",
      },
      {
        owner: "acme",
        name: "notes",
        private: true,
        archived: false,
        description: "Internal notes",
      },
    ],
    issues: [
      { repository: "acme/widgets", number: 1, title: "Fix login", state: "open" },
      { repository: "acme/widgets", number: 2, title: "Update docs", state: "open" },
      { repository: "acme/notes", number: 7, title: "Ship mock mode", state: "open" },
      { repository: "acme/notes", number: 8, title: "Old note", state: "closed" },
    ],
    audit: [],
  };
}

export function ensureMockGithub(stateDir: string): GithubFile {
  return updateJson(stateDir, "github.json", seedGithubState, () => {});
}

export class MockGitHub implements GitHubClient {
  constructor(
    private readonly stateDir: string,
    private readonly token: string,
    private readonly logger: Logger,
  ) {
    if (!token) throw new GitHubError("GitHub access token is empty", 401);
  }

  async listRepos(): Promise<Repo[]> {
    const state = this.mutate((file) => {
      file.audit.push({ op: "listRepos", at: new Date().toISOString() });
    });
    this.logger.log("github", "GET /user/repos", { status: 200, mock: true });
    return state.repos
      .map((repo) => toRepo(repo, state.issues))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async listOpenIssues(repository: string): Promise<Issue[]> {
    const state = this.mutate((file) => {
      requireRepo(file, repository);
      file.audit.push({ op: "listOpenIssues", repository, at: new Date().toISOString() });
    });
    this.logger.log("github", `GET /repos/${repository}/issues`, { status: 200, state: "open", mock: true });
    return state.issues
      .filter((issue) => issue.repository === repository && issue.state === "open")
      .sort((a, b) => a.number - b.number);
  }

  async deleteRepo(repository: string): Promise<void> {
    this.mutate((file) => {
      requireRepo(file, repository);
      file.repos = file.repos.filter((repo) => fullName(repo) !== repository);
      file.issues = file.issues.filter((issue) => issue.repository !== repository);
      file.audit.push({ op: "deleteRepo", repository, at: new Date().toISOString() });
    });
    this.logger.log("github", `DELETE /repos/${repository}`, { status: 204, mock: true });
  }

  async closeAllIssues(repository: string): Promise<number[]> {
    const closed: number[] = [];
    this.mutate((file) => {
      requireRepo(file, repository);
      for (const issue of file.issues) {
        if (issue.repository === repository && issue.state === "open") {
          issue.state = "closed";
          closed.push(issue.number);
        }
      }
      file.audit.push({ op: "closeAllIssues", repository, at: new Date().toISOString() });
    });
    this.logger.log("github", `PATCH /repos/${repository}/issues`, {
      status: 200,
      state: "closed",
      count: closed.length,
      mock: true,
    });
    return closed.sort((a, b) => a - b);
  }

  async archiveRepo(repository: string): Promise<void> {
    this.mutate((file) => {
      const repo = requireRepo(file, repository);
      repo.archived = true;
      file.audit.push({ op: "archiveRepo", repository, at: new Date().toISOString() });
    });
    this.logger.log("github", `PATCH /repos/${repository}`, { status: 200, archived: true, mock: true });
  }

  private mutate(change: (file: GithubFile) => void): GithubFile {
    return updateJson(this.stateDir, "github.json", seedGithubState, change);
  }
}

function requireRepo(file: GithubFile, repository: string): StoredRepo {
  splitRepository(repository);
  const repo = file.repos.find((item) => fullName(item) === repository);
  if (!repo) throw new GitHubError(`GitHub repository ${repository} was not found`, 404);
  return repo;
}

function fullName(repo: StoredRepo): string {
  return `${repo.owner}/${repo.name}`;
}

function toRepo(repo: StoredRepo, issues: StoredIssue[]): Repo {
  const name = fullName(repo);
  return {
    owner: repo.owner,
    name: repo.name,
    fullName: name,
    private: repo.private,
    archived: repo.archived,
    description: repo.description,
    openIssues: issues.filter((issue) => issue.repository === name && issue.state === "open").length,
  };
}
