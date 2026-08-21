import { describe, expect, it } from "vite-plus/test";
import { parseCodexApprovalResponse } from "./codex-approval-response";

describe("Codex approval response boundary", () => {
  it("accepts command-only amendments only for command approvals", () => {
    const amendment = {
      applyNetworkPolicyAmendment: {
        network_policy_amendment: { host: "example.com", action: "allow" },
      },
    };

    expect(parseCodexApprovalResponse({ kind: "command", decision: amendment })).toEqual({
      kind: "command",
      decision: amendment,
    });
    expect(parseCodexApprovalResponse({ kind: "file", decision: amendment })).toBeNull();
  });

  it("accepts the shared scalar decisions for both approval kinds", () => {
    expect(parseCodexApprovalResponse({ kind: "command", decision: "decline" })).not.toBeNull();
    expect(parseCodexApprovalResponse({ kind: "file", decision: "decline" })).not.toBeNull();
  });
});
