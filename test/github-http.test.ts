import http from "node:http";
import { describe, expect, it } from "vitest";

import { HttpGitHub } from "../src/github/http-github.js";
import { silentLogger } from "./helpers.js";

describe("GitHub HTTP client", () => {
  it("sends the bearer token and the mutation methods", async () => {
    const seen: Array<{ method: string; path: string; authorization: string; body?: string }> = [];
    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      seen.push({
        method: req.method ?? "",
        path: req.url ?? "",
        authorization: String(req.headers.authorization),
        body: Buffer.concat(chunks).toString("utf8"),
      });
      if (req.method === "DELETE") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.url?.startsWith("/user/repos")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify([
            {
              name: "widgets",
              full_name: "acme/widgets",
              private: false,
              archived: false,
              description: "widgets",
              open_issues_count: 1,
              owner: { login: "acme" },
            },
          ]),
        );
        return;
      }
      if (req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify([
            { number: 1, title: "Fix login", state: "open" },
            { number: 2, title: "A pull request", state: "open", pull_request: { url: "x" } },
          ]),
        );
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ archived: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const github = new HttpGitHub("gho_test_token", `http://127.0.0.1:${address.port}`, silentLogger());
    try {
      const repos = await github.listRepos();
      const issues = await github.listOpenIssues("acme/widgets");
      await github.deleteRepo("acme/widgets");
      await github.archiveRepo("acme/notes");
      expect(repos.map((repo) => repo.fullName)).toEqual(["acme/widgets"]);
      expect(issues.map((issue) => issue.number)).toEqual([1]);
      expect(seen.map((call) => `${call.method} ${call.path.split("?")[0]}`)).toEqual([
        "GET /user/repos",
        "GET /repos/acme/widgets/issues",
        "DELETE /repos/acme/widgets",
        "PATCH /repos/acme/notes",
      ]);
      expect(new Set(seen.map((call) => call.authorization))).toEqual(new Set(["Bearer gho_test_token"]));
      expect(seen.at(-1)?.body).toBe(JSON.stringify({ archived: true }));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
