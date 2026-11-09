import type { AppConfig } from "../config.js";
import { CIBA_GRANT_TYPE, OAuthError } from "../oauth.js";
import { loginHint, type CibaAuthorizeResponse, type CibaTokenResponse, type CibaTransport } from "./transport.js";

export function createHttpCibaTransport(baseUrl: string, config: AppConfig): CibaTransport {
  return {
    async authorize(request) {
      const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        login_hint: loginHint(request.userId, config.auth0Domain),
        binding_message: request.bindingMessage,
        scope: request.scope,
        requested_expiry: String(request.requestedExpiry),
      });
      if (request.audience) body.set("audience", request.audience);
      if (request.authorizationDetails) {
        body.set("authorization_details", JSON.stringify(request.authorizationDetails));
      }
      return postJson<CibaAuthorizeResponse>(baseUrl, "/bc-authorize", body);
    },
    async grant(authReqId) {
      const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId,
      });
      return postJson<CibaTokenResponse>(baseUrl, "/oauth/token", body);
    },
  };
}

async function postJson<T>(baseUrl: string, pathname: string, body: URLSearchParams): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new OAuthError("server_error", `CIBA request to ${pathname} failed: ${message}`);
  }
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const retry = response.headers.get("retry-after");
    const retryAfter = retry === null ? undefined : Number(retry);
    throw new OAuthError(
      String(payload.error ?? "server_error"),
      String(payload.error_description ?? response.statusText),
      Number.isFinite(retryAfter) ? retryAfter : undefined,
    );
  }
  return payload as T;
}
