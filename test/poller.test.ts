import { describe, expect, it } from "vitest";
import { AccessDeniedInterrupt, AuthorizationRequestExpiredInterrupt } from "@auth0/ai/interrupts";

import { testConfig, tempStateDir } from "./helpers.js";
import { silentLogger } from "./helpers.js";
import { pollForApproval } from "../src/ciba/poller.js";
import { OAuthError } from "../src/oauth.js";
import type { CibaTransport } from "../src/ciba/transport.js";

describe("CIBA poller", () => {
  const action = { type: "delete_repo" as const, repository: "acme/widgets" };

  it("waits through pending and slow_down until approval", async () => {
    const calls: string[] = [];
    let step = 0;
    const transport: CibaTransport = {
      async authorize() {
        return { auth_req_id: "ciba_scripted", expires_in: 30, interval: 1 };
      },
      async grant() {
        step += 1;
        calls.push(`grant-${step}`);
        if (step === 1) throw new OAuthError("authorization_pending", "pending");
        if (step === 2) throw new OAuthError("slow_down", "slow down", 4);
        return { access_token: "ciba-approved-token", expires_in: 60, scope: "openid" };
      },
    };
    const sleeps: number[] = [];
    const approval = await pollForApproval({
      transport,
      action,
      config: testConfig(tempStateDir()),
      logger: silentLogger(),
      deps: { sleep: async (ms) => void sleeps.push(ms), now: () => 0 },
    });
    expect(approval.accessToken).toBe("ciba-approved-token");
    expect(sleeps).toEqual([1000, 4000]);
    expect(calls).toEqual(["grant-1", "grant-2", "grant-3"]);
  });

  it("throws the SDK access-denied interrupt", async () => {
    const transport: CibaTransport = {
      async authorize() {
        return { auth_req_id: "ciba_denied", expires_in: 30, interval: 1 };
      },
      async grant() {
        throw new OAuthError("access_denied", "The end-user denied the authorization request");
      },
    };
    await expect(
      pollForApproval({
        transport,
        action,
        config: testConfig(tempStateDir()),
        logger: silentLogger(),
        deps: { sleep: async () => undefined, now: () => 0 },
      }),
    ).rejects.toBeInstanceOf(AccessDeniedInterrupt);
  });

  it("expires from the local clock without calling GitHub", async () => {
    let now = 0;
    const transport: CibaTransport = {
      async authorize() {
        return { auth_req_id: "ciba_expired", expires_in: 5, interval: 1 };
      },
      async grant() {
        throw new OAuthError("authorization_pending", "pending");
      },
    };
    await expect(
      pollForApproval({
        transport,
        action,
        config: testConfig(tempStateDir()),
        logger: silentLogger(),
        deps: {
          now: () => now,
          sleep: async (ms) => {
            now += ms;
          },
        },
      }),
    ).rejects.toBeInstanceOf(AuthorizationRequestExpiredInterrupt);
  });
});
