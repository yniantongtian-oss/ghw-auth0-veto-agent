import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("example run log", () => {
  it("shows a sensitive command halted until an out-of-band approval", () => {
    const log = fs.readFileSync("examples/sensitive-command-approval.log", "utf8");
    const skipped = log.indexOf("approval=skipped");
    const halt = log.indexOf("HALTED waiting for out-of-band approval");
    const pending = log.indexOf("result=authorization_pending");
    const approve = log.indexOf("$ veto approve ciba_");
    const deleted = log.indexOf("DELETE /repos/acme/widgets");
    const summary = log.indexOf("deleted acme/widgets");
    const deny = log.indexOf("$ veto deny ciba_");
    const denied = log.indexOf("result=access_denied");

    expect(skipped).toBeGreaterThan(-1);
    expect(halt).toBeGreaterThan(skipped);
    expect(pending).toBeGreaterThan(halt);
    expect(approve).toBeGreaterThan(pending);
    expect(deleted).toBeGreaterThan(approve);
    expect(summary).toBeGreaterThan(deleted);
    expect(deny).toBeGreaterThan(summary);
    expect(denied).toBeGreaterThan(deny);
    expect(log).not.toContain("PATCH /repos/acme/notes");
    expect(log).toContain("archived=false");
    expect(log).toContain("urn:openid:params:grant-type:ciba");
    expect(log).toContain(
      "urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token",
    );
  });
});
