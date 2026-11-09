import {
  AccessDeniedInterrupt,
  AuthorizationRequestExpiredInterrupt,
  InvalidGrantInterrupt,
  UserDoesNotHavePushNotificationsInterrupt,
} from "@auth0/ai/interrupts";

import { cibaChannel, type AppConfig } from "./config.js";
import { createAuth0CibaTransport } from "./ciba/auth0-transport.js";
import { createHttpCibaTransport } from "./ciba/http-transport.js";
import { startMockAuth0, type MockAuth0 } from "./ciba/mock-server.js";
import { pollForApproval } from "./ciba/poller.js";
import { HttpGitHub } from "./github/http-github.js";
import { ensureMockGithub, MockGitHub } from "./github/mock-github.js";
import type { GitHubClient, Issue, Repo } from "./github/types.js";
import { Logger } from "./log.js";
import { ParseError, parseCommand } from "./parse.js";
import { impactOf } from "./policy.js";
import { describeAction, type Action } from "./types.js";
import { createTokenVault } from "./vault/token-vault.js";

export type RunStatus = "completed" | "denied" | "expired" | "error";

export type RunResult = {
  status: RunStatus;
  message: string;
  exitCode: number;
  action?: Action;
  output?: Repo[] | Issue[] | number[] | null;
  authReqId?: string;
  events: Logger["events"];
};

export async function runCommand(
  input: string,
  options: { config: AppConfig; logger?: Logger },
): Promise<RunResult> {
  const logger = options.logger ?? new Logger();
  const config = options.config;
  let action: Action;
  try {
    action = parseCommand(input);
  } catch (err) {
    if (err instanceof ParseError) {
      logger.log("agent", err.message);
      return { status: "error", message: err.message, exitCode: 1, events: logger.events };
    }
    throw err;
  }

  logger.log("agent", `understood command as ${describeAction(action)}`, {
    input,
  });
  if (config.mockGithub) ensureMockGithub(config.stateDir);
  const impact = impactOf(action);
  if (impact === "read") {
    logger.log("policy", "read-only action runs without asynchronous approval", {
      action: action.type,
      approval: "skipped",
    });
  } else {
    logger.log("policy", "high-impact action requires out-of-band approval before GitHub is called", {
      action: action.type,
      approval: "required",
      channel: cibaChannel(config.requestedExpirySec),
    });
  }

  let server: MockAuth0 | undefined;
  try {
    let authReqId: string | undefined;
    if (impact === "high-impact") {
      if (config.mockCiba) {
        server = await startMockAuth0({
          stateDir: config.stateDir,
          pollIntervalSec: config.pollIntervalSec,
        });
      }
      const transport = config.mockCiba
        ? createHttpCibaTransport(server!.baseUrl, config)
        : createAuth0CibaTransport(config);
      try {
        const approval = await pollForApproval({ transport, action, config, logger });
        authReqId = approval.request.id;
      } catch (err) {
        return approvalFailure(err, action, logger);
      }
    }

    const vault = createTokenVault(config, logger);
    const token = await vault.getGitHubAccessToken();
    const github = createGitHub(config, token.accessToken, logger);
    const output = await execute(action, github);
    const message = formatSuccess(action, output);
    logger.log("agent", "completed", { action: action.type });
    return {
      status: "completed",
      message,
      exitCode: 0,
      action,
      output,
      authReqId,
      events: logger.events,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.log("agent", "failed", { error: message });
    return { status: "error", message, exitCode: 1, action, events: logger.events };
  } finally {
    await server?.close();
  }
}

function createGitHub(config: AppConfig, token: string, logger: Logger): GitHubClient {
  return config.mockGithub
    ? new MockGitHub(config.stateDir, token, logger)
    : new HttpGitHub(token, config.githubApiBase, logger);
}

async function execute(action: Action, github: GitHubClient): Promise<Repo[] | Issue[] | number[] | null> {
  switch (action.type) {
    case "list_repos":
      return github.listRepos();
    case "list_open_issues":
      return github.listOpenIssues(action.repository);
    case "delete_repo":
      await github.deleteRepo(action.repository);
      return null;
    case "close_all_issues":
      return github.closeAllIssues(action.repository);
    case "archive_repo":
      await github.archiveRepo(action.repository);
      return null;
    default: {
      const neverAction: never = action;
      throw new Error(`unhandled action ${JSON.stringify(neverAction)}`);
    }
  }
}

function formatSuccess(action: Action, output: Repo[] | Issue[] | number[] | null): string {
  if (action.type === "list_repos") {
    const repos = output as Repo[];
    if (repos.length === 0) return "no repositories";
    return repos
      .map(
        (repo) =>
          `${repo.fullName}  private=${repo.private}  archived=${repo.archived}  open_issues=${repo.openIssues}  ${repo.description}`,
      )
      .join("\n");
  }
  if (action.type === "list_open_issues") {
    const issues = output as Issue[];
    if (issues.length === 0) return `no open issues in ${action.repository}`;
    return issues.map((issue) => `#${issue.number}  ${issue.state}  ${issue.title}`).join("\n");
  }
  if (action.type === "delete_repo") return `deleted ${action.repository}`;
  if (action.type === "archive_repo") return `archived ${action.repository}`;
  const closed = (output as number[]) ?? [];
  if (closed.length === 0) return `no open issues to close in ${action.repository}`;
  return `closed ${closed.length} issues in ${action.repository}: ${closed.map((n) => `#${n}`).join(" ")}`;
}

function approvalFailure(err: unknown, action: Action, logger: Logger): RunResult {
  if (err instanceof AccessDeniedInterrupt) {
    const message = `denied by user: ${describeAction(action)} was not executed`;
    logger.log("agent", message, { auth_req_id: err.request.id });
    return {
      status: "denied",
      message,
      exitCode: 2,
      action,
      authReqId: err.request.id,
      events: logger.events,
    };
  }
  if (err instanceof AuthorizationRequestExpiredInterrupt || err instanceof InvalidGrantInterrupt) {
    const authReqId = "request" in err ? err.request.id : undefined;
    const message = `approval request expired before ${describeAction(action)} could run`;
    logger.log("agent", message, authReqId ? { auth_req_id: authReqId } : {});
    return {
      status: "expired",
      message,
      exitCode: 3,
      action,
      authReqId,
      events: logger.events,
    };
  }
  if (err instanceof UserDoesNotHavePushNotificationsInterrupt) {
    const message = `CIBA could not reach the user: ${err.message}`;
    logger.log("agent", message);
    return { status: "error", message, exitCode: 1, action, events: logger.events };
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.log("agent", "authorization failed", { error: message });
  return { status: "error", message, exitCode: 1, action, events: logger.events };
}
