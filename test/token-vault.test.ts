import { SUBJECT_TOKEN_TYPES } from "@auth0/ai";
import { describe, expect, it } from "vitest";

import { testConfig, tempStateDir, silentLogger } from "./helpers.js";
import { readJson } from "../src/json-file.js";
import { FEDERATED_ACCESS_TOKEN_TYPE, TOKEN_VAULT_GRANT_TYPE } from "../src/oauth.js";
import { Auth0TokenVault, MockTokenVault, buildFederatedExchangeBody } from "../src/vault/token-vault.js";

describe("Token Vault exchange", () => {
  it("builds the federated connection grant", () => {
    const body = buildFederatedExchangeBody(
      testConfig(tempStateDir(), { refreshToken: "refresh-token-value", githubConnection: "github" }),
    );
    expect(body.grant_type).toBe(TOKEN_VAULT_GRANT_TYPE);
    expect(body.grant_type).toBe(
      "urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token",
    );
    expect(body.subject_token_type).toBe(SUBJECT_TOKEN_TYPES.SUBJECT_TYPE_REFRESH_TOKEN);
    expect(body.requested_token_type).toBe(FEDERATED_ACCESS_TOKEN_TYPE);
    expect(body.connection).toBe("github");
    expect(body.subject_token).toBe("refresh-token-value");
  });

  it("posts the exchange to the tenant and does not log the refresh token", async () => {
    const config = testConfig(tempStateDir(), {
      mockGithub: false,
      refreshToken: "super-secret-refresh",
      clientSecret: "super-secret-client",
    });
    const logger = silentLogger();
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(url).toBe("https://dev-wvxvhbnjrgvgn26x.us.auth0.com/oauth/token");
      expect(body.subject_token).toBe("super-secret-refresh");
      expect(body.client_secret).toBe("super-secret-client");
      return new Response(
        JSON.stringify({
          access_token: "gho_live_token",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "repo",
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const token = await new Auth0TokenVault(config, logger, fetchImpl).getGitHubAccessToken();
    expect(token.accessToken).toBe("gho_live_token");
    const rendered = JSON.stringify(logger.events);
    expect(rendered).not.toContain("super-secret-refresh");
    expect(rendered).not.toContain("super-secret-client");
    expect(rendered).toContain("gho_live…");
  });

  it("stores a mock GitHub token for the connected account", async () => {
    const dir = tempStateDir();
    const token = await new MockTokenVault(testConfig(dir), silentLogger()).getGitHubAccessToken();
    expect(token.accessToken).toBe("gho_mock_veto_agent");
    const stored = readJson<{ accessToken: string; connection: string }>(dir, "token-vault.json");
    expect(stored).toMatchObject({ accessToken: "gho_mock_veto_agent", connection: "github" });
  });
});
