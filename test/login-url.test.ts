import { describe, expect, it } from "vitest";

import { buildAuthorizeUrl, createPkce } from "../src/login.js";
import { testConfig, tempStateDir } from "./helpers.js";

describe("login url", () => {
  it("requests an offline-access code with PKCE against the tenant", () => {
    const pkce = createPkce();
    const url = new URL(buildAuthorizeUrl(testConfig(tempStateDir()), pkce));
    expect(url.origin).toBe("https://dev-wvxvhbnjrgvgn26x.us.auth0.com");
    expect(url.pathname).toBe("/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("code_challenge")).toBe(pkce.challenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("audience")).toBe("https://veto-agent.example/github");
  });
});
