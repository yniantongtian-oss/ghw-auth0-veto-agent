import { SUBJECT_TOKEN_TYPES } from "@auth0/ai";

import type { AppConfig } from "../config.js";
import { updateJson } from "../json-file.js";
import { Logger, redactSecret } from "../log.js";
import { FEDERATED_ACCESS_TOKEN_TYPE, TOKEN_VAULT_GRANT_TYPE } from "../oauth.js";

export type VaultToken = {
  accessToken: string;
  expiresIn: number;
  scope: string;
  tokenType: string;
};

export type FederatedExchangeBody = {
  client_id: string;
  client_secret: string;
  grant_type: string;
  subject_token_type: string;
  subject_token: string;
  requested_token_type: string;
  connection: string;
};

const MOCK_GITHUB_TOKEN = "gho_mock_veto_agent";

export function buildFederatedExchangeBody(config: AppConfig): FederatedExchangeBody {
  return {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: TOKEN_VAULT_GRANT_TYPE,
    subject_token_type: SUBJECT_TOKEN_TYPES.SUBJECT_TYPE_REFRESH_TOKEN,
    subject_token: config.refreshToken,
    requested_token_type: FEDERATED_ACCESS_TOKEN_TYPE,
    connection: config.githubConnection,
  };
}

export interface TokenVault {
  getGitHubAccessToken(): Promise<VaultToken>;
}

export function createTokenVault(
  config: AppConfig,
  logger: Logger,
  fetchImpl: typeof fetch = fetch,
): TokenVault {
  return config.mockGithub
    ? new MockTokenVault(config, logger)
    : new Auth0TokenVault(config, logger, fetchImpl);
}

export class Auth0TokenVault implements TokenVault {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getGitHubAccessToken(): Promise<VaultToken> {
    const body = buildFederatedExchangeBody(this.config);
    const url = `https://${this.config.auth0Domain}/oauth/token`;
    this.logger.log("vault", "POST /oauth/token", {
      grant_type: body.grant_type,
      subject_token_type: body.subject_token_type,
      requested_token_type: body.requested_token_type,
      connection: body.connection,
    });
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok || typeof payload.access_token !== "string") {
      const description =
        typeof payload.error_description === "string"
          ? payload.error_description
          : text || response.statusText;
      throw new Error(`Token Vault exchange failed (${response.status}): ${description}`);
    }
    const token: VaultToken = {
      accessToken: payload.access_token,
      expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : 3600,
      scope: typeof payload.scope === "string" ? payload.scope : "",
      tokenType: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
    };
    this.logger.log("vault", "stored GitHub access token from Token Vault", {
      connection: body.connection,
      expires_in: token.expiresIn,
      token: redactSecret(token.accessToken),
    });
    return token;
  }
}

type VaultFile = {
  connection: string;
  accessToken: string;
  storedAt: string;
};

export class MockTokenVault implements TokenVault {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async getGitHubAccessToken(): Promise<VaultToken> {
    const body = buildFederatedExchangeBody(this.config);
    if (!body.subject_token) {
      throw new Error("Token Vault exchange requires an Auth0 refresh token");
    }
    if (body.connection !== "github") {
      throw new Error(`mock Token Vault has no connected account for ${body.connection}`);
    }
    this.logger.log("vault", "POST /oauth/token", {
      grant_type: body.grant_type,
      subject_token_type: body.subject_token_type,
      requested_token_type: body.requested_token_type,
      connection: body.connection,
      mock: true,
    });
    updateJson<VaultFile>(
      this.config.stateDir,
      "token-vault.json",
      () => ({
        connection: "github",
        accessToken: MOCK_GITHUB_TOKEN,
        storedAt: new Date().toISOString(),
      }),
      (current) => {
        current.connection = "github";
        current.accessToken = MOCK_GITHUB_TOKEN;
        current.storedAt = new Date().toISOString();
      },
    );
    const token: VaultToken = {
      accessToken: MOCK_GITHUB_TOKEN,
      expiresIn: 3600,
      scope: "repo delete_repo",
      tokenType: "Bearer",
    };
    this.logger.log("vault", "stored GitHub access token from Token Vault", {
      connection: "github",
      expires_in: token.expiresIn,
      token: redactSecret(token.accessToken),
      mock: true,
    });
    return token;
  }
}
