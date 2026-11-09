import { createHash, randomBytes } from "node:crypto";
import http from "node:http";

import type { AppConfig } from "./config.js";

export function buildAuthorizeUrl(config: AppConfig, pkce: { challenge: string; state: string }): string {
  const url = new URL(`https://${config.auth0Domain}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", "openid profile email offline_access");
  url.searchParams.set("audience", config.audience);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", pkce.state);
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export function createPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  return { verifier, challenge, state };
}

export async function login(config: AppConfig): Promise<void> {
  if (config.clientId === "mock-client-id" || config.clientSecret === "mock-client-secret") {
    throw new Error("Set AUTH0_CLIENT_ID and AUTH0_CLIENT_SECRET before running veto login.");
  }
  const redirect = new URL(config.redirectUri);
  const pkce = createPkce();
  const authorizeUrl = buildAuthorizeUrl(config, pkce);
  console.log("Open this URL and sign in as the approving user:\n");
  console.log(authorizeUrl);
  console.log(`\nWaiting for ${config.redirectUri}`);

  const code = await waitForCode(redirect, pkce.state);
  const tokens = await exchangeCode(config, code, pkce.verifier);
  const sub = readSub(tokens.id_token);
  console.log("\nAdd these to .env, then connect GitHub through Token Vault if you have not already:");
  console.log(`AUTH0_USER_ID=${sub}`);
  console.log(`AUTH0_REFRESH_TOKEN=${tokens.refresh_token}`);
}

async function waitForCode(redirect: URL, expectedState: string): Promise<string> {
  const port = Number(redirect.port || (redirect.protocol === "https:" ? 443 : 80));
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", redirect.origin);
      if (url.pathname !== redirect.pathname) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (error || !code || state !== expectedState) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end(error ?? "login did not return a matching authorization code");
        finish(() => reject(new Error(error ?? "login callback was missing a valid code")));
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("Signed in. You can close this tab and return to the terminal.");
      finish(() => resolve(code));
    });
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      callback();
    };
    timer = setTimeout(() => {
      finish(() => reject(new Error("timed out waiting for the Auth0 login callback")));
    }, 180_000);
    timer.unref();
    server.listen(port, "127.0.0.1");
  });
}

async function exchangeCode(
  config: AppConfig,
  code: string,
  verifier: string,
): Promise<{ refresh_token: string; id_token: string }> {
  const response = await fetch(`https://${config.auth0Domain}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    }),
  });
  const body = (await response.json()) as {
    refresh_token?: string;
    id_token?: string;
    error_description?: string;
  };
  if (!response.ok || !body.refresh_token || !body.id_token) {
    throw new Error(
      body.error_description ??
        "Auth0 did not return a refresh token. Enable offline_access and Allow Offline Access on the API.",
    );
  }
  return { refresh_token: body.refresh_token, id_token: body.id_token };
}

function readSub(idToken: string): string {
  const segment = idToken.split(".")[1];
  if (!segment) throw new Error("id_token did not include a payload");
  const payload = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as { sub?: string };
  if (!payload.sub) throw new Error("id_token payload did not include sub");
  return payload.sub;
}
