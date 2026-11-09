import path from "node:path";

export type AppConfig = {
  auth0Domain: string;
  clientId: string;
  clientSecret: string;
  audience: string;
  cibaScope: string;
  userId: string;
  refreshToken: string;
  githubConnection: string;
  requestedExpirySec: number;
  useRar: boolean;
  mockCiba: boolean;
  mockGithub: boolean;
  stateDir: string;
  pollIntervalSec: number;
  githubApiBase: string;
  redirectUri: string;
};

const DEFAULT_DOMAIN = "dev-wvxvhbnjrgvgn26x.us.auth0.com";
const PLACEHOLDER_MARKERS = [
  "your-client-id",
  "your-client-secret",
  "your-auth0-refresh-token",
  "your-user-id",
];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mockCiba = flag(env.MOCK_CIBA);
  const mockGithub = flag(env.MOCK_GITHUB);
  const requestedExpirySec = numberOr(env.CIBA_REQUESTED_EXPIRY, 120);
  const pollIntervalSec = numberOr(env.CIBA_POLL_INTERVAL_SEC, mockCiba ? 0.5 : 5);

  if (requestedExpirySec <= 0 || requestedExpirySec > 259200) {
    throw new Error("CIBA_REQUESTED_EXPIRY must be between 0 and 259200 seconds");
  }
  if (!mockCiba && requestedExpirySec < 1) {
    throw new Error("CIBA_REQUESTED_EXPIRY must be at least 1 second when MOCK_CIBA is off");
  }
  if (pollIntervalSec <= 0) {
    throw new Error("CIBA_POLL_INTERVAL_SEC must be greater than 0");
  }

  const clientId = env.AUTH0_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.AUTH0_CLIENT_SECRET?.trim() ?? "";
  const userId = env.AUTH0_USER_ID?.trim() ?? "";
  const refreshToken = env.AUTH0_REFRESH_TOKEN?.trim() ?? "";
  const missing: string[] = [];
  if (!mockCiba) {
    if (isPlaceholder(clientId)) missing.push("AUTH0_CLIENT_ID");
    if (isPlaceholder(clientSecret)) missing.push("AUTH0_CLIENT_SECRET");
    if (isPlaceholder(userId)) missing.push("AUTH0_USER_ID");
  }
  if (!mockGithub && isPlaceholder(refreshToken)) missing.push("AUTH0_REFRESH_TOKEN");
  if (missing.length > 0) {
    throw new Error(
      `Missing Auth0 configuration: ${missing.join(", ")}. Set them in .env, or run with MOCK_CIBA=1 and MOCK_GITHUB=1.`,
    );
  }

  return {
    auth0Domain: normalizeDomain(env.AUTH0_DOMAIN),
    clientId: isPlaceholder(clientId) ? "mock-client-id" : clientId,
    clientSecret: isPlaceholder(clientSecret) ? "mock-client-secret" : clientSecret,
    audience: env.AUTH0_AUDIENCE?.trim() || "https://veto-agent.example/github",
    cibaScope: env.AUTH0_CIBA_SCOPE?.trim() || "openid github:mutate",
    userId: isPlaceholder(userId) ? "auth0|demo-user" : userId,
    refreshToken: isPlaceholder(refreshToken) ? "mock-refresh-token" : refreshToken,
    githubConnection: env.GITHUB_CONNECTION?.trim() || "github",
    requestedExpirySec,
    useRar: flag(env.CIBA_USE_RAR),
    mockCiba,
    mockGithub,
    stateDir: path.resolve(env.CIBA_STATE_DIR?.trim() || ".veto-runtime"),
    pollIntervalSec,
    githubApiBase: (env.GITHUB_API_BASE?.trim() || "https://api.github.com").replace(/\/$/, ""),
    redirectUri: env.AUTH0_REDIRECT_URI?.trim() || "http://127.0.0.1:3456/callback",
  };
}

export function cibaChannel(requestedExpirySec: number): "guardian-push" | "email" {
  return requestedExpirySec <= 300 ? "guardian-push" : "email";
}

function flag(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function numberOr(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`expected a number, received ${value}`);
  }
  return parsed;
}

function isPlaceholder(value: string): boolean {
  if (!value) return true;
  return PLACEHOLDER_MARKERS.some((marker) => value.includes(marker));
}

function normalizeDomain(value: string | undefined): string {
  const raw = value?.trim() || DEFAULT_DOMAIN;
  return raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
