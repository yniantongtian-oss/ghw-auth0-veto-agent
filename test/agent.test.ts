import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { runCommand } from "../src/agent.js";
import { decide, pending } from "../src/control.js";
import { githubFile, silentLogger, tempStateDir, testConfig, waitFor } from "./helpers.js";
import type { Logger } from "../src/log.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function setup(overrides: Parameters<typeof testConfig>[1] = {}) {
  const dir = tempStateDir();
  dirs.push(dir);
  const logger = silentLogger();
  const config = testConfig(dir, overrides);
  return { dir, logger, config };
}

function hasResult(logger: Logger, result: string): boolean {
  return logger.events.some((event) => event.fields.result === result);
}

describe("veto agent", () => {
  it("lists repositories without starting CIBA", async () => {
    const { dir, logger, config } = setup();
    const result = await runCommand("list my repos", { config, logger });
    expect(result.status).toBe("completed");
    expect(result.message).toContain("acme/widgets");
    expect(result.message).toContain("open_issues=2");
    expect(result.message).toContain("acme/notes");
    expect(logger.events.some((event) => event.message.includes("/bc-authorize"))).toBe(false);
    expect(logger.events.some((event) => event.message.includes("HALTED"))).toBe(false);
    expect(logger.events.some((event) => event.fields.approval === "skipped")).toBe(true);
    expect(fs.existsSync(`${dir}/server.json`)).toBe(false);
    const messages = logger.events.map((event) => event.message);
    const vaultAt = messages.findIndex((message) => message === "POST /oauth/token" && true);
    const githubAt = messages.findIndex((message) => message.startsWith("GET /user/repos"));
    expect(logger.events[vaultAt]?.component).toBe("vault");
    expect(githubAt).toBeGreaterThan(vaultAt);
  });

  it("lists only open issues", async () => {
    const { logger, config } = setup();
    const result = await runCommand("list open issues in acme/notes", { config, logger });
    expect(result.status).toBe("completed");
    expect(result.message).toContain("#7");
    expect(result.message).toContain("Ship mock mode");
    expect(result.message).not.toContain("Old note");
  });

  it("halts a delete until an out-of-band approval", async () => {
    const { dir, logger, config } = setup();
    const running = runCommand("delete repo acme/widgets", { config, logger });
    await waitFor(() => hasResult(logger, "authorization_pending"), "authorization_pending");
    const authReqId = String(logger.events.find((event) => event.fields.auth_req_id)?.fields.auth_req_id);
    expect(authReqId).toMatch(/^ciba_/);
    const listed = await pending(config);
    expect(listed.join("\n")).toContain(authReqId);
    expect(listed.join("\n")).toContain("Veto delete_repo acme:widgets");
    const before = githubFile(dir);
    expect(before?.repos.some((repo) => repo.name === "widgets")).toBe(true);
    expect(before?.audit.some((entry) => entry.op === "deleteRepo")).toBe(false);
    expect(logger.events.some((event) => event.component === "github")).toBe(false);
    expect(logger.events.some((event) => event.component === "vault")).toBe(false);

    expect(await decide(config, "approve", authReqId)).toContain(`approved ${authReqId}`);
    const result = await running;
    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(result.message).toBe("deleted acme/widgets");
    const after = githubFile(dir);
    expect(after?.repos.some((repo) => repo.name === "widgets")).toBe(false);
    expect(after?.issues.some((issue) => issue.repository === "acme/widgets")).toBe(false);

    const messages = logger.events.map((event) => `${event.component}:${event.message}:${event.fields.result ?? ""}`);
    const pendingAt = messages.findIndex((line) => line.includes("authorization_pending"));
    const approvedAt = messages.findIndex((line) => line.includes("result:approved") || line.endsWith(":approved"));
    const vaultAt = messages.findIndex((line) => line.startsWith("vault:"));
    const deleteAt = messages.findIndex((line) => line.includes("DELETE /repos/acme/widgets"));
    expect(pendingAt).toBeGreaterThan(-1);
    expect(approvedAt).toBeGreaterThan(pendingAt);
    expect(vaultAt).toBeGreaterThan(approvedAt);
    expect(deleteAt).toBeGreaterThan(vaultAt);
    expect(logger.events.some((event) => event.fields.grant_type === "urn:openid:params:grant-type:ciba")).toBe(true);
    expect(
      logger.events.some(
        (event) =>
          event.fields.grant_type ===
          "urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token",
      ),
    ).toBe(true);
  });

  it("does not delete when the user denies the request", async () => {
    const { dir, logger, config } = setup();
    const running = runCommand("please delete the repo acme/widgets", { config, logger });
    await waitFor(() => hasResult(logger, "authorization_pending"), "authorization_pending");
    const authReqId = String(logger.events.find((event) => event.fields.auth_req_id)?.fields.auth_req_id);
    expect(await decide(config, "deny", authReqId)).toContain("denied");
    const result = await running;
    expect(result.status).toBe("denied");
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("was not executed");
    expect(githubFile(dir)?.repos.some((repo) => repo.name === "widgets")).toBe(true);
    expect(logger.events.some((event) => event.component === "github")).toBe(false);
    expect(hasResult(logger, "access_denied")).toBe(true);
  });

  it("does not archive when approval expires", async () => {
    const { dir, logger, config } = setup({ requestedExpirySec: 0.4, pollIntervalSec: 0.05 });
    const result = await runCommand("archive repo acme/notes", { config, logger });
    expect(result.status).toBe("expired");
    expect(result.exitCode).toBe(3);
    const notes = githubFile(dir)?.repos.find((repo) => repo.name === "notes");
    expect(notes?.archived).toBe(false);
    expect(logger.events.some((event) => event.message.includes("PATCH /repos/acme/notes"))).toBe(false);
  });

  it("closes only open issues after approval", async () => {
    const { dir, logger, config } = setup();
    const running = runCommand("close all issues in acme/widgets", { config, logger });
    await waitFor(() => hasResult(logger, "authorization_pending"), "authorization_pending");
    const authReqId = String(logger.events.find((event) => event.fields.auth_req_id)?.fields.auth_req_id);
    await decide(config, "approve", authReqId);
    const result = await running;
    expect(result.status).toBe("completed");
    expect(result.message).toContain("#1");
    expect(result.message).toContain("#2");
    const issues = githubFile(dir)?.issues.filter((issue) => issue.repository === "acme/widgets") ?? [];
    expect(issues.every((issue) => issue.state === "closed")).toBe(true);
    const notes = githubFile(dir)?.issues.find((issue) => issue.number === 7);
    expect(notes?.state).toBe("open");
  });

  it("archives after approval and leaves the repo in place when denied", async () => {
    const { dir, logger, config } = setup();
    const running = runCommand("archive the repository acme/notes", { config, logger });
    await waitFor(() => hasResult(logger, "authorization_pending"), "authorization_pending");
    const authReqId = String(logger.events.find((event) => event.fields.auth_req_id)?.fields.auth_req_id);
    await decide(config, "deny", authReqId);
    const denied = await running;
    expect(denied.status).toBe("denied");
    expect(githubFile(dir)?.repos.find((repo) => repo.name === "notes")?.archived).toBe(false);

    const logger2 = silentLogger();
    const again = runCommand("archive repo acme/notes", { config, logger: logger2 });
    await waitFor(() => hasResult(logger2, "authorization_pending"), "second authorization_pending");
    const secondId = String(logger2.events.find((event) => event.fields.auth_req_id)?.fields.auth_req_id);
    await decide(config, "approve", secondId);
    const approved = await again;
    expect(approved.status).toBe("completed");
    expect(approved.message).toBe("archived acme/notes");
    expect(githubFile(dir)?.repos.find((repo) => repo.name === "notes")?.archived).toBe(true);
  });

  it("returns a usage error for an unknown command", async () => {
    const { logger, config } = setup();
    const result = await runCommand("rename repo acme/widgets", { config, logger });
    expect(result.status).toBe("error");
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("Could not understand");
    expect(logger.events.some((event) => event.component === "github")).toBe(false);
  });
});
