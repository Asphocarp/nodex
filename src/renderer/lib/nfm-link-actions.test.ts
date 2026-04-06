import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { FileLinkTarget } from "../../shared/file-link-openers";
import {
  openNfmResolvedLinkAction,
  resolveNfmLinkAction,
  resolveNfmLinkTooltipLabel,
} from "./nfm-link-actions";

const originalWindowOpen = window.open;
const originalLocationAssign = window.location.assign;
const originalApi = window.api;

let windowOpenCalls: unknown[][] = [];
let locationAssignCalls: unknown[][] = [];
let invokeCalls: unknown[][] = [];

describe("nfm link actions", () => {
  beforeEach(() => {
    windowOpenCalls = [];
    locationAssignCalls = [];
    invokeCalls = [];

    window.open = ((...args: unknown[]) => {
      windowOpenCalls.push(args);
      return null;
    }) as typeof window.open;
    window.location.assign = ((...args: unknown[]) => {
      locationAssignCalls.push(args);
    }) as typeof window.location.assign;
    window.api = {
      invoke: async (...args: unknown[]) => {
        invokeCalls.push(args);
        return true;
      },
      on: () => () => {},
    } as typeof window.api;
  });

  afterEach(() => {
    window.open = originalWindowOpen;
    window.location.assign = originalLocationAssign;
    window.api = originalApi;
  });

  test("classifies absolute local paths and file urls as file targets", () => {
    const unixAction = resolveNfmLinkAction("/Users/asc/repo/abc#L12");
    const fileUrlAction = resolveNfmLinkAction("file:///Users/asc/repo/abc#L12C3");
    const windowsAction = resolveNfmLinkAction("C:\\repo\\abc");

    expect(unixAction?.kind).toBe("local-file");
    expect(JSON.stringify((unixAction as { target: FileLinkTarget }).target)).toBe(JSON.stringify({
      path: "/Users/asc/repo/abc",
      line: 12,
    }));
    expect(fileUrlAction?.kind).toBe("local-file");
    expect(JSON.stringify((fileUrlAction as { target: FileLinkTarget }).target)).toBe(JSON.stringify({
      path: "/Users/asc/repo/abc",
      line: 12,
      column: 3,
    }));
    expect(windowsAction?.kind).toBe("local-file");
  });

  test("classifies bare domains as open-time web urls", () => {
    const bareDomain = resolveNfmLinkAction("example.com");
    const wwwDomain = resolveNfmLinkAction("www.example.com/docs");

    expect(bareDomain?.kind).toBe("web-url");
    expect((bareDomain as { url: string }).url).toBe("https://example.com");
    expect(wwwDomain?.kind).toBe("web-url");
    expect((wwwDomain as { url: string }).url).toBe("https://www.example.com/docs");
  });

  test("resolves relative file-like values against project workspace", () => {
    const direct = resolveNfmLinkAction("folder/abc/file", "/workspace/project");
    const dotRelative = resolveNfmLinkAction("./foo.ts#L8", "/workspace/project");
    const parentRelative = resolveNfmLinkAction("../foo.ts", "/workspace/project/nested");

    expect(direct?.kind).toBe("workspace-file");
    expect(JSON.stringify((direct as { target: FileLinkTarget }).target)).toBe(JSON.stringify({
      path: "/workspace/project/folder/abc/file",
    }));
    expect(dotRelative?.kind).toBe("workspace-file");
    expect(JSON.stringify((dotRelative as { target: FileLinkTarget }).target)).toBe(JSON.stringify({
      path: "/workspace/project/foo.ts",
      line: 8,
    }));
    expect(parentRelative?.kind).toBe("workspace-file");
    expect(JSON.stringify((parentRelative as { target: FileLinkTarget }).target)).toBe(JSON.stringify({
      path: "/workspace/project/foo.ts",
    }));
  });

  test("classifies unresolved relative file-like values separately from blocked protocols", () => {
    const unresolved = resolveNfmLinkAction("folder/abc/file");
    const blockedProtocol = resolveNfmLinkAction("javascript:alert(1)");

    expect(unresolved?.kind).toBe("unresolved-file-like");
    expect((unresolved as { reason: string }).reason).toBe("Cannot resolve relative file link without project workspace.");
    expect(blockedProtocol?.kind).toBe("blocked");
    expect((blockedProtocol as { reason: string }).reason).toBe("Blocked unsupported link protocol.");
  });

  test("keeps fragment and query links literal", () => {
    expect(resolveNfmLinkAction("#section")?.kind).toBe("literal-anchor");
    expect(resolveNfmLinkAction("?tab=details")?.kind).toBe("literal-anchor");
  });

  test("derives tooltip labels for file and blocked actions", () => {
    const fileAction = resolveNfmLinkAction("/Users/asc/repo/abc#L12C3");
    const blockedAction = resolveNfmLinkAction("folder/abc/file");

    expect(resolveNfmLinkTooltipLabel(fileAction, true)).toBe("/Users/asc/repo/abc (line 12, column 3)");
    expect(resolveNfmLinkTooltipLabel(fileAction, false)).toBe(null);
    expect(resolveNfmLinkTooltipLabel(blockedAction, false)).toBe("Cannot resolve relative file link without project workspace.");
  });

  test("opens bare domains using open-time normalization only", async () => {
    const action = resolveNfmLinkAction("example.com");
    await openNfmResolvedLinkAction(action!);

    expect(JSON.stringify(windowOpenCalls)).toBe(JSON.stringify([
      ["https://example.com", "_blank", "noopener,noreferrer"],
    ]));
  });

  test("opens file links through the desktop bridge", async () => {
    const action = resolveNfmLinkAction("/Users/asc/repo/abc");
    await openNfmResolvedLinkAction(action!);

    expect(JSON.stringify(invokeCalls)).toBe(JSON.stringify([
      ["shell:open-file-link", { path: "/Users/asc/repo/abc" }, "vscode"],
    ]));
  });

  test("opens literal anchors via location.assign", async () => {
    const action = resolveNfmLinkAction("#section");
    await openNfmResolvedLinkAction(action!);

    expect(JSON.stringify(locationAssignCalls)).toBe(JSON.stringify([
      ["#section"],
    ]));
  });
});
