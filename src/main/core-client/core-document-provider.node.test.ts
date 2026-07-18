import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import { afterEach, describe, expect, test } from "vitest";
import * as Y from "yjs";

import { NodexYProvider } from "../../renderer/lib/nodex-y-provider";
import { inspectOwnedBlockDocument } from "../../shared/block-documents";
import { CoreClient } from "./core-client";
import { createCoreDocumentSyncAdapter } from "./document-sync-adapter";
import type { CoreRuntimeDescriptor } from "./types";

const CORE_BINARY = path.resolve("target/debug/nodex-core");
const SEED_BINARY = path.resolve(
  "target/debug/examples/seed_owned_document_profile",
);
const PROJECT_ID = "project:core-renderer-test";
const DOCUMENT_ID = "019bf52d-6870-7000-8000-000000000102";

const children = new Set<ChildProcessWithoutNullStreams>();
const homes = new Set<string>();

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
  await Promise.all([...children].map((child) => waitForExit(child).catch(() => null)));
  children.clear();
  for (const home of homes) rmSync(home, { recursive: true, force: true });
  homes.clear();
});

const spawnCore = (nodexHome: string): ChildProcessWithoutNullStreams => {
  const child = spawn(CORE_BINARY, ["--home", nodexHome], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.add(child);
  return child;
};

const readDescriptor = (
  child: ChildProcessWithoutNullStreams,
): Promise<CoreRuntimeDescriptor> =>
  new Promise((resolve, reject) => {
    const lines = createInterface({ input: child.stdout });
    const timeout = setTimeout(() => {
      lines.close();
      reject(new Error("Core did not publish a runtime descriptor"));
    }, 5_000);
    lines.once("line", (line) => {
      clearTimeout(timeout);
      lines.close();
      resolve(JSON.parse(line) as CoreRuntimeDescriptor);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      lines.close();
      reject(error);
    });
  });

const waitForExit = (
  child: ChildProcessWithoutNullStreams,
): Promise<number | null> => {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once("exit", resolve));
};

const waitUntil = async (
  predicate: () => boolean,
  message: string,
): Promise<void> => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
};

