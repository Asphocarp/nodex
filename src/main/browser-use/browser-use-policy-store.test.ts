import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { BrowserUsePolicyStore } from "./browser-use-policy-store";

const cleanup: string[] = [];

async function makeStore() {
  const root = await mkdtemp(join(tmpdir(), "nodex-browser-policy-"));
  cleanup.push(root);
  const filePath = join(root, "browser", "config.toml");
  const store = new BrowserUsePolicyStore(filePath, () => 1234);
  await store.initialize();
  return { filePath, store };
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) =>
    rm(path, { force: true, recursive: true })
  ));
});

describe("BrowserUsePolicyStore", () => {
  test("persists exact plugin TOML keys and opposite rule removal", async () => {
    const { filePath, store } = await makeStore();
    await store.updateModes({
      approvalMode: "neverAsk",
      historyApprovalMode: "alwaysAsk",
      downloadApprovalMode: "neverAsk",
      uploadApprovalMode: "alwaysAsk",
      fullCdpAccessEnabled: true,
    });
    await store.updateOriginRule({
      action: "add",
      kind: "denied",
      origin: "example.com/path",
      resource: "download",
    });
    await store.updateOriginRule({
      action: "add",
      kind: "allowed",
      origin: "https://example.com",
      resource: "download",
    });

    expect(store.snapshot()).toMatchObject({
      approvalMode: "neverAsk",
      downloadApprovalMode: "neverAsk",
      fullCdpAccessEnabled: true,
      allowedDownloadOrigins: ["https://example.com"],
      deniedDownloadOrigins: [],
    });
    const raw = await readFile(filePath, "utf8");
    expect(raw).toContain('approval_mode = "never_ask"');
    expect(raw).toContain("full_cdp_access_enabled = true");
    expect(raw).toContain("[downloads]");
  });

  test("hard-denies general and resource-specific origins", async () => {
    const { store } = await makeStore();
    await store.updateOriginRule({
      action: "add",
      kind: "denied",
      origin: "https://blocked.example",
      resource: "origin",
    });
    await store.updateOriginRule({
      action: "add",
      kind: "denied",
      origin: "https://files.example",
      resource: "upload",
    });
    expect(store.isExplicitlyDenied(
      "download",
      "https://blocked.example/report.pdf",
    )).toBe(true);
    expect(store.isExplicitlyDenied(
      "upload",
      "https://files.example/form",
    )).toBe(true);
    expect(store.isExplicitlyDenied(
      "download",
      "https://files.example/report.pdf",
    )).toBe(false);
  });

  test("quarantines invalid TOML and fails closed for invalid origins", async () => {
    const root = await mkdtemp(join(tmpdir(), "nodex-browser-policy-invalid-"));
    cleanup.push(root);
    const filePath = join(root, "config.toml");
    await writeFile(filePath, "[origins\n", "utf8");
    const store = new BrowserUsePolicyStore(filePath, () => 4321);
    await store.initialize();
    expect(store.snapshot().fullCdpAccessEnabled).toBe(false);
    expect(store.isExplicitlyDenied("origin", "file:///tmp/private")).toBe(true);
  });
});

