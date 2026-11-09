import { AuthApiError, AuthenticationClient } from "auth0";

import type { AppConfig } from "../config.js";
import { OAuthError } from "../oauth.js";
import type { CibaTransport } from "./transport.js";

export type BackchannelClient = {
  backchannel: {
    authorize(options: {
      userId: string;
      binding_message: string;
      scope: string;
      audience?: string;
      requested_expiry?: string;
      authorization_details?: string;
    }): Promise<{ auth_req_id: string; expires_in: number; interval: number }>;
    backchannelGrant(options: { auth_req_id: string }): Promise<{
      access_token: string;
      id_token: string;
      token_type?: string;
      expires_in: number;
      scope: string;
    }>;
  };
};

/**
 * Live CIBA transport. AuthenticationClient.backchannel is the same client
 * @auth0/ai AsyncAuthorizerBase uses to call /bc-authorize and /oauth/token.
 */
export function createAuth0CibaTransport(
  config: AppConfig,
  client: BackchannelClient = new AuthenticationClient({
    domain: config.auth0Domain,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  }),
): CibaTransport {
  return {
    async authorize(request) {
      const response = await client.backchannel.authorize({
        userId: request.userId,
        binding_message: request.bindingMessage,
        scope: request.scope,
        audience: request.audience,
        requested_expiry: String(request.requestedExpiry),
        ...(request.authorizationDetails
          ? { authorization_details: JSON.stringify(request.authorizationDetails) }
          : {}),
      });
      return response;
    },
    async grant(authReqId) {
      try {
        return await client.backchannel.backchannelGrant({ auth_req_id: authReqId });
      } catch (err) {
        throw asOAuthError(err);
      }
    },
  };
}

export function asOAuthError(err: unknown): unknown {
  if (err instanceof OAuthError) return err;
  if (err instanceof AuthApiError) {
    const retry = err.headers?.get("retry-after");
    const retryAfter = retry === null || retry === undefined ? undefined : Number(retry);
    return new OAuthError(
      err.error,
      err.error_description || err.message,
      Number.isFinite(retryAfter) ? retryAfter : undefined,
    );
  }
  return err;
}
