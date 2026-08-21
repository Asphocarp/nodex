import { describe, expect, test } from "vite-plus/test";
import {
  appendMcpAppSandboxInitId,
  buildMcpAppSandboxPartition,
  buildMcpAppSandboxSourceUrl,
} from "../../shared/mcp-app/mcp-app-sandbox-contract";
import { decideMcpAppWebviewAttachment } from "./mcp-app-webview-attachment-policy";

const sandboxId = "source-0123456789abcdef";
const partition = buildMcpAppSandboxPartition(sandboxId);
const baseSource = buildMcpAppSandboxSourceUrl({
  subdomain: "mcp-calendar-fixture",
  locale: "zh-CN",
});
const src = appendMcpAppSandboxInitId(baseSource, "init-fixture");

describe("MCP App webview attachment policy", () => {
  test("binds the isolated session to a validated sandbox source", () => {
    expect(
      decideMcpAppWebviewAttachment({
        partition,
        src,
      }),
    ).toMatchObject({
      ok: true,
      sandboxId,
      initId: "init-fixture",
    });
  });

  test.each([
    ["invalid partition", "persist:source-fixture", src],
    ["invalid source", partition, "https://example.com"],
    [
      "source with extra query capability",
      partition,
      baseSource.replace("deviceType=desktop", "deviceType=desktop&extra=1") +
        "#initId=init-fixture",
    ],
  ])("rejects %s", (_label, candidatePartition, candidateSource) => {
    expect(
      decideMcpAppWebviewAttachment({
        partition: candidatePartition,
        src: candidateSource,
      }).ok,
    ).toBe(false);
  });

  test("requires the renderer handshake init id in the source hash", () => {
    expect(
      decideMcpAppWebviewAttachment({
        partition,
        src: baseSource,
      }),
    ).toEqual({ ok: false, reason: "invalid-init-id" });
  });
});
