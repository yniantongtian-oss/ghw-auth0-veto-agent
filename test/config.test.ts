import { describe, expect, it } from "vitest";

import { cibaChannel, loadConfig } from "../src/config.js";

describe("config", () => {
  it("defaults to the challenge tenant and mock placeholders", () => {
    const config = loadConfig({ MOCK_CIBA: "1", MOCK_GITHUB: "1" });
    expect(config.auth0Domain).toBe("dev-wvxvhbnjrgvgn26x.us.auth0.com");
    expect(config.userId).toBe("auth0|demo-user");
    expect(config.refreshToken).toBe("mock-refresh-token");
    expect(config.clientSecret).toBe("mock-client-secret");
  });

  it("requires real credentials when mocks are off", () => {
    expect(() => loadConfig({ MOCK_CIBA: "0", MOCK_GITHUB: "0" })).toThrow(/AUTH0_CLIENT_ID/);
    const config = loadConfig({
      MOCK_CIBA: "0",
      MOCK_GITHUB: "0",
      AUTH0_CLIENT_ID: "client",
      AUTH0_CLIENT_SECRET: "secret",
      AUTH0_USER_ID: "auth0|live",
      AUTH0_REFRESH_TOKEN: "refresh",
    });
    expect(config.userId).toBe("auth0|live");
    expect(config.refreshToken).toBe("refresh");
  });

  it("selects Guardian push or email from requested expiry", () => {
    expect(cibaChannel(120)).toBe("guardian-push");
    expect(cibaChannel(300)).toBe("guardian-push");
    expect(cibaChannel(301)).toBe("email");
  });
});
