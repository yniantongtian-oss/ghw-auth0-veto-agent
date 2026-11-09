import type { Logger } from "../log.js";
import { GitHubError, splitRepository, type GitHubClient, type Issue, type Repo } from "./types.js";

type GitHubRepoResponse = {
  name: string;
  full_name: string;
  private: boolean;
  archived: boolean;
  description: string | null;
  open_issues_count: number;
  owner?: { login?: string };
};

type GitHubIssueResponse = {
  number: number;
  title: string;
  state: "open" | "closed";
  pull_request?: unknown;
};

export class HttpGitHub implements GitHubClient {
  constructor(
    private readonly token: string,
    private readonly baseUrl: string,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!token) throw new GitHubError("GitHub access token is empty", 401);
  }

  async listRepos(): Promise<Repo[]> {
    const repos: Repo[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const batch = await this.request<GitHubRepoResponse[]>(
        "GET",
        `/user/repos?per_page=100&page=${page}&affiliation=owner`,
      );
      repos.push(
        ...batch.map((repo) => ({
          owner: repo.owner?.login ?? repo.full_name.split("/")[0] ?? "",
          name: repo.name,
          fullName: repo.full_name,
          private: repo.private,
          archived: repo.archived,
          description: repo.description ?? "",
          openIssues: repo.open_issues_count,
        })),
      );
      if (batch.length < 100) break;
    }
    return repos.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async listOpenIssues(repository: string): Promise<Issue[]> {
    splitRepository(repository);
    const issues: Issue[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const batch = await this.request<GitHubIssueResponse[]>(
        "GET",
        `/repos/${repository}/issues?state=open&per_page=100&page=${page}`,
      );
      issues.push(
        ...batch
          .filter((issue) => !issue.pull_request)
          .map((issue) => ({
            repository,
            number: issue.number,
            title: issue.title,
            state: issue.state,
          })),
      );
      if (batch.length < 100) break;
    }
    return issues.sort((a, b) => a.number - b.number);
  }

  async deleteRepo(repository: string): Promise<void> {
    splitRepository(repository);
    await this.request("DELETE", `/repos/${repository}`);
  }

  async closeAllIssues(repository: string): Promise<number[]> {
    const open = await this.listOpenIssues(repository);
    const closed: number[] = [];
    for (const issue of open) {
      await this.request("PATCH", `/repos/${repository}/issues/${issue.number}`, { state: "closed" });
      closed.push(issue.number);
    }
    return closed;
  }

  async archiveRepo(repository: string): Promise<void> {
    splitRepository(repository);
    await this.request("PATCH", `/repos/${repository}`, { archived: true });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "user-agent": "veto-agent",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    this.logger.log("github", `${method} ${path.split("?")[0]}`, { status: response.status });
    if (!response.ok) {
      let message = text || response.statusText;
      try {
        const parsed = JSON.parse(text) as { message?: string };
        if (parsed.message) message = parsed.message;
      } catch {
        // Keep the raw body.
      }
      throw new GitHubError(`GitHub ${method} ${path} failed (${response.status}): ${message}`, response.status);
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
}
