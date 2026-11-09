/** CIBA grant used when polling Auth0's /oauth/token with an auth_req_id. */
export const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";

/** Token Vault federated connection exchange, same grant TokenVaultAuthorizerBase sends. */
export const TOKEN_VAULT_GRANT_TYPE =
  "urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token";

export const FEDERATED_ACCESS_TOKEN_TYPE =
  "http://auth0.com/oauth/token-type/federated-connection-access-token";

export class OAuthError extends Error {
  readonly name = "OAuthError";

  constructor(
    readonly error: string,
    description: string,
    readonly retryAfter?: number,
  ) {
    super(description);
    this.name = "OAuthError";
  }
}
