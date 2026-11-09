import { describe, expect, it } from "vitest";

import { ParseError, parseCommand } from "../src/parse.js";
import { impactOf } from "../src/policy.js";
import { bindingMessage } from "../src/ciba/binding.js";

describe("command parser", () => {
  it("parses read and high-impact phrases", () => {
    expect(parseCommand("list my repos")).toEqual({ type: "list_repos" });
    expect(parseCommand("Please show repositories")).toEqual({ type: "list_repos" });
    expect(parseCommand("list open issues in Acme/Widgets")).toEqual({
      type: "list_open_issues",
      repository: "Acme/Widgets",
    });
    expect(parseCommand("delete the repository acme/widgets")).toEqual({
      type: "delete_repo",
      repository: "acme/widgets",
    });
    expect(parseCommand("close all issues acme/notes")).toEqual({
      type: "close_all_issues",
      repository: "acme/notes",
    });
    expect(parseCommand("archive repo acme/notes")).toEqual({
      type: "archive_repo",
      repository: "acme/notes",
    });
  });

  it("rejects unknown commands", () => {
    expect(() => parseCommand("rename repo acme/widgets")).toThrow(ParseError);
  });
});

describe("impact policy", () => {
  it("lets reads run and holds mutations", () => {
    expect(impactOf({ type: "list_repos" })).toBe("read");
    expect(impactOf({ type: "list_open_issues", repository: "acme/widgets" })).toBe("read");
    expect(impactOf({ type: "delete_repo", repository: "acme/widgets" })).toBe("high-impact");
    expect(impactOf({ type: "close_all_issues", repository: "acme/widgets" })).toBe("high-impact");
    expect(impactOf({ type: "archive_repo", repository: "acme/widgets" })).toBe("high-impact");
  });
});

describe("binding message", () => {
  it("fits Auth0's 64 character alphabet", () => {
    const message = bindingMessage({ type: "delete_repo", repository: "acme/widgets" });
    expect(message).toBe("Veto delete_repo acme:widgets");
    expect(message.length).toBeLessThanOrEqual(64);
    expect(message).toMatch(/^[A-Za-z0-9+\-_.,:# ]+$/);
  });
});
