import type { AppConfig } from "./config.js";
import { readServerInfo } from "./ciba/mock-server.js";

export async function pending(config: AppConfig): Promise<string[]> {
  const baseUrl = await requireServer(config);
  const response = await fetch(`${baseUrl}/mock/pending`);
  const body = (await response.json()) as {
    requests?: Array<{ auth_req_id: string; binding_message: string; expires_in: number }>;
  };
  const requests = body.requests ?? [];
  if (requests.length === 0) return ["no pending CIBA requests"];
  return requests.map(
    (request) =>
      `${request.auth_req_id}  ${request.binding_message}  expires_in=${request.expires_in}s`,
  );
}

export async function decide(
  config: AppConfig,
  decision: "approve" | "deny",
  authReqId: string,
): Promise<string> {
  if (!config.mockCiba) {
    throw new Error(
      "Live CIBA approval happens in Auth0 Guardian or the CIBA email. `veto approve` and `veto deny` only resolve MOCK_CIBA requests.",
    );
  }
  const baseUrl = await requireServer(config);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/mock/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth_req_id: authReqId, decision }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`mock CIBA server is not reachable: ${message}`);
  }
  const body = (await response.json()) as {
    error_description?: string;
    binding_message?: string;
    status?: string;
  };
  if (!response.ok) {
    throw new Error(body.error_description ?? `decision failed (${response.status})`);
  }
  const verb = decision === "approve" ? "approved" : "denied";
  return `${verb} ${authReqId}${body.binding_message ? `  ${body.binding_message}` : ""}`;
}

async function requireServer(config: AppConfig): Promise<string> {
  const info = readServerInfo(config.stateDir);
  if (!info) {
    throw new Error(
      "No mock CIBA server is waiting. Start a high-impact command with MOCK_CIBA=1 first.",
    );
  }
  return info.baseUrl;
}
