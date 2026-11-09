import type { AsyncAuthorizationRequest } from "@auth0/ai/AsyncAuthorization";
import {
  AccessDeniedInterrupt,
  AuthorizationPendingInterrupt,
  AuthorizationPollingInterrupt,
  AuthorizationRequestExpiredInterrupt,
  InvalidGrantInterrupt,
  UserDoesNotHavePushNotificationsInterrupt,
} from "@auth0/ai/interrupts";

import { cibaChannel, type AppConfig } from "../config.js";
import { Logger, redactSecret } from "../log.js";
import { CIBA_GRANT_TYPE, OAuthError } from "../oauth.js";
import { describeAction, type Action } from "../types.js";
import { authorizationDetails, bindingMessage } from "./binding.js";
import type { CibaTransport } from "./transport.js";

export type Approval = {
  request: AsyncAuthorizationRequest;
  accessToken: string;
};

export type PollDeps = {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/**
 * Blocking CIBA poll. This follows AsyncAuthorizerBase.getCredentialsPolling
 * in @auth0/ai: an authorization_pending or slow_down response waits for the
 * interval (or Retry-After) and tries /oauth/token again. access_denied,
 * expired_token, and invalid_grant stop the agent with the SDK interrupt.
 */
export async function pollForApproval(options: {
  transport: CibaTransport;
  action: Action;
  config: AppConfig;
  logger: Logger;
  deps?: PollDeps;
}): Promise<Approval> {
  const { transport, action, config, logger } = options;
  const sleep = options.deps?.sleep ?? defaultSleep;
  const now = options.deps?.now ?? Date.now;
  const binding = bindingMessage(action);
  const channel = cibaChannel(config.requestedExpirySec);
  const details = authorizationDetails(action);

  logger.log("ciba", "POST /bc-authorize", {
    binding_message: binding,
    scope: ensureOpenId(config.cibaScope),
    requested_expiry: config.requestedExpirySec,
    channel,
  });

  const started = await transport.authorize({
    userId: config.userId,
    bindingMessage: binding,
    scope: ensureOpenId(config.cibaScope),
    audience: config.audience || undefined,
    requestedExpiry: config.requestedExpirySec,
    authorizationDetails: config.mockCiba || config.useRar ? details : undefined,
  });

  const request: AsyncAuthorizationRequest = {
    id: started.auth_req_id,
    requestedAt: now() / 1000,
    expiresIn: started.expires_in,
    interval: started.interval > 0 ? started.interval : config.pollIntervalSec,
  };

  logger.log("ciba", "authorization request issued", {
    auth_req_id: request.id,
    interval: request.interval,
    expires_in: request.expiresIn,
  });
  logger.log("ciba", "HALTED waiting for out-of-band approval", {
    auth_req_id: request.id,
    binding_message: binding,
    channel,
    github_called: false,
    action: describeAction(action),
  });
  if (config.mockCiba) {
    logger.log("ciba", "approve out of band in another terminal", {
      command: `npm run veto -- approve ${request.id}`,
    });
  } else {
    logger.log("ciba", "approve on the Auth0 Guardian device or the CIBA email", {
      auth_req_id: request.id,
      channel,
    });
  }

  while (true) {
    const elapsed = now() / 1000 - request.requestedAt;
    if (elapsed >= request.expiresIn) {
      throw new AuthorizationRequestExpiredInterrupt(
        "The authorization request has expired.",
        request,
      );
    }

    try {
      const token = await transport.grant(request.id);
      if (!token.access_token) {
        throw new Error("CIBA approval returned an empty access token");
      }
      logger.log("ciba", "POST /oauth/token", {
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: request.id,
        result: "approved",
        ciba_token: redactSecret(token.access_token),
      });
      return { request, accessToken: token.access_token };
    } catch (err) {
      if (!(err instanceof OAuthError)) throw err;
      logger.log("ciba", "POST /oauth/token", {
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: request.id,
        result: err.error,
      });

      if (err.error === "authorization_pending") {
        const interrupt = new AuthorizationPendingInterrupt(err.message, request);
        await sleep(interrupt.nextRetryInterval() * 1000);
        continue;
      }
      if (err.error === "slow_down") {
        const retryAfter = Number.isFinite(err.retryAfter)
          ? Number(err.retryAfter)
          : request.interval + 5;
        request.interval = retryAfter;
        const interrupt = new AuthorizationPollingInterrupt(err.message, request, retryAfter);
        await sleep(interrupt.nextRetryInterval() * 1000);
        continue;
      }
      if (err.error === "access_denied") {
        throw new AccessDeniedInterrupt(err.message, request);
      }
      if (err.error === "expired_token") {
        throw new AuthorizationRequestExpiredInterrupt(err.message, request);
      }
      if (err.error === "invalid_grant") {
        throw new InvalidGrantInterrupt(err.message, request);
      }
      if (err.error === "invalid_request") {
        throw new UserDoesNotHavePushNotificationsInterrupt(err.message);
      }
      throw err;
    }
  }
}

function ensureOpenId(scope: string): string {
  const parts = scope.split(/\s+/).filter(Boolean);
  return parts.includes("openid") ? parts.join(" ") : ["openid", ...parts].join(" ");
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
