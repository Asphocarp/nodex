import { describe, expect, test } from "bun:test";
import { isRenderableMcpServerElicitationRequest } from "./codex-mcp-elicitation";

describe("isRenderableMcpServerElicitationRequest", () => {
  test("declines invalid url-mode elicitations before they enter the request plane", () => {
    expect(isRenderableMcpServerElicitationRequest({
      threadId: "thread-1",
      turnId: "turn-1",
      serverName: "browser",
      mode: "url",
      _meta: null,
      message: "Open this URL?",
      url: "http://example.test",
      elicitationId: "elicitation-1",
    })).toBeFalse();
  });

  test("accepts ordinary https url-mode elicitations", () => {
    expect(isRenderableMcpServerElicitationRequest({
      threadId: "thread-1",
      turnId: "turn-1",
      serverName: "browser",
      mode: "url",
      _meta: null,
      message: "Open this URL?",
      url: "https://example.test/path",
      elicitationId: "elicitation-1",
    })).toBeTrue();
  });

  test("requires Codex Apps auth failure metadata on ChatGPT hosts", () => {
    const base = {
      threadId: "thread-1",
      turnId: "turn-1",
      serverName: "codex_apps",
      mode: "url" as const,
      message: "Connect the app?",
      url: "https://chatgpt.com/connect",
      elicitationId: "elicitation-1",
    };

    expect(isRenderableMcpServerElicitationRequest({
      ...base,
      _meta: null,
    })).toBeFalse();
    expect(isRenderableMcpServerElicitationRequest({
      ...base,
      _meta: {
        _codex_apps: {
          connector_auth_failure: {
            is_auth_failure: true,
            connector_id: "gmail",
            connector_name: "Gmail",
            install_url: "https://chatgpt.com/connect/gmail",
            requested_scopes: ["mail.read"],
          },
        },
      },
    })).toBeTrue();
  });
});