describe("Rust Core renderer Document adapter", () => {
  test("converges renderer and semantic edits, then replays a disconnected commit once", async () => {
    expect(existsSync(CORE_BINARY), "run pnpm run core:test:client").toBe(true);
    expect(existsSync(SEED_BINARY), "run pnpm run core:test:client").toBe(true);
    const nodexHome = mkdtempSync(path.join(tmpdir(), "nodex-core-document-"));
    homes.add(nodexHome);
    execFileSync(SEED_BINARY, [nodexHome], { stdio: "pipe" });
    const child = spawnCore(nodexHome);
    await readDescriptor(child);
    const client = await CoreClient.connect({
      nodexHome,
      clientKind: "test",
      buildId: "renderer-provider-test",
      projectId: PROJECT_ID,
    });
    const document = new Y.Doc({ guid: DOCUMENT_ID });
    const provider = new NodexYProvider({
      documentId: DOCUMENT_ID,
      document,
      adapter: createCoreDocumentSyncAdapter(client),
      clientSessionId: "renderer:core-provider-test",
      autoConnect: false,
      localCheckpointStore: null,
    });
    try {
      await provider.connect();
      expect(provider.getStatus()).toMatchObject({
        phase: "synced",
        headSeq: 2,
      });
      expect(materialized(document).nfm).toContain("Base body");

      document.getText("title").insert(0, "Renderer title");
      const semantic = client.documentApply({
        operationId: "semantic:concurrent-body",
        clientSessionId: provider.clientSessionId,
        intent: {
          kind: "apply_semantic_mutation",
          document_id: DOCUMENT_ID,
          generation: 1,
          expected_head_seq: 2,
          commands: [{
            kind: "patch_body",
            old_fragment: "Base body",
            new_fragment: "Rust body",
          }],
        },
      });
      await Promise.all([provider.flush(), semantic]);
      await waitUntil(
        () => provider.getStatus().headSeq === 4,
        "renderer did not observe both concurrent commits",
      );
      expect(document.getText("title").toString()).toBe("Renderer title");
      expect(materialized(document).nfm).toContain("Rust body");

      provider.disconnect();
      const disconnected = await client.documentApply({
        operationId: "semantic:disconnected-body",
        clientSessionId: provider.clientSessionId,
        intent: {
          kind: "apply_semantic_mutation",
          document_id: DOCUMENT_ID,
          generation: 1,
          expected_head_seq: 4,
          commands: [{
            kind: "patch_body",
            old_fragment: "Rust body",
            new_fragment: "Replayed body",
          }],
        },
      });
      expect(disconnected.receipt.duplicate).toBe(false);
      expect(provider.getStatus().headSeq).toBe(4);

      await provider.connect();
      await waitUntil(
        () => provider.getStatus().headSeq === 5,
        "renderer did not replay the disconnected commit",
      );
      expect(materialized(document).nfm).toContain("Replayed body");
      expect(document.getText("title").toString()).toBe("Renderer title");

      const retry = await client.documentApply({
        operationId: "semantic:disconnected-body",
        clientSessionId: provider.clientSessionId,
        intent: {
          kind: "apply_semantic_mutation",
          document_id: DOCUMENT_ID,
          generation: 1,
          expected_head_seq: 4,
          commands: [{
            kind: "patch_body",
            old_fragment: "Rust body",
            new_fragment: "Replayed body",
          }],
        },
      });
      expect(retry.receipt.duplicate).toBe(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      expect(provider.getStatus().headSeq).toBe(5);
    } finally {
      provider.destroy();
      document.destroy();
      await client.shutdown().catch(() => undefined);
    }
  });

  test("scopes ephemeral Awareness and removes it when a UDS connection closes", async () => {
    expect(existsSync(CORE_BINARY), "run pnpm run core:test:client").toBe(true);
    expect(existsSync(SEED_BINARY), "run pnpm run core:test:client").toBe(true);
    const nodexHome = mkdtempSync(path.join(tmpdir(), "nodex-core-awareness-"));
    homes.add(nodexHome);
    execFileSync(SEED_BINARY, [nodexHome], { stdio: "pipe" });
    const child = spawnCore(nodexHome);
    await readDescriptor(child);
    const [clientA, clientB] = await Promise.all([
      CoreClient.connect({
        nodexHome,
        clientKind: "test",
        buildId: "awareness-a",
        projectId: PROJECT_ID,
      }),
      CoreClient.connect({
        nodexHome,
        clientKind: "test",
        buildId: "awareness-b",
        projectId: PROJECT_ID,
      }),
    ]);
    const documentA = new Y.Doc({ guid: DOCUMENT_ID });
    const documentB = new Y.Doc({ guid: DOCUMENT_ID });
    const providerA = new NodexYProvider({
      documentId: DOCUMENT_ID,
      document: documentA,
      adapter: createCoreDocumentSyncAdapter(clientA),
      clientSessionId: "renderer:awareness-a",
      autoConnect: false,
      localCheckpointStore: null,
    });
    const providerB = new NodexYProvider({
      documentId: DOCUMENT_ID,
      document: documentB,
      adapter: createCoreDocumentSyncAdapter(clientB),
      clientSessionId: "renderer:awareness-b",
      autoConnect: false,
      localCheckpointStore: null,
    });
    try {
      await Promise.all([providerA.connect(), providerB.connect()]);
      providerA.awareness.setLocalState({ user: { name: "Alice" } });
      await waitUntil(
        () => awarenessName(providerB, documentA.clientID) === "Alice",
        "second provider did not observe Awareness join",
      );

      providerA.awareness.setLocalStateField("user", { name: "Alicia" });
      await waitUntil(
        () => awarenessName(providerB, documentA.clientID) === "Alicia",
        "second provider did not observe Awareness update",
      );

      providerA.disconnect();
      await waitUntil(
        () => !providerB.awareness.getStates().has(documentA.clientID),
        "second provider did not observe Awareness leave",
      );
      expect(providerB.getStatus().headSeq).toBe(2);
    } finally {
      providerA.destroy();
      providerB.destroy();
      documentA.destroy();
      documentB.destroy();
      await clientA.shutdown().catch(() => undefined);
    }
  });
});

const materialized = (document: Y.Doc) =>
  inspectOwnedBlockDocument(document, {
    ownerType: "page",
    schemaKey: "nodex.page",
    schemaVersion: 2,
  }).materialization;

const awarenessName = (
  provider: NodexYProvider,
  clientId: number,
): string | undefined => {
  const state = provider.awareness.getStates().get(clientId);
  if (typeof state !== "object" || state === null || !("user" in state)) {
    return undefined;
  }
  const user = state.user;
  if (typeof user !== "object" || user === null || !("name" in user)) {
    return undefined;
  }
  return typeof user.name === "string" ? user.name : undefined;
};
