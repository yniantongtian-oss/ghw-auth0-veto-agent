import { describe, expect, it } from "vitest";

import { createHttpCibaTransport } from "../src/ciba/http-transport.js";
import { startMockAuth0 } from "../src/ciba/mock-server.js";
import { CIBA_GRANT_TYPE, OAuthError } from "../src/oauth.js";
import { testConfig, tempStateDir } from "./helpers.js";

describe("mock Auth0 CIBA server", () => {
  it("polls /oauth/token until an out-of-band decision", async () => {
    const dir = tempStateDir();
    const config = testConfig(dir);
    const server = await startMockAuth0({ stateDir: dir, pollIntervalSec: 0.05 });
    try {
      const transport = createHttpCibaTransport(server.baseUrl, config);
      const started = await transport.authorize({
        userId: config.userId,
        bindingMessage: "Veto delete_repo acme:widgets",
        scope: "openid github:mutate",
        audience: config.audience,
        requestedExpiry: 30,
        authorizationDetails: [{ type: "github_repo_mutation", action: "delete_repo", repository: "acme/widgets" }],
      });
      await expect(transport.grant(started.auth_req_id)).rejects.toMatchObject({
        error: "authorization_pending",
      });
      const decision = await fetch(`${server.baseUrl}/mock/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auth_req_id: started.auth_req_id, decision: "approve" }),
      });
      expect(decision.status).toBe(200);
      const token = await transport.grant(started.auth_req_id);
      expect(token.access_token).toContain(started.auth_req_id);
      await expect(transport.grant(started.auth_req_id)).rejects.toBeInstanceOf(OAuthError);
    } finally {
      await server.close();
    }
  });

  it("rejects a token poll that is not the CIBA grant", async () => {
    const dir = tempStateDir();
    const server = await startMockAuth0({ stateDir: dir, pollIntervalSec: 1 });
    try {
      const response = await fetch(`${server.baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials" }),
      });
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("unsupported_grant_type");
      expect(CIBA_GRANT_TYPE).toBe("urn:openid:params:grant-type:ciba");
    } finally {
      await server.close();
    }
  });
});
