import { describe, expect, test } from "vitest";
import {
  MCP_APP_REQUIRED_GUEST_PORT_NAMES,
  appendMcpAppSandboxInitId,
  buildMcpAppSandboxPartition,
  buildMcpAppSandboxSourceUrl,
  deriveMcpAppSandboxIdentity,
  parseMcpAppSandboxGuestInitMessage,
  parseMcpAppSandboxPartition,
  parseMcpAppSandboxSourceUrl,
} from "./mcp-app-sandbox-contract";

describe("MCP App sandbox contract", () => {
  test("derives stable isolated identities", async () => {
    const input = {
      locale: "en-US",
      originScope: { kind: "mcp_server", server: "calendar" } as const,
      widgetDomain: "https://calendar.example.com",
    };
    const first = await deriveMcpAppSandboxIdentity(input);
    const second = await deriveMcpAppSandboxIdentity(input);
    const other = await deriveMcpAppSandboxIdentity({
      ...input,
      locale: "zh-CN",
    });

    expect(first).toEqual(second);
    expect(first.subdomain.length).toBeLessThanOrEqual(63);
    expect(first.subdomain).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u);
    expect(first.sandboxId).toMatch(/^source-[0-9a-f]{16}$/u);
    expect(first.sandboxId).not.toBe(other.sandboxId);
    expect(first.subdomain).toBe(other.subdomain);
  });

  test("round-trips source and partition identities", () => {
    const sandboxId = "source-0123456789abcdef";
    const partition = buildMcpAppSandboxPartition(sandboxId);
    const baseSource = buildMcpAppSandboxSourceUrl({
      subdomain: "mcp-calendar-fixture",
      locale: "zh-CN",
    });
    const source = appendMcpAppSandboxInitId(baseSource, "init_fixture_1");

    expect(parseMcpAppSandboxPartition(partition)).toBe(sandboxId);
    expect(parseMcpAppSandboxSourceUrl(source)).toMatchObject({
      initId: "init_fixture_1",
      locale: "zh-CN",
      subdomain: "mcp-calendar-fixture",
    });
    expect(parseMcpAppSandboxSourceUrl(baseSource)?.initId).toBe(null);
  });

  test("accepts the trusted remote transport and rejects extra query keys", () => {
    const source = appendMcpAppSandboxInitId(buildMcpAppSandboxSourceUrl({
      subdomain: "mcp-calendar-fixture",
      locale: "en-US",
    }), "init_fixture_1");
    const withExtra = new URL(source);
    withExtra.searchParams.set("extra", "1");

    expect(parseMcpAppSandboxSourceUrl(withExtra.toString())).toBe(null);
    expect(parseMcpAppSandboxSourceUrl(source.replace("nodex-mcp-sandbox:", "https:")))
      .not.toBe(null);
    expect(parseMcpAppSandboxSourceUrl(source.replace("nodex-mcp-sandbox:", "ftp:")))
      .toBe(null);
  });

  test("accepts only the enumerated complete port set", () => {
    const valid = {
      type: "init",
      initId: "init-fixture",
      origin: "nodex-mcp-sandbox://mcp-fixture.web-sandbox.oaiusercontent.com",
      portNames: [...MCP_APP_REQUIRED_GUEST_PORT_NAMES],
    };

    expect(parseMcpAppSandboxGuestInitMessage(valid)?.portNames).toEqual(
      MCP_APP_REQUIRED_GUEST_PORT_NAMES,
    );
    expect(parseMcpAppSandboxGuestInitMessage({
      ...valid,
      portNames: [...MCP_APP_REQUIRED_GUEST_PORT_NAMES.slice(1)],
    })).toBe(null);
    expect(parseMcpAppSandboxGuestInitMessage({
      ...valid,
      portNames: [...MCP_APP_REQUIRED_GUEST_PORT_NAMES, "invoke"],
    })).toBe(null);
  });

});
