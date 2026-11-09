import { AuthApiError } from "auth0";
import { describe, expect, it } from "vitest";

import { asOAuthError, createAuth0CibaTransport, type BackchannelClient } from "../src/ciba/auth0-transport.js";
import { OAuthError } from "../src/oauth.js";
import { testConfig, tempStateDir } from "./helpers.js";

describe("Auth0 CIBA transport", () => {
  it("maps AuthApiError retry-after into an OAuth error", () => {
    const err = new AuthApiError(
      "slow_down",
      "You are polling faster than allowed",
      429,
      "{}",
      new Headers({ "retry-after": "4" }),
    );
    const mapped = asOAuthError(err);
    expect(mapped).toBeInstanceOf(OAuthError);
    expect((mapped as OAuthError).error).toBe("slow_down");
    expect((mapped as OAuthError).retryAfter).toBe(4);
  });

  it("calls AuthenticationClient backchannel authorize and grant", async () => {
    const authorize = async (options: { userId: string; binding_message: string; scope: string; requested_expiry?: string }) => {
      expect(options.userId).toBe("auth0|demo-user");
      expect(options.binding_message).toBe("Veto delete_repo acme:widgets");
      expect(options.scope).toContain("openid");
      expect(options.requested_expiry).toBe("20");
      return { auth_req_id: "ciba_live", expires_in: 20, interval: 5 };
    };
    const backchannelGrant = async () => {
      throw new AuthApiError("authorization_pending", "pending", 400, "{}", new Headers());
    };
    const client = { backchannel: { authorize, backchannelGrant } } as BackchannelClient;
    const transport = createAuth0CibaTransport(testConfig(tempStateDir(), { mockCiba: false }), client);
    const started = await transport.authorize({
      userId: "auth0|demo-user",
      bindingMessage: "Veto delete_repo acme:widgets",
      scope: "openid github:mutate",
      audience: "https://veto-agent.example/github",
      requestedExpiry: 20,
    });
    expect(started.auth_req_id).toBe("ciba_live");
    await expect(transport.grant("ciba_live")).rejects.toMatchObject({ error: "authorization_pending" });
  });
});
