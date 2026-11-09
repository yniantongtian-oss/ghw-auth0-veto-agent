import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadConfig, type AppConfig } from "../src/config.js";
import { Logger } from "../src/log.js";
import { readJson } from "../src/json-file.js";
import { seedGithubState } from "../src/github/mock-github.js";

export function silentLogger(): Logger {
  return new Logger(() => {});
}

export function tempStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veto-agent-"));
}

export function testConfig(stateDir: string, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...loadConfig({
      MOCK_CIBA: "1",
      MOCK_GITHUB: "1",
      CIBA_STATE_DIR: stateDir,
      CIBA_POLL_INTERVAL_SEC: "0.05",
      CIBA_REQUESTED_EXPIRY: "20",
      AUTH0_DOMAIN: "dev-wvxvhbnjrgvgn26x.us.auth0.com",
    }),
    ...overrides,
    stateDir,
  };
}

export async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 5000) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function githubFile(stateDir: string) {
  return readJson<ReturnType<typeof seedGithubState>>(stateDir, "github.json");
}
