#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";

import { runCommand } from "./agent.js";
import { loadConfig } from "./config.js";
import { decide, pending } from "./control.js";
import { Logger } from "./log.js";
import { login } from "./login.js";
import { usage } from "./parse.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    fs.writeSync(1, `veto — GitHub agent with Auth0 Token Vault and CIBA approval\n\n${usage()}\n`);
    return;
  }

  const config = loadConfig();
  if (args[0] === "login") {
    await login(config);
    return;
  }
  if (args[0] === "pending") {
    for (const line of await pending(config)) fs.writeSync(1, `${line}\n`);
    return;
  }
  if (args[0] === "approve" || args[0] === "deny") {
    const authReqId = args[1];
    if (!authReqId) {
      fs.writeSync(2, `usage: veto ${args[0]} <auth_req_id>\n`);
      process.exitCode = 1;
      return;
    }
    fs.writeSync(1, `${await decide(config, args[0], authReqId)}\n`);
    return;
  }

  const result = await runCommand(args.join(" "), { config, logger: new Logger() });
  fs.writeSync(1, `\n${result.message}\n`);
  process.exitCode = result.exitCode;
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  fs.writeSync(2, `${message}\n`);
  process.exitCode = 1;
});
