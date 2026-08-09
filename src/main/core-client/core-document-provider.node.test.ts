import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import { afterEach, describe, expect, test } from "vitest";
import * as Y from "yjs";

import { NodexYProvider } from "../../renderer/lib/nodex-y-provider";
import { inspectOwnedBlockDocument } from "../../shared/block-documents";
import { CoreClient, CoreModuleResponseError } from "./core-client";
import { createCoreDocumentSyncAdapter } from "./document-sync-adapter";
import type { CoreRuntimeDescriptor } from "./types";

const CORE_BINARY = path.resolve("target/debug/nodex-core");
const SEED_BINARY = path.resolve(
  "target/debug/examples/seed_owned_document_profile",
);
const PROJECT_ID = "project:core-renderer-test";
const PAGE_ID = "019bf52d-6870-7000-8000-000000000101";
const DOCUMENT_ID = `document:${PAGE_ID}`;

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
    }, 10_000);
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
  test("prepares one exact Agent mutation and replays its receipt without renewed consent", async () => {
    expect(existsSync(CORE_BINARY), "run pnpm run core:test:client").toBe(true);
    expect(existsSync(SEED_BINARY), "run pnpm run core:test:client").toBe(true);
    const nodexHome = mkdtempSync(path.join(tmpdir(), "nodex-core-agent-prepared-"));
    homes.add(nodexHome);
    execFileSync(SEED_BINARY, [nodexHome], { stdio: "pipe" });
    const child = spawnCore(nodexHome);
    await readDescriptor(child);
    const [host, otherHost] = await Promise.all([
      CoreClient.connect({
        nodexHome,
        clientKind: "test",
        buildId: "agent-prepared-host",
        projectId: PROJECT_ID,
      }),
      CoreClient.connect({
        nodexHome,
        clientKind: "test",
        buildId: "agent-prepared-other-host",
        projectId: PROJECT_ID,
      }),
    ]);
    const threadId = "thread:agent-prepared-node";
    const turnId = "turn:agent-prepared-node";
    try {
      await host.workspaceApply({
        operationId: "agent-prepared-thread",
        intent: {
          kind: "upsert_thread",
          thread_id: threadId,
          patch: {
            project_id: PROJECT_ID,
            thread_name: "Prepared Agent integration",
            created_at: 1,
            updated_at: 1,
            linked_at: "2026-07-19T00:00:00.000Z",
          },
        },
      });
      await host.workspaceApply({
        operationId: "agent-prepared-turn",
        intent: {
          kind: "freeze_turn_authority",
          thread_id: threadId,
          turn_id: turnId,
          root_thread_id: threadId,
          actor_project_id: PROJECT_ID,
          source: "project_turn",
          inherited_from: null,
        },
      });
      const provenance = {
        profile_id: host.handshake.generation.profile_id,
        authority: {
          thread_id: threadId,
          turn_id: turnId,
          root_thread_id: threadId,
          actor_project_id: PROJECT_ID,
          library_id: host.handshake.library_id,
          store_epoch: host.handshake.store_epoch,
          scope: "project" as const,
          source: "project_turn" as const,
        },
      };
      const callId = "call:agent-prepared-node";
      const authorization = {
        provenance,
        call_id: callId,
        resource_access: {
          kind: "consent" as const,
          scope: "call" as const,
          thread_id: threadId,
          turn_id: turnId,
          call_id: callId,
          root_thread_id: threadId,
          actor_project_id: PROJECT_ID,
          library_id: host.handshake.library_id,
          store_epoch: host.handshake.store_epoch,
          grants: [{
            root: { kind: "page" as const, page_id: PAGE_ID },
            access: "read_write" as const,
          }],
        },
      };
      const operationId = "agent-prepared-body";
      const mutation = {
        document_id: DOCUMENT_ID,
        generation: 1,
        expected_head_seq: 2,
        allow_deleting_owned_blocks: false,
        commands: [{
          kind: "patch_body" as const,
          old_fragment: "Base body",
          new_fragment: "Prepared body",
          expected_matches: 1,
        }],
      };
      const preflight = await host.documentRead("agent:prepared", {
        kind: "prepare_agent_semantic_mutation",
        operation_id: operationId,
        store_epoch: host.handshake.store_epoch,
        authorization,
        mutation,
      });
      expect(preflight.value).toMatchObject({
        kind: "agent_semantic_mutation_preparation",
        preparation: {
          state: "prepared",
          consent: "none",
          footprint: {
            effect_class: "destructive",
            targets: [{ kind: "page" }],
          },
        },
      });
      if (preflight.value.kind !== "agent_semantic_mutation_preparation") {
        throw new Error("Expected prepared Agent mutation");
      }
      const footprint = preflight.value.preparation.footprint;
      expect(footprint.created_roots).toHaveLength(1);
      expect(footprint.deleted_roots).toHaveLength(1);
      const token = preflight.value.preparation.token;
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      await expect(
        otherHost.documentApply({
          operationId,
          clientSessionId: "agent:prepared",
          intent: {
            kind: "execute_prepared_agent_semantic_mutation",
            authorization: { authorization, token },
            mutation,
          },
        }),
      ).rejects.toSatisfy(
        (error: unknown) => error instanceof CoreModuleResponseError
          && error.coreError.code === "revision_conflict",
      );
      const committed = await host.documentApply({
        operationId,
        clientSessionId: "agent:prepared",
        intent: {
          kind: "execute_prepared_agent_semantic_mutation",
          authorization: { authorization, token },
          mutation,
        },
      });
      expect(committed).toMatchObject({
        outcome: {
          head_seq: 3,
          semantic_etags: {
            title: expect.stringMatching(/^nxe1\./u),
            body: expect.stringMatching(/^nxe1\./u),
          },
          mutation_effect: {
            created_block_ids: footprint.created_roots,
            deleted_block_ids: footprint.deleted_roots,
          },
        },
        receipt: { duplicate: false },
      });
      const replay = await host.documentApply({
        operationId,
        clientSessionId: "agent:prepared",
        intent: {
          kind: "execute_prepared_agent_semantic_mutation",
          authorization: { authorization, token: null },
          mutation,
        },
      });
      expect(replay).toMatchObject({
        outcome: {
          head_seq: 3,
          semantic_etags: committed.outcome.semantic_etags,
        },
        receipt: { duplicate: true },
      });
      const replayPreflight = await host.documentRead("agent:prepared", {
        kind: "prepare_agent_semantic_mutation",
        operation_id: operationId,
        store_epoch: host.handshake.store_epoch,
        authorization,
        mutation,
      });
      expect(replayPreflight.value).toMatchObject({
        kind: "agent_semantic_mutation_preparation",
        preparation: { state: "committed_replay" },
        committed: { receipt: { duplicate: true } },
      });
      if (replayPreflight.value.kind !== "agent_semantic_mutation_preparation") {
        throw new Error("Expected committed Agent replay");
      }
      expect(replayPreflight.value.preparation.token).toBeUndefined();

      const insertOperationId = "agent-prepared-insert";
      const insertMutation = {
        document_id: DOCUMENT_ID,
        generation: 1,
        expected_head_seq: 3,
        allow_deleting_owned_blocks: false,
        commands: [{
          kind: "insert_body" as const,
          anchor: { kind: "end" as const, parent_block_id: null },
          nested_markdown: "Inserted through prepared Core",
        }],
      };
      const insertPreflight = await host.documentRead("agent:prepared", {
        kind: "prepare_agent_semantic_mutation",
        operation_id: insertOperationId,
        store_epoch: host.handshake.store_epoch,
        authorization,
        mutation: insertMutation,
      });
      if (insertPreflight.value.kind !== "agent_semantic_mutation_preparation") {
        throw new Error("Expected prepared Agent insertion");
      }
      expect(insertPreflight.value.preparation).toMatchObject({
        state: "prepared",
        footprint: {
          effect_class: "write",
          created_roots: [expect.any(String)],
          deleted_roots: [],
        },
      });
      expect(insertPreflight.value.preparation.preview_markdown)
        .toContain("Inserted through prepared Core");
      const insertCommitted = await host.documentApply({
        operationId: insertOperationId,
        clientSessionId: "agent:prepared",
        intent: {
          kind: "execute_prepared_agent_semantic_mutation",
          authorization: {
            authorization,
            token: insertPreflight.value.preparation.token,
          },
          mutation: insertMutation,
        },
      });
      expect(insertCommitted.outcome).toMatchObject({
        head_seq: 4,
        mutation_effect: {
          created_block_ids: insertPreflight.value.preparation.footprint.created_roots,
          deleted_block_ids: [],
        },
      });

      const resolved = await host.libraryRead({
        kind: "agent_block_target",
        block_id: PAGE_ID,
        authorization,
      });
      expect(resolved.value).toMatchObject({
        kind: "agent_block_target",
        value: {
          block_id: PAGE_ID,
          owner_page_id: PAGE_ID,
          document_id: DOCUMENT_ID,
          document_generation: 1,
          document_head_seq: 4,
        },
      });
      const stableOperationId = "agent-prepared-stable-insert";
      const stableMutation = {
        document_id: DOCUMENT_ID,
        generation: 1,
        expected_head_seq: 4,
        allow_deleting_owned_blocks: false,
        commands: [{
          kind: "insert_block" as const,
          anchor: { kind: "end" as const, parent_block_id: null },
          block: {
            local_id: "stable-root",
            block_type: "paragraph",
            props: {},
            content: {
              kind: "value" as const,
              value: [{ type: "text", text: "Stable root", styles: {} }],
            },
            children: [],
          },
        }],
      };
      const stablePreflight = await host.documentRead("agent:prepared", {
        kind: "prepare_agent_semantic_mutation",
        operation_id: stableOperationId,
        store_epoch: host.handshake.store_epoch,
        authorization,
        mutation: stableMutation,
      });
      if (stablePreflight.value.kind !== "agent_semantic_mutation_preparation") {
        throw new Error("Expected prepared stable Block insertion");
      }
      const stableCommitted = await host.documentApply({
        operationId: stableOperationId,
        clientSessionId: "agent:prepared",
        intent: {
          kind: "execute_prepared_agent_semantic_mutation",
          authorization: {
            authorization,
            token: stablePreflight.value.preparation.token,
          },
          mutation: stableMutation,
        },
      });
      const stableRootId = stableCommitted.outcome.semantic_local_block_ids?.["stable-root"];
      expect(stableRootId).toEqual(expect.any(String));
      const stableSnapshot = await host.documentRead("agent:prepared", {
        kind: "agent_semantic_snapshot",
        store_epoch: host.handshake.store_epoch,
        authorization,
        document_id: DOCUMENT_ID,
        target_block_id: PAGE_ID,
        prepare_title: true,
        prepare_body: true,
        block_guards: [{
          block_id: stableRootId as string,
          kind: "update",
        }],
        max_depth: 512,
        cursor: null,
        limit: 100,
      });
      if (stableSnapshot.value.kind !== "agent_semantic_snapshot") {
        throw new Error("Expected Agent semantic snapshot");
      }
      expect(stableSnapshot.value.snapshot).toMatchObject({
        document_id: DOCUMENT_ID,
        generation: 1,
        head_seq: 5,
        owner_block_id: PAGE_ID,
        target_block_id: PAGE_ID,
        title_etag: expect.stringMatching(/^nxe1\./u),
        body_etag: expect.stringMatching(/^nxe1\./u),
        has_more: false,
      });
      const guarded = stableSnapshot.value.snapshot.blocks.find(
        (block) => block.block_id === stableRootId,
      );
      expect(guarded?.etag).toMatch(/^nxe1\./u);
      const stableUpdateMutation = {
        document_id: DOCUMENT_ID,
        generation: 1,
        expected_head_seq: 5,
        allow_deleting_owned_blocks: false,
        commands: [{
          kind: "update_block" as const,
          block_id: stableRootId as string,
          expected_etag: guarded?.etag as string,
          patch: {
            block_type: null,
            props: { textAlignment: "center" },
            content: { kind: "absent" as const },
            unset_content: false,
          },
        }],
      };
      const stableUpdatePreflight = await host.documentRead("agent:prepared", {
        kind: "prepare_agent_semantic_mutation",
        operation_id: "agent-prepared-stable-update",
        store_epoch: host.handshake.store_epoch,
        authorization,
        mutation: stableUpdateMutation,
      });
      if (stableUpdatePreflight.value.kind !== "agent_semantic_mutation_preparation") {
        throw new Error("Expected prepared stable Block update");
      }
      const stableUpdated = await host.documentApply({
        operationId: "agent-prepared-stable-update",
        clientSessionId: "agent:prepared",
        intent: {
          kind: "execute_prepared_agent_semantic_mutation",
          authorization: {
            authorization,
            token: stableUpdatePreflight.value.preparation.token,
          },
          mutation: stableUpdateMutation,
        },
      });
      expect(stableUpdated.outcome).toMatchObject({
        head_seq: 6,
        mutation_effect: { updated_block_ids: [stableRootId] },
      });
    } finally {
      await host.shutdown().catch(() => undefined);
    }
  });

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
        error: undefined,
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
      expect(providerA.getStatus().error).toBeUndefined();
      expect(providerB.getStatus().error).toBeUndefined();
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
