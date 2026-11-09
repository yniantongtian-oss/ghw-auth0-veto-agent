import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { CIBA_GRANT_TYPE } from "../oauth.js";

type RequestStatus = "pending" | "approved" | "denied" | "expired" | "consumed";

type PendingRequest = {
  authReqId: string;
  bindingMessage: string;
  scope: string;
  loginHint: string;
  expiresAtMs: number;
  intervalSec: number;
  status: RequestStatus;
  pollCount: number;
  lastPollAtMs: number;
  authorizationDetails?: string;
};

export type MockAuth0 = {
  baseUrl: string;
  port: number;
  close(): Promise<void>;
};

export async function startMockAuth0(options: {
  stateDir: string;
  pollIntervalSec: number;
}): Promise<MockAuth0> {
  const requests = new Map<string, PendingRequest>();
  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res, requests, options.pollIntervalSec);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send(res, 500, { error: "server_error", error_description: message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("mock Auth0 server did not bind a TCP port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  fs.mkdirSync(options.stateDir, { recursive: true });
  const infoPath = path.join(options.stateDir, "server.json");
  fs.writeFileSync(infoPath, JSON.stringify({ baseUrl, port: address.port }, null, 2));

  return {
    baseUrl,
    port: address.port,
    async close() {
      const current = readServerInfo(options.stateDir);
      if (current?.port === address.port) fs.rmSync(infoPath, { force: true });
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

export function readServerInfo(stateDir: string): { baseUrl: string; port: number } | undefined {
  const infoPath = path.join(stateDir, "server.json");
  if (!fs.existsSync(infoPath)) return undefined;
  return JSON.parse(fs.readFileSync(infoPath, "utf8")) as { baseUrl: string; port: number };
}

async function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requests: Map<string, PendingRequest>,
  pollIntervalSec: number,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const raw = await readBody(req);
  if (req.method === "POST" && url.pathname === "/bc-authorize") {
    const form = new URLSearchParams(raw);
    const missing = ["client_id", "binding_message", "login_hint", "scope"].filter(
      (key) => !form.get(key),
    );
    if (missing.length > 0) {
      send(res, 400, {
        error: "invalid_request",
        error_description: `missing ${missing.join(", ")}`,
      });
      return;
    }
    const expiresIn = Number(form.get("requested_expiry") ?? "300");
    const authReqId = `ciba_${randomBytes(8).toString("hex")}`;
    requests.set(authReqId, {
      authReqId,
      bindingMessage: form.get("binding_message") ?? "",
      scope: form.get("scope") ?? "",
      loginHint: form.get("login_hint") ?? "",
      expiresAtMs: Date.now() + expiresIn * 1000,
      intervalSec: pollIntervalSec,
      status: "pending",
      pollCount: 0,
      lastPollAtMs: 0,
      authorizationDetails: form.get("authorization_details") ?? undefined,
    });
    send(res, 200, {
      auth_req_id: authReqId,
      expires_in: expiresIn,
      interval: pollIntervalSec,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/oauth/token") {
    const params = parseTokenBody(req, raw);
    if (params.grant_type !== CIBA_GRANT_TYPE) {
      send(res, 400, {
        error: "unsupported_grant_type",
        error_description: "mock Auth0 only accepts the CIBA grant on this server",
      });
      return;
    }
    const authReqId = params.auth_req_id;
    if (!authReqId) {
      send(res, 400, { error: "invalid_request", error_description: "missing auth_req_id" });
      return;
    }
    const record = requests.get(authReqId);
    if (!record) {
      send(res, 400, { error: "invalid_grant", error_description: "unknown auth_req_id" });
      return;
    }
    if (Date.now() >= record.expiresAtMs && record.status === "pending") {
      record.status = "expired";
    }
    record.pollCount += 1;
    record.lastPollAtMs = Date.now();
    if (record.status === "pending") {
      send(res, 400, {
        error: "authorization_pending",
        error_description: "The end-user authorization is pending",
      });
      return;
    }
    if (record.status === "denied") {
      send(res, 403, {
        error: "access_denied",
        error_description: "The end-user denied the authorization request",
      });
      return;
    }
    if (record.status === "expired") {
      send(res, 400, {
        error: "expired_token",
        error_description: "The authorization request has expired",
      });
      return;
    }
    if (record.status === "consumed") {
      send(res, 400, {
        error: "invalid_grant",
        error_description: "auth_req_id has already been used",
      });
      return;
    }
    record.status = "consumed";
    send(res, 200, {
      access_token: `ciba_approved_${authReqId}`,
      id_token: "mock-id-token",
      token_type: "Bearer",
      expires_in: 86400,
      scope: record.scope,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/mock/pending") {
    const now = Date.now();
    send(res, 200, {
      requests: [...requests.values()]
        .filter((record) => record.status === "pending" && now < record.expiresAtMs)
        .map(publicRequest),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/mock/decision") {
    const body = JSON.parse(raw) as { auth_req_id?: string; decision?: string };
    const record = body.auth_req_id ? requests.get(body.auth_req_id) : undefined;
    if (!record) {
      send(res, 404, { error: "not_found", error_description: "unknown auth_req_id" });
      return;
    }
    if (record.status !== "pending") {
      send(res, 409, {
        error: "invalid_request",
        error_description: `request is already ${record.status}`,
        status: record.status,
      });
      return;
    }
    if (body.decision !== "approve" && body.decision !== "deny") {
      send(res, 400, {
        error: "invalid_request",
        error_description: "decision must be approve or deny",
      });
      return;
    }
    record.status = body.decision === "approve" ? "approved" : "denied";
    send(res, 200, {
      auth_req_id: record.authReqId,
      status: record.status,
      binding_message: record.bindingMessage,
    });
    return;
  }

  send(res, 404, { error: "not_found", error_description: "unknown mock Auth0 route" });
}

function publicRequest(record: PendingRequest) {
  return {
    auth_req_id: record.authReqId,
    binding_message: record.bindingMessage,
    status: record.status,
    expires_in: Math.max(0, Math.ceil((record.expiresAtMs - Date.now()) / 1000)),
    interval: record.intervalSec,
    login_hint: record.loginHint,
    authorization_details: record.authorizationDetails,
  };
}

function parseTokenBody(req: http.IncomingMessage, raw: string): Record<string, string> {
  const contentType = req.headers["content-type"] ?? "";
  if (contentType.includes("application/json")) {
    const json = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(json).map(([key, value]) => [key, String(value)]));
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown, extraHeaders: http.OutgoingHttpHeaders = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}
