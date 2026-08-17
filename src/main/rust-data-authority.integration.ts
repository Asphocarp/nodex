import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import * as Y from "yjs";

import { initializeDesktopDataAuthority } from "./core-client/desktop-data-authority";
import type { RustDataAuthorityRuntime } from "./core-client/desktop-data-authority";
import { createCoreCanvasSceneAdapter } from "./core-client/core-canvas-scene-adapter";
import { createCoreLibraryModuleAdapter } from "./core-client/library-module-adapter";
import {
  createCoreDatabaseModuleAdapter,
  createCoreLibraryDatabaseModuleAdapter,
} from "./core-client/database-module-adapter";
import { createDesktopDatabaseModuleBridge } from "./core-client/desktop-database-module-bridge";
import { createDesktopProjectWorkspaceBridge } from "./core-client/desktop-project-workspace-bridge";
import { createDesktopNodexAgentAuthorityPort } from "./core-client/desktop-nodex-agent-authority";
import { createDesktopNodexAgentResourceAuthorityPort } from "./core-client/desktop-nodex-agent-resource-authority";
import { createDesktopNodexAgentV3DynamicService } from "./core-client/desktop-nodex-agent-dynamic-service";
import { createCoreDocumentSyncAdapter } from "./core-client/document-sync-adapter";
import { createDesktopDocumentSyncBridge } from "./core-client/desktop-document-sync-bridge";
import { createCoreBlockTransferAdapter } from "./core-client/block-transfer-adapter";
import { createCoreProjectWorkspaceAdapter } from "./core-client/project-workspace-adapter";
import {
  createDesktopAutomationModuleBridge,
} from "./core-client/desktop-automation-module-bridge";
import {
  createDesktopStoreAdministrationBridge,
} from "./core-client/desktop-store-administration-bridge";
import type { CoreEventEnvelope } from "./core-client/types";
import { NodexYProvider } from "../renderer/lib/nodex-y-provider";
import { parseDataSourcePropertyId } from "../shared/database-identities";
import {
  NODEX_APP_TOOL_NAMESPACE,
  NODEX_APP_TOOLSET_REVISION,
} from "../shared/nodex-agent-tools";
import { CreatePagesV6OutputSchema } from "../shared/nodex-agent-tools/v6-schemas";
import {
  primaryCanvasDocumentId,
  type CanvasSceneRealtimeEvent,
} from "../shared/block-documents";

const CORE_BINARY = path.resolve("target/debug/nodex-core");
const temporaryDirectories: string[] = [];

const waitUntil = async (
  predicate: () => boolean,
  message: string,
): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
};

const listCurrentProcessFiles = (): string => {
  if (process.platform !== "darwin") return "";
  return execFileSync(
    "/usr/sbin/lsof",
    ["-a", "-p", String(process.pid), "-Fn"],
    { encoding: "utf8" },
  );
};

afterEach(() => {
  delete process.env.NODEX_CORE_EXECUTABLE;
  delete process.env.NODEX_HOME;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Electron native data authority", () => {
  test("starts Core without opening the Profile database in Electron", async () => {
    expect(process.versions.electron).toBeTruthy();
    expect(existsSync(CORE_BINARY), "build nodex-core before this test").toBe(true);
    const nodexHome = mkdtempSync(path.join(tmpdir(), "nodex-rust-authority-"));
    temporaryDirectories.push(nodexHome);
    process.env.NODEX_CORE_EXECUTABLE = CORE_BINARY;
    process.env.NODEX_HOME = nodexHome;
    let runtime: RustDataAuthorityRuntime | null = null;

    try {
      const selected = await initializeDesktopDataAuthority({
        buildId: "electron-authority-integration-test",
        isPackaged: false,
        nodexHome,
      });
      expect(selected.backend).toBe("rust");
      if (selected.backend !== "rust") throw new Error("Expected Rust authority");
      runtime = selected;

      const databasePath = path.join(nodexHome, "nodex.db");
      expect(existsSync(databasePath)).toBe(true);
      expect(listCurrentProcessFiles()).not.toContain(databasePath);

      const workspaceAdapter = createCoreProjectWorkspaceAdapter(
        runtime.rootClient,
      );
      await expect(workspaceAdapter.readProjectBootstrap()).resolves.toEqual({
        status: "empty",
      });
      const initialProject = await workspaceAdapter.createInitialProject({
        operationId: randomUUID(),
        projectId: randomUUID(),
        name: "Electron authority",
        description: "",
        sources: [nodexHome],
        starterPage: {
          pageId: randomUUID(),
          documentId: randomUUID(),
          titleMarkdown: "Welcome to Nodex",
          nfm: "Welcome to Nodex.",
        },
      });
      const projectId = initialProject.project.id;
      const desktopWorkspace = createDesktopProjectWorkspaceBridge({
        authority: Promise.resolve(runtime),
      });
      await expect(desktopWorkspace.listProjects()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: projectId }),
        ]),
      );
      expect(listCurrentProcessFiles()).not.toContain(databasePath);
      const database = createCoreDatabaseModuleAdapter({
        client: runtime.clientForProject(projectId),
        projectId,
        libraryId: runtime.rootClient.handshake.library_id,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
      });
      const databaseCatalog = await database.read({
        projectId,
        read: { target: { kind: "project_default" }, mode: "database" },
      });
      expect(databaseCatalog).toMatchObject({
        ok: true,
        value: {
          projectId,
          libraryId: runtime.rootClient.handshake.library_id,
          value: { kind: "database" },
        },
      });
      if (!databaseCatalog.ok || databaseCatalog.value.value.kind !== "database") {
        throw new Error("Expected Core Database descriptor");
      }
      const primaryDatabase = databaseCatalog.value.value.value;
      const primaryDataSource = primaryDatabase?.dataSources[0];
      const primaryView = primaryDatabase?.views.find((view) =>
        view.dataSourceId === primaryDataSource?.dataSourceId
      );
      if (!primaryDatabase || !primaryDataSource || !primaryView) {
        throw new Error("Core Database catalog omitted its primary authority");
      }
      const nativePropertyId = parseDataSourcePropertyId("p_rustcore");
      const databaseWrite = {
        operationId: "electron-database-adapter-put-property",
        projectId,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        actor: {
          kind: "electron_renderer",
          clientId: "renderer:electron-database-adapter",
        },
        operations: [{
          kind: "put_property",
          dataSourceId: primaryDataSource.dataSourceId,
          propertyId: nativePropertyId,
          expectedDataSourceRevision: primaryDataSource.schemaRevision,
          expectedPropertyRevision: 0,
          name: "Native Core",
          schema: { kind: "text" },
        }],
      } as const;
      const databaseEvents: CoreEventEnvelope[] = [];
      const databaseEventSubscription = await runtime.rootClient.openEventStream(
        runtime.rootClient.handshake.commit_head,
        (event) => databaseEvents.push(event),
        () => undefined,
      );
      const databaseWriteResult = await database.apply(databaseWrite);
      expect(databaseWriteResult).toMatchObject({
        ok: true,
        value: {
          operationId: databaseWrite.operationId,
          duplicate: false,
          operationKinds: ["put_property"],
          affectedDataSourceIds: [primaryDataSource.dataSourceId],
          committedRevisions: {
            [`property:${primaryDataSource.dataSourceId}:${nativePropertyId}`]: 1,
          },
        },
      });
      await waitUntil(
        () => databaseEvents.some((event) =>
          event.packet.manifest.operation_id === databaseWrite.operationId),
        "Core Database event was not published",
      );
      expect(databaseEvents.find((event) =>
        event.packet.manifest.operation_id === databaseWrite.operationId
      )).toMatchObject({
        packet: {
          atoms: expect.arrayContaining([expect.objectContaining({
            descriptor: expect.objectContaining({
              kind: "database_changed",
            }),
            payload: expect.objectContaining({
              module: "database",
              event: expect.objectContaining({ project_id: projectId }),
            }),
          })]),
        },
      });
      await expect(database.apply(databaseWrite)).resolves.toMatchObject({
        ok: true,
        value: {
          operationId: databaseWrite.operationId,
          duplicate: true,
          operationKinds: ["put_property"],
        },
      });
      const updatedDataSource = await database.read({
        projectId,
        read: {
          target: {
            kind: "data_source",
            dataSourceId: primaryDataSource.dataSourceId,
          },
          mode: "data_source",
        },
      });
      if (
        !updatedDataSource.ok
        || updatedDataSource.value.value.kind !== "data_source"
      ) {
        throw new Error("Expected updated Core Data Source descriptor");
      }
      expect(updatedDataSource.value.value.value.properties).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            propertyId: nativePropertyId,
            name: "Native Core",
            revision: 1,
          }),
        ]),
      );
      const libraryDatabase = createCoreLibraryDatabaseModuleAdapter({
        client: runtime.rootClient,
        libraryId: runtime.rootClient.handshake.library_id,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
      });
      const libraryDataSource = await libraryDatabase.read({
        read: {
          target: {
            kind: "data_source",
            dataSourceId: primaryDataSource.dataSourceId,
          },
          mode: "data_source",
        },
      });
      if (
        !libraryDataSource.ok
        || libraryDataSource.value.value.kind !== "data_source"
      ) {
        throw new Error("Expected trusted Library Database read");
      }
      expect("projectId" in libraryDataSource.value).toBe(false);
      const libraryPropertyId = parseDataSourcePropertyId("p_libcore1");
      const libraryDatabaseWrite = await libraryDatabase.apply({
        operationId: "electron-library-database-put-property",
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        operations: [{
          kind: "put_property",
          dataSourceId: primaryDataSource.dataSourceId,
          propertyId: libraryPropertyId,
          expectedDataSourceRevision:
            libraryDataSource.value.value.value.dataSource.schemaRevision,
          expectedPropertyRevision: 0,
          name: "Library Core",
          schema: { kind: "text" },
        }],
      });
      expect(libraryDatabaseWrite).toMatchObject({
        ok: true,
        value: {
          accessContext: { kind: "library" },
          libraryId: runtime.rootClient.handshake.library_id,
          operationId: "electron-library-database-put-property",
          operationKinds: ["put_property"],
        },
      });
      if (!libraryDatabaseWrite.ok) {
        throw new Error("Expected trusted Library Database write");
      }
      expect("projectId" in libraryDatabaseWrite.value).toBe(false);
      await waitUntil(
        () => databaseEvents.some((event) =>
          event.packet.manifest.operation_id
            === "electron-library-database-put-property"),
        "Core Library Database event was not published",
      );
      expect(databaseEvents.find((event) =>
        event.packet.manifest.operation_id === "electron-library-database-put-property"
      )).toMatchObject({
        packet: {
          atoms: expect.arrayContaining([expect.objectContaining({
            descriptor: expect.objectContaining({
              kind: "database_changed",
            }),
            payload: expect.objectContaining({
              module: "database",
              event: expect.objectContaining({ project_id: null }),
            }),
          })]),
        },
      });
      const projectDocuments = createCoreDocumentSyncAdapter(
        runtime.clientForProject(projectId),
      );
      const nativeSourceBlockId = "01981e00-0000-7000-8000-000000000001";
      const nativeSourceDocumentId = "01981e00-0000-7000-8000-000000000002";
      const nativeContentBlockId = "01981e00-0000-7000-8000-000000000003";
      const nativeEmptyBlockId = "01981e00-0000-7000-8000-000000000004";
      const createSyncedSource = {
        operationId: "electron-document-create-synced-source",
        projectId,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        clientSessionId: "renderer:electron-document-owner",
        actor: {
          kind: "electron_renderer",
          clientId: "renderer:electron-document-owner",
        },
        coordination: { kind: "fifo_only" as const },
        operation: {
          kind: "create_synced_source" as const,
          sourceBlockId: nativeSourceBlockId,
          documentId: nativeSourceDocumentId,
          initialBlocks: [{
            id: nativeContentBlockId,
            type: "paragraph",
            props: {},
            content: [{
              type: "text",
              text: "Native Additional Document command",
              styles: {},
            }],
            children: [],
          }, {
            id: nativeEmptyBlockId,
            type: "paragraph",
            props: {},
            content: [],
            children: [],
          }],
          placement: { kind: "library" as const },
        },
      };
      const createdSyncedSource = await projectDocuments
        .applyAdditionalDocumentCommand(createSyncedSource);
      if (!createdSyncedSource.ok) {
        throw new Error(
          `Core Additional Document command failed: ${createdSyncedSource.error.code}: ${createdSyncedSource.error.message}`,
        );
      }
      expect(createdSyncedSource).toMatchObject({
        ok: true,
        value: {
          operationId: createSyncedSource.operationId,
          projectId,
          duplicate: false,
          effect: {
            createdBlockIds: expect.arrayContaining([
              nativeSourceBlockId,
              nativeContentBlockId,
            ]),
            documentHeads: [{
              documentId: nativeSourceDocumentId,
              generation: 1,
              headSeq: 1,
            }],
          },
        },
      });
      const desktopDocuments = createDesktopDocumentSyncBridge({
        authority: Promise.resolve(runtime),
      });
      await expect(desktopDocuments.getOwnedDocumentDescriptor(
        projectId,
        nativeSourceBlockId,
      )).resolves.toMatchObject({
        documentId: nativeSourceDocumentId,
        generation: 1,
        headSeq: 1,
      });
      await expect(projectDocuments.applyAdditionalDocumentCommand(
        createSyncedSource,
      )).resolves.toMatchObject({
        ok: true,
        value: {
          operationId: createSyncedSource.operationId,
          duplicate: true,
        },
      });
      const checkpointRequest = {
        projectId,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        documentId: nativeSourceDocumentId,
        expectedGeneration: 1,
        expectedHeadSeq: 1,
        cause: "manual",
        label: "Native history checkpoint",
        actor: {
          kind: "electron_renderer",
          clientId: "renderer:electron-document-owner",
        },
        revisionKind: "manual" as const,
      };
      const checkpoint = await projectDocuments.createCheckpoint(
        checkpointRequest,
      );
      if (!checkpoint.ok) {
        throw new Error(
          `Core Document checkpoint failed: ${checkpoint.error.code}: ${checkpoint.error.message}`,
        );
      }
      expect(checkpoint).toMatchObject({
        ok: true,
        value: {
          duplicate: false,
          checkpoint: {
            projectId,
            documentId: nativeSourceDocumentId,
            generation: 1,
            baseHeadSeq: 1,
            actor: checkpointRequest.actor,
            revisionKind: "manual",
            materializationKind: "synced_block",
          },
        },
      });
      await expect(
        projectDocuments.createCheckpoint(checkpointRequest),
      ).resolves.toMatchObject({
        ok: true,
        value: { duplicate: true },
      });
      const listedVersions = await projectDocuments.listVersions({
        projectId,
        documentId: nativeSourceDocumentId,
        limit: 20,
      });
      expect(listedVersions).toMatchObject({
        ok: true,
        value: [{ versionId: checkpoint.value.checkpoint.versionId }],
      });
      const versionDetail = await projectDocuments.getVersion({
        projectId,
        documentId: nativeSourceDocumentId,
        versionId: checkpoint.value.checkpoint.versionId,
      });
      expect(versionDetail).toMatchObject({
        ok: true,
        value: {
          summary: { versionId: checkpoint.value.checkpoint.versionId },
          materialization: {
            kind: "synced_block",
            preview: "Native Additional Document command",
          },
        },
      });
      if (
        !versionDetail.ok
        || versionDetail.value.materialization.kind !== "synced_block"
      ) {
        throw new Error("Expected native Synced Block version detail");
      }
      const changeRequest = {
        mutationId: "electron-document-history-change",
        projectId,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        documentId: nativeSourceDocumentId,
        generation: 1,
        expectedHeadSeq: 1,
        clientSessionId: "renderer:electron-document-history",
        actor: {
          kind: "electron_renderer",
          clientId: "renderer:electron-document-history",
        },
        operations: [{
          kind: "delete_block" as const,
          blockId: nativeContentBlockId,
        }],
      };
      const changed = await projectDocuments.applyDocumentMutation(changeRequest);
      expect(changed).toMatchObject({
        ok: true,
        value: {
          mutationId: changeRequest.mutationId,
          headSeq: 2,
          deletedBlockIds: [nativeContentBlockId],
          coordination: "write_fence",
        },
      });
      const restoreRequest = {
        mutationId: "electron-document-history-restore",
        projectId,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        documentId: nativeSourceDocumentId,
        versionId: checkpoint.value.checkpoint.versionId,
        generation: 1,
        expectedHeadSeq: 2,
        clientSessionId: "renderer:electron-document-history",
        actor: {
          kind: "electron_renderer",
          clientId: "renderer:electron-document-history",
        },
      };
      const restored = await projectDocuments.restoreVersion(restoreRequest);
      if (!restored.ok) {
        throw new Error(
          `Core Document restore failed: ${restored.error.code}: ${restored.error.message}`,
        );
      }
      expect(restored).toMatchObject({
        ok: true,
        value: {
          mutationId: restoreRequest.mutationId,
          projectId,
          documentId: nativeSourceDocumentId,
          baseHeadSeq: 2,
          headSeq: 3,
          coordination: "write_fence",
          duplicate: false,
        },
      });
      await expect(projectDocuments.restoreVersion(restoreRequest)).resolves.toMatchObject({
        ok: true,
        value: {
          mutationId: restoreRequest.mutationId,
          headSeq: 3,
          duplicate: true,
        },
      });
      const restoredVersions = await projectDocuments.listVersions({
        projectId,
        documentId: nativeSourceDocumentId,
        limit: 20,
      });
      if (!restoredVersions.ok) {
        throw new Error(
          `Core restored history list failed: ${restoredVersions.error.message}`,
        );
      }
      expect(restoredVersions.value).toHaveLength(4);
      expect(restoredVersions.value).toEqual(expect.arrayContaining([
        expect.objectContaining({
          baseHeadSeq: 2,
          revisionKind: "operation",
          sourceMutationId: changeRequest.mutationId,
        }),
      ]));
      const restoredVersion = restoredVersions.value.find(
        (version) =>
          version.baseHeadSeq === 3
          && version.revisionKind === "restore"
          && version.sourceMutationId === restoreRequest.mutationId,
      );
      if (!restoredVersion) {
        throw new Error("Core history omitted the post-restore checkpoint");
      }
      await expect(projectDocuments.getVersion({
        projectId,
        documentId: nativeSourceDocumentId,
        versionId: restoredVersion.versionId,
      })).resolves.toMatchObject({
        ok: true,
        value: {
          summary: {
            versionId: restoredVersion.versionId,
            sourceMutationId: restoreRequest.mutationId,
          },
          materialization: {
            kind: "synced_block",
            preview: "Native Additional Document command",
          },
        },
      });
      const nativeTargetSourceBlockId = "01981e00-0000-7000-8000-000000000005";
      const nativeTargetDocumentId = "01981e00-0000-7000-8000-000000000006";
      const nativeTargetAnchorBlockId = "01981e00-0000-7000-8000-000000000007";
      const createdTransferTarget = await projectDocuments
        .applyAdditionalDocumentCommand({
          operationId: "electron-block-transfer-create-target",
          projectId,
          storeEpoch: runtime.rootClient.handshake.store_epoch,
          clientSessionId: "renderer:electron-block-transfer",
          actor: {
            kind: "electron_renderer",
            clientId: "renderer:electron-block-transfer",
          },
          coordination: { kind: "fifo_only" },
          operation: {
            kind: "create_synced_source",
            sourceBlockId: nativeTargetSourceBlockId,
            documentId: nativeTargetDocumentId,
            initialBlocks: [{
              id: nativeTargetAnchorBlockId,
              type: "paragraph",
              props: {},
              content: [],
              children: [],
            }],
            placement: { kind: "library" },
          },
        });
      if (!createdTransferTarget.ok) {
        throw new Error(
          `Core Block transfer target creation failed: ${createdTransferTarget.error.message}`,
        );
      }
      const transferAdapter = createCoreBlockTransferAdapter({
        client: runtime.clientForProject(projectId),
        libraryId: runtime.rootClient.handshake.library_id,
        projectId,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
      });
      const transferIntent = {
        operationId: "electron-native-block-transfer",
        projectId,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        clientSessionId: "renderer:electron-block-transfer",
        actor: {
          kind: "electron_renderer",
          clientId: "renderer:electron-block-transfer",
        },
        mode: "move" as const,
        rootBlockIds: [nativeContentBlockId],
        causalDependencies: [],
        source: {
          kind: "document" as const,
          documentId: nativeSourceDocumentId,
        },
        target: {
          kind: "document" as const,
          documentId: nativeTargetDocumentId,
          beforeBlockId: nativeTargetAnchorBlockId,
        },
        promotionPolicy: "literal" as const,
      };
      const transferred = await transferAdapter.commit(transferIntent);
      if (!transferred.ok) {
        throw new Error(
          `Core Block transfer failed: ${transferred.error.code}: ${transferred.error.message}`,
        );
      }
      expect(transferred.value).toMatchObject({
        operationId: transferIntent.operationId,
        duplicate: false,
        resultRootBlockIds: [nativeContentBlockId],
        finalLocations: {
          [nativeContentBlockId]: {
            kind: "document",
            documentId: nativeTargetDocumentId,
          },
        },
        // Delete, snapshot reattachment, and this transfer each advance the
        // canonical placement revision after its genesis revision.
        finalLocationRevisions: { [nativeContentBlockId]: 4 },
        documentCommits: expect.arrayContaining([
          expect.objectContaining({
            documentId: nativeSourceDocumentId,
            baseHeadSeq: 3,
            headSeq: 4,
          }),
          expect.objectContaining({
            documentId: nativeTargetDocumentId,
            baseHeadSeq: 1,
            headSeq: 2,
          }),
        ]),
      });
      await expect(transferAdapter.commit(transferIntent)).resolves
        .toMatchObject({
          ok: true,
          value: {
            operationId: transferIntent.operationId,
            duplicate: true,
            finalLocationRevisions: { [nativeContentBlockId]: 4 },
          },
        });
      const promoteToLibraryIntent = {
        ...transferIntent,
        operationId: "electron-native-block-transfer-promote-to-library",
        source: {
          kind: "document" as const,
          documentId: nativeTargetDocumentId,
        },
        target: {
          kind: "library" as const,
          libraryId: runtime.rootClient.handshake.library_id,
        },
      };
      const promotedToLibrary = await transferAdapter.commit(
        promoteToLibraryIntent,
      );
      if (!promotedToLibrary.ok) {
        throw new Error(
          `Core Library promotion failed: ${promotedToLibrary.error.code}: ${promotedToLibrary.error.message}`,
        );
      }
      expect(promotedToLibrary.value).toMatchObject({
        operationId: promoteToLibraryIntent.operationId,
        duplicate: false,
        resultRootBlockIds: [nativeContentBlockId],
        transformationEvidence: [{
          sourceBlockId: nativeContentBlockId,
          resultPageId: nativeContentBlockId,
          kind: "promote",
          sourceBlockType: "paragraph",
          consumedPropertyKeys: [],
          bodyRootBlockIds: [expect.any(String)],
          sourceToResultBlockIds: {
            [nativeContentBlockId]: nativeContentBlockId,
          },
        }],
        finalLocations: {
          [nativeContentBlockId]: {
            kind: "library",
            libraryId: runtime.rootClient.handshake.library_id,
            rankKey: expect.any(String),
          },
        },
        finalLocationRevisions: { [nativeContentBlockId]: 5 },
        documentCommits: expect.arrayContaining([
          expect.objectContaining({
            documentId: nativeTargetDocumentId,
            baseHeadSeq: 2,
            headSeq: 3,
          }),
          expect.objectContaining({
            baseHeadSeq: 0,
            headSeq: 1,
          }),
        ]),
      });
      const copyToDataSourceIntent = {
        ...transferIntent,
        operationId: "electron-native-block-transfer-copy-to-data-source",
        mode: "copy" as const,
        rootBlockIds: [nativeTargetAnchorBlockId],
        source: {
          kind: "document" as const,
          documentId: nativeTargetDocumentId,
        },
        target: {
          kind: "data_source" as const,
          dataSourceId: primaryDataSource.dataSourceId,
          placement: {
            kind: "direct" as const,
            viewId: primaryView.viewId,
            presentationOverride: { layout: "board" as const },
            groupKey: "ship",
          },
        },
      };
      const copiedToDataSource = await transferAdapter.commit(
        copyToDataSourceIntent,
      );
      if (!copiedToDataSource.ok) {
        throw new Error(
          `Core Data Source copy failed: ${copiedToDataSource.error.code}: ${copiedToDataSource.error.message}`,
        );
      }
      const copiedDataSourcePageId =
        copiedToDataSource.value.resultRootBlockIds[0];
      if (!copiedDataSourcePageId) {
        throw new Error("Core Data Source copy omitted its Page root");
      }
      expect(copiedToDataSource.value).toMatchObject({
        operationId: copyToDataSourceIntent.operationId,
        duplicate: false,
        transformationEvidence: [{
          sourceBlockId: nativeTargetAnchorBlockId,
          resultPageId: copiedDataSourcePageId,
          kind: "promote",
        }],
        finalLocations: {
          [copiedDataSourcePageId]: {
            kind: "data_source",
            databaseBlockId: primaryDatabase.database.databaseId,
            dataSourceId: primaryDataSource.dataSourceId,
          },
        },
        finalLocationRevisions: { [copiedDataSourcePageId]: 2 },
        affectedDatabaseBlockIds: [primaryDatabase.database.databaseId],
      });
      const desktopDatabase = createDesktopDatabaseModuleBridge({
        authority: Promise.resolve(runtime),
      });
      const nativeAgentService = createDesktopNodexAgentV3DynamicService({
        authority: Promise.resolve(runtime),
        projectWorkspace: desktopWorkspace,
        databaseModule: desktopDatabase,
        documentSync: desktopDocuments,
      });
      const nativeAgentContext = await nativeAgentService.registry.execute({
        namespace: NODEX_APP_TOOL_NAMESPACE,
        toolsetRevision: NODEX_APP_TOOLSET_REVISION,
        tool: "get_context",
      }, {
        include: { databases: true },
      }, {
        threadId: "thread-native-context",
        callId: "call-native-context",
        authority: {
          threadId: "thread-native-context",
          turnId: "turn-native-context",
          rootThreadId: "thread-native-context",
          actorProjectId: projectId,
          libraryId: runtime.rootClient.handshake.library_id,
          storeEpoch: runtime.rootClient.handshake.store_epoch,
          scope: "project",
          source: "project_turn",
        },
        access: {
          read: "allowed",
          write: "consent_required",
          domains: ["document", "placement", "database"] as (
            | "document"
            | "placement"
            | "database"
          )[],
        },
        resolveResourceAccess: async () => ({ kind: "authorized" }),
        authorize: async () => "deny",
      });
      expect(nativeAgentContext.output).toMatchObject({
        data: {
          project: {
            projectId,
            libraryId: runtime.rootClient.handshake.library_id,
          },
          databases: expect.arrayContaining([
            expect.objectContaining({
              databaseId: primaryDatabase.database.databaseId,
              isBound: true,
            }),
          ]),
        },
      });
      const nativeWindow = await desktopDatabase.getDatabaseViewWindow(
        projectId,
        { first: 200 },
      );
      expect(nativeWindow.board.columns.find((column) => column.id === "ship")?.cards)
        .toEqual(expect.arrayContaining([
          expect.objectContaining({
            id: copiedDataSourcePageId,
            status: "ship",
            hasDescription: false,
          }),
        ]));
      const scopedWindow = await desktopDatabase.getDatabaseViewWindow(
        projectId,
        {
          first: 200,
          groupScope: { kind: "path", groupKey: "ship", subgroupKey: null },
        },
      );
      expect(scopedWindow.rows.length).toBeGreaterThan(0);
      expect(
        scopedWindow.rows.every((row) => row.groupKey === "ship"),
      ).toBe(true);
      const nativeGroups = await desktopDatabase.getDatabaseViewGroups(
        projectId,
        {},
      );
      expect(nativeGroups.grouped).toBe(true);
      expect(nativeGroups.totalRows).toBeGreaterThan(0);
      expect(
        nativeGroups.groups.find((group) => group.groupKey === "ship")
          ?.totalRows,
      ).toBe(scopedWindow.rows.length);
      await expect(desktopDatabase.getDatabaseRowPage(
        projectId,
        copiedDataSourcePageId,
        "ship",
      )).resolves.toMatchObject({
        id: copiedDataSourcePageId,
        status: "ship",
        order: 1,
      });
      const lifecycleLibrary = createCoreLibraryModuleAdapter({
        client: runtime.clientForProject(projectId),
        libraryId: runtime.rootClient.handshake.library_id,
        profileId: runtime.rootClient.handshake.generation.profile_id,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
      });
      const lifecyclePreflight = await lifecycleLibrary.readPageLifecyclePreflight(
        projectId,
        copiedDataSourcePageId,
      );
      if (!lifecyclePreflight.ok) {
        throw new Error(
          `Core Page lifecycle preflight failed: ${lifecyclePreflight.error.code}: ${lifecyclePreflight.error.message}`,
        );
      }
      expect(lifecyclePreflight).toMatchObject({
        ok: true,
        value: {
          projectId,
          value: {
            tagsProperty: { propertyId: "tags" },
            page: {
              pageId: copiedDataSourcePageId,
              lifecycle: "active",
              parent: {
                kind: "data_source",
                dataSourceId: primaryDataSource.dataSourceId,
              },
              membership: {
                status: "ship",
                viewId: primaryView.viewId,
                position: { rankKey: expect.any(String), revision: 1 },
              },
            },
          },
        },
      });
      const initialLifecyclePage = lifecyclePreflight.value.value.page;
      if (!initialLifecyclePage) {
        throw new Error("Expected native Page lifecycle authority");
      }
      const lifecycleRequestBase = {
        projectId,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        actor: { kind: "electron_renderer", clientId: "rust-authority-test" },
      };
      const databasePropertyMutation = await database.apply({
        operationId: "electron-page-property-database",
        projectId,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        actor: lifecycleRequestBase.actor,
        operations: [{
          kind: "edit_property_values",
          edits: [{
            pageId: copiedDataSourcePageId,
            dataSourceId: primaryDataSource.dataSourceId,
            propertyId: parseDataSourcePropertyId("assignee"),
            edit: {
              kind: "replace",
              expectedValueRevision: 1,
              value: { kind: "text", value: "native-core" },
            },
          }],
        }],
      });
      if (!databasePropertyMutation.ok) {
        throw new Error(databasePropertyMutation.error.message);
      }
      const propertyMutation = await lifecycleLibrary.applyBlockPropertyMutation({
        mutationId: "electron-page-property-mixed",
        projectId,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        clientSessionId: "rust-authority-test",
        actor: lifecycleRequestBase.actor,
        fields: [{
          scope: "intrinsic",
          blockId: copiedDataSourcePageId,
          propertyKey: "run.target",
          operation: "set",
          expectedRevision: 1,
          value: "cloud",
        }],
      });
      if (!propertyMutation.ok) {
        throw new Error(
          `Core Page Property mutation failed: ${propertyMutation.error.code}: ${propertyMutation.error.message}`,
        );
      }
      expect(propertyMutation).toMatchObject({
        ok: true,
        value: {
          duplicate: false,
          fields: [{ scope: "intrinsic", propertyKey: "run.target", revision: 2 }],
        },
      });
      await expect(database.apply({
        operationId: "electron-page-property-database",
        projectId,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        actor: lifecycleRequestBase.actor,
        operations: [{
          kind: "edit_property_values",
          edits: [{
            pageId: copiedDataSourcePageId,
            dataSourceId: primaryDataSource.dataSourceId,
            propertyId: parseDataSourcePropertyId("assignee"),
            edit: {
              kind: "replace",
              expectedValueRevision: 1,
              value: { kind: "text", value: "native-core" },
            },
          }],
        }],
      })).resolves.toMatchObject({ ok: true, value: { duplicate: true } });
      const propertyReplay = await lifecycleLibrary.applyBlockPropertyMutation({
        mutationId: "electron-page-property-mixed",
        projectId,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        clientSessionId: "rust-authority-test",
        actor: lifecycleRequestBase.actor,
        fields: [{
          scope: "intrinsic",
          blockId: copiedDataSourcePageId,
          propertyKey: "run.target",
          operation: "set",
          expectedRevision: 1,
          value: "cloud",
        }],
      });
      expect(propertyReplay).toMatchObject({
        ok: true,
        value: { duplicate: true },
      });
      const archived = await lifecycleLibrary.applyPageLifecycleMutation({
        ...lifecycleRequestBase,
        operationId: "electron-page-lifecycle-archive",
        operation: {
          kind: "archive_page",
          pageId: copiedDataSourcePageId,
          expectedMetadataRevision:
            propertyMutation.value.blockMetadataRevisions[copiedDataSourcePageId],
        },
      });
      expect(archived).toMatchObject({
        ok: true,
        value: { lifecycle: "archived", duplicate: false },
      });
      if (!archived.ok) throw new Error(archived.error.message);
      await expect(desktopDatabase.getDatabaseRowPage(
        projectId,
        copiedDataSourcePageId,
        "ship",
      )).resolves.toMatchObject({ archived: true });
      const unarchived = await lifecycleLibrary.applyPageLifecycleMutation({
        ...lifecycleRequestBase,
        operationId: "electron-page-lifecycle-unarchive",
        operation: {
          kind: "unarchive_page",
          pageId: copiedDataSourcePageId,
          expectedMetadataRevision: archived.value.metadataRevision,
        },
      });
      expect(unarchived).toMatchObject({
        ok: true,
        value: { lifecycle: "active" },
      });
      if (!unarchived.ok) throw new Error(unarchived.error.message);
      const deleteRequest = {
        ...lifecycleRequestBase,
        operationId: "electron-page-lifecycle-delete",
        operation: {
          kind: "delete_page" as const,
          pageId: copiedDataSourcePageId,
          expectedMetadataRevision: unarchived.value.metadataRevision,
          expectedParentRevision: unarchived.value.parentRevision,
        },
      };
      const deleted = await lifecycleLibrary.applyPageLifecycleMutation(
        deleteRequest,
      );
      expect(deleted).toMatchObject({
        ok: true,
        value: { lifecycle: "deleted" },
      });
      if (!deleted.ok) throw new Error(deleted.error.message);
      const deletedPreflight = await lifecycleLibrary.readPageLifecyclePreflight(
        projectId,
        copiedDataSourcePageId,
      );
      if (!deletedPreflight.ok) {
        throw new Error(deletedPreflight.error.message);
      }
      const restoreEvidence = deletedPreflight.value.value.page?.restoreEvidence;
      if (!restoreEvidence) {
        throw new Error("Native delete receipt did not compile restore evidence");
      }
      const lifecycleRestored = await lifecycleLibrary.applyPageLifecycleMutation({
        ...lifecycleRequestBase,
        operationId: "electron-page-lifecycle-restore",
        operation: {
          kind: "restore_page",
          pageId: copiedDataSourcePageId,
          deleteOperationId: restoreEvidence.deleteOperationId,
          expectedMetadataRevision: deleted.value.metadataRevision,
          expectedParentRevision: deleted.value.parentRevision,
          membership: restoreEvidence.membership,
        },
      });
      expect(lifecycleRestored).toMatchObject({
        ok: true,
        value: {
          lifecycle: "active",
          membershipId: restoreEvidence.membership?.membershipId,
        },
      });
      const replayedDelete = await lifecycleLibrary.applyPageLifecycleMutation(
        deleteRequest,
      );
      expect(replayedDelete).toMatchObject({
        ok: true,
        value: { lifecycle: "deleted", duplicate: true },
      });
      const afterDeleteReplay = await lifecycleLibrary.readPageLifecyclePreflight(
        projectId,
        copiedDataSourcePageId,
      );
      if (!afterDeleteReplay.ok) {
        throw new Error(afterDeleteReplay.error.message);
      }
      const restoredMembershipRevision =
        afterDeleteReplay.value.value.page?.membership?.membershipRevision;
      const restoredParentRevision =
        afterDeleteReplay.value.value.page?.parentRevision;
      expect(afterDeleteReplay).toMatchObject({
        ok: true,
        value: {
          value: {
            page: {
              lifecycle: "active",
              membership: {
                membershipId: restoreEvidence.membership?.membershipId,
                membershipRevision: 3,
                position: { rankKey: expect.any(String) },
              },
            },
          },
        },
      });
      if (!restoredMembershipRevision || !restoredParentRevision) {
        throw new Error("Restored Page has no durable parent or membership revision");
      }
      await expect(desktopDatabase.getDatabaseRowPage(
        projectId,
        copiedDataSourcePageId,
        "ship",
      )).resolves.toMatchObject({ archived: false });
      await expect(desktopDatabase.resolveDatabaseViewReference({
        accessContext: { kind: "project", projectId },
        databaseViewId: primaryView.viewId,
        hostBlockId: copiedDataSourcePageId,
      })).resolves.toMatchObject({
        view: {
          id: primaryView.viewId,
          databaseBlockId: primaryDatabase.database.databaseId,
          projectId,
          isPrimary: true,
        },
        rows: expect.not.arrayContaining([
          expect.objectContaining({
            page: expect.objectContaining({ id: copiedDataSourcePageId }),
          }),
        ]),
      });
      await expect(desktopDatabase.resolveDatabaseViewReference({
        accessContext: { kind: "library" },
        databaseViewId: primaryView.viewId,
        hostBlockId: copiedDataSourcePageId,
      })).resolves.toMatchObject({
        view: {
          id: primaryView.viewId,
          projectId: null,
        },
      });
      expect(listCurrentProcessFiles()).not.toContain(databasePath);
      const moveDataSourcePageToLibraryIntent = {
        ...transferIntent,
        operationId: "electron-native-page-transfer-to-library",
        mode: "move" as const,
        rootBlockIds: [copiedDataSourcePageId],
        source: {
          kind: "data_source" as const,
          dataSourceId: primaryDataSource.dataSourceId,
        },
        target: {
          kind: "library" as const,
          libraryId: runtime.rootClient.handshake.library_id,
        },
      };
      const movedPageToLibrary = await transferAdapter.commit(
        moveDataSourcePageToLibraryIntent,
      );
      if (!movedPageToLibrary.ok) {
        throw new Error(
          `Core Data Source Page move failed: ${movedPageToLibrary.error.code}: ${movedPageToLibrary.error.message}`,
        );
      }
      expect(movedPageToLibrary.value).toMatchObject({
        resultRootBlockIds: [copiedDataSourcePageId],
        finalLocations: {
          [copiedDataSourcePageId]: {
            kind: "library",
            libraryId: runtime.rootClient.handshake.library_id,
          },
        },
        finalLocationRevisions: {
          [copiedDataSourcePageId]: restoredParentRevision + 1,
        },
        documentCommits: [],
        affectedDatabaseBlockIds: [primaryDatabase.database.databaseId],
      });
      const moveLibraryPageToDataSourceIntent = {
        ...moveDataSourcePageToLibraryIntent,
        operationId: "electron-native-page-transfer-to-data-source",
        source: {
          kind: "library" as const,
          libraryId: runtime.rootClient.handshake.library_id,
        },
        target: {
          kind: "data_source" as const,
          dataSourceId: primaryDataSource.dataSourceId,
          placement: {
            kind: "direct" as const,
            viewId: primaryView.viewId,
            presentationOverride: { layout: "board" as const },
            groupKey: "ship",
          },
        },
      };
      const returnedPageToDataSource = await transferAdapter.commit(
        moveLibraryPageToDataSourceIntent,
      );
      if (!returnedPageToDataSource.ok) {
        throw new Error(
          `Core Library Page move failed: ${returnedPageToDataSource.error.code}: ${returnedPageToDataSource.error.message}`,
        );
      }
      expect(returnedPageToDataSource.value).toMatchObject({
        finalLocations: {
          [copiedDataSourcePageId]: {
            kind: "data_source",
            databaseBlockId: primaryDatabase.database.databaseId,
            dataSourceId: primaryDataSource.dataSourceId,
          },
        },
        finalLocationRevisions: {
          [copiedDataSourcePageId]: restoredParentRevision + 2,
        },
        documentCommits: [],
      });
      const moveDataSourcePageIntoPageIntent = {
        ...moveLibraryPageToDataSourceIntent,
        operationId: "electron-native-page-transfer-into-page",
        source: {
          kind: "data_source" as const,
          dataSourceId: primaryDataSource.dataSourceId,
        },
        target: {
          kind: "page" as const,
          pageId: nativeContentBlockId,
        },
      };
      const nestedPage = await transferAdapter.commit(
        moveDataSourcePageIntoPageIntent,
      );
      if (!nestedPage.ok) {
        throw new Error(
          `Core Page nesting failed: ${nestedPage.error.code}: ${nestedPage.error.message}`,
        );
      }
      expect(nestedPage.value).toMatchObject({
        finalLocations: {
          [copiedDataSourcePageId]: {
            kind: "document",
            documentId: expect.any(String),
          },
        },
        finalLocationRevisions: {
          [copiedDataSourcePageId]: restoredParentRevision + 3,
        },
        documentCommits: [{ documentId: expect.any(String) }],
      });
      const copyRecursivePageIntent = {
        ...moveDataSourcePageIntoPageIntent,
        operationId: "electron-native-recursive-page-copy-to-library",
        mode: "copy" as const,
        rootBlockIds: [nativeContentBlockId],
        source: {
          kind: "library" as const,
          libraryId: runtime.rootClient.handshake.library_id,
        },
        target: {
          kind: "library" as const,
          libraryId: runtime.rootClient.handshake.library_id,
        },
      };
      const copiedRecursivePage = await transferAdapter.commit(
        copyRecursivePageIntent,
      );
      if (!copiedRecursivePage.ok) {
        throw new Error(
          `Core recursive Page copy failed: ${copiedRecursivePage.error.code}: ${copiedRecursivePage.error.message}`,
        );
      }
      const copiedRecursiveRootId =
        copiedRecursivePage.value.copiedBlockIds[nativeContentBlockId];
      const copiedRecursiveChildId =
        copiedRecursivePage.value.copiedBlockIds[copiedDataSourcePageId];
      if (!copiedRecursiveRootId || !copiedRecursiveChildId) {
        throw new Error("Core recursive Page copy omitted ownership mappings");
      }
      expect(copiedRecursivePage.value).toMatchObject({
        resultRootBlockIds: [copiedRecursiveRootId],
        finalLocations: {
          [copiedRecursiveRootId]: {
            kind: "library",
            libraryId: runtime.rootClient.handshake.library_id,
          },
        },
        copiedBlockIds: {
          [nativeContentBlockId]: copiedRecursiveRootId,
          [copiedDataSourcePageId]: copiedRecursiveChildId,
        },
      });
      expect(copiedRecursivePage.value.documentCommits.length).toBeGreaterThanOrEqual(2);
      const sourceBodyRootId =
        promotedToLibrary.value.transformationEvidence[0]?.bodyRootBlockIds[0];
      const nestedCopyParentBlockId = sourceBodyRootId
        ? copiedRecursivePage.value.copiedBlockIds[sourceBodyRootId]
        : undefined;
      if (!nestedCopyParentBlockId) {
        throw new Error("Core recursive Page copy omitted its target body root mapping");
      }
      const nestedMultiPageCopyIntent = {
        ...copyRecursivePageIntent,
        operationId: "electron-native-nested-multi-page-copy",
        rootBlockIds: [nativeContentBlockId, copiedRecursiveRootId],
        target: {
          kind: "page" as const,
          pageId: copiedRecursiveRootId,
          parentBlockId: nestedCopyParentBlockId,
        },
      };
      const nestedMultiPageCopy = await transferAdapter.commit(
        nestedMultiPageCopyIntent,
      );
      if (!nestedMultiPageCopy.ok) {
        throw new Error(
          `Core nested multi-Page copy failed: ${nestedMultiPageCopy.error.code}: ${nestedMultiPageCopy.error.message}`,
        );
      }
      expect(nestedMultiPageCopy.value.resultRootBlockIds).toHaveLength(2);
      const nestedCopyTarget = nestedMultiPageCopy.value.finalLocations[
        nestedMultiPageCopy.value.resultRootBlockIds[0]!
      ];
      if (nestedCopyTarget?.kind !== "document") {
        throw new Error("Core nested multi-Page copy omitted its target Document");
      }
      for (const resultPageId of nestedMultiPageCopy.value.resultRootBlockIds) {
        expect(nestedMultiPageCopy.value.finalLocations[resultPageId]).toEqual({
          kind: "document",
          documentId: nestedCopyTarget.documentId,
        });
      }
      expect(
        nestedMultiPageCopy.value.documentCommits.filter(
          (commit) => commit.documentId === nestedCopyTarget.documentId,
        ),
      ).toHaveLength(1);
      const moveNestedPageToLibraryIntent = {
        ...moveDataSourcePageIntoPageIntent,
        operationId: "electron-native-nested-page-transfer-to-library",
        source: {
          kind: "page" as const,
          pageId: nativeContentBlockId,
        },
        target: {
          kind: "library" as const,
          libraryId: runtime.rootClient.handshake.library_id,
        },
      };
      const returnedNestedPage = await transferAdapter.commit(
        moveNestedPageToLibraryIntent,
      );
      if (!returnedNestedPage.ok) {
        throw new Error(
          `Core nested Page return failed: ${returnedNestedPage.error.code}: ${returnedNestedPage.error.message}`,
        );
      }
      expect(returnedNestedPage.value).toMatchObject({
        finalLocations: {
          [copiedDataSourcePageId]: {
            kind: "library",
            libraryId: runtime.rootClient.handshake.library_id,
          },
        },
        finalLocationRevisions: {
          [copiedDataSourcePageId]: restoredParentRevision + 4,
        },
        documentCommits: [{ documentId: expect.any(String) }],
      });
      databaseEventSubscription.close();
      expect(listCurrentProcessFiles()).not.toContain(databasePath);
      const workspace = createCoreProjectWorkspaceAdapter(runtime.rootClient);
      const createdProject = await workspace.createProject({
        name: "Electron Workspace Adapter",
        sources: [nodexHome],
      });
      const createdSession = await workspace.createProjectSession({
        projectId: createdProject.id,
        noThreadFallbackTitle: "Electron Session Adapter",
      });
      const pinnedSession = await workspace.setProjectSessionPinned(
        createdSession.id,
        { pinned: true },
      );
      expect(pinnedSession).toMatchObject({
        id: createdSession.id,
        pinned: true,
      });
      await expect(workspace.updateProjectSession(createdSession.id, {
        noThreadFallbackTitle: "Electron Session Updated",
      })).resolves.toMatchObject({
        noThreadFallbackTitle: "Electron Session Updated",
      });
      await expect(
        workspace.setPinnedProjectSessionOrder(createdProject.id, {
          orderedSessionIds: [createdSession.id],
        }),
      ).resolves.toBeUndefined();
      await expect(
        workspace.getProjectSession(createdSession.id),
      ).resolves.toMatchObject({
        id: createdSession.id,
        pinnedOrder: 0,
      });
      const threadTimestamp = Date.now();
      await expect(workspace.upsertProjectSessionThreadLink({
        sessionId: createdSession.id,
        projectId: createdProject.id,
        threadId: "thread:electron-session",
        threadSource: "user",
        serviceName: "electron-session",
        agentNickname: "@Session",
        agentRole: "launcher",
        agentPath: "agents/session-launcher",
        threadName: "Electron linked Thread",
        threadPreview: "Native Session attach",
        modelProvider: "openai",
        cwd: nodexHome,
        statusType: "idle",
        statusActiveFlags: [],
        createdAt: threadTimestamp,
        updatedAt: threadTimestamp,
      })).resolves.toMatchObject({
        sessionId: createdSession.id,
        projectId: createdProject.id,
        threadId: "thread:electron-session",
        threadName: "Electron linked Thread",
      });
      const attachedSessionThread = await workspace.getThread(
        "thread:electron-session",
      );
      expect(attachedSessionThread).toMatchObject({
        threadSource: "user",
        serviceName: "electron-session",
        agentNickname: "@Session",
        agentRole: "launcher",
        agentPath: "agents/session-launcher",
      });
      await expect(workspace.replaceThreadDynamicToolCatalogs(
        "thread:electron-session",
        [
          { namespace: "codex_app", toolsetRevision: 2 },
          { namespace: "nodex_app", toolsetRevision: 1 },
        ],
      )).resolves.toEqual([
        { namespace: "codex_app", toolsetRevision: 2 },
        { namespace: "nodex_app", toolsetRevision: 1 },
      ]);
      await expect(
        workspace.readThreadExecutionContext("thread:electron-session"),
      ).resolves.toMatchObject({
        threadId: "thread:electron-session",
        projectId: createdProject.id,
        dynamicToolCatalogs: [
          { namespace: "codex_app", toolsetRevision: 2 },
          { namespace: "nodex_app", toolsetRevision: 1 },
        ],
      });
      await expect(
        workspace.readProjectPermissionMode(createdProject.id),
      ).resolves.toBeNull();
      await expect(workspace.setProjectPermissionMode(
        createdProject.id,
        "guardian-approvals",
      )).resolves.toBe("guardian-approvals");
      await expect(
        workspace.readProjectPermissionMode(createdProject.id),
      ).resolves.toBe("guardian-approvals");
      const sharedWritableRoot = path.join(nodexHome, "shared-workspace");
      await expect(workspace.replaceThreadWritableRoots(
        "thread:electron-session",
        [nodexHome],
      )).resolves.toEqual([nodexHome]);
      await expect(workspace.mergeThreadWritableRoots(
        "thread:electron-session",
        [sharedWritableRoot, nodexHome],
      )).resolves.toEqual([nodexHome, sharedWritableRoot]);
      await expect(
        workspace.readThreadExecutionContext("thread:electron-session"),
      ).resolves.toMatchObject({
        writableRoots: [nodexHome, sharedWritableRoot],
      });
      await expect(workspace.upsertThread("thread:electron-session", {
        agentNickname: "@Electron",
        agentRole: "worker",
        agentPath: "agents/electron",
      })).resolves.toMatchObject({
        agentNickname: "@Electron",
        agentRole: "worker",
        agentPath: "agents/electron",
      });
      await expect(workspace.updateThread("thread:electron-session", {
        threadName: "Electron metadata Thread",
        status: { statusType: "idle", activeFlags: [] },
      })).resolves.toMatchObject({
        threadName: "Electron metadata Thread",
        statusType: "idle",
        agentPath: "agents/electron",
      });
      const moveTargetRoot = path.join(nodexHome, "move-target");
      const moveTargetProject = await workspace.createProject({
        name: "Electron Thread Move Target",
        sources: [moveTargetRoot],
      });
      const moveSession = await workspace.createProjectSession({
        projectId: createdProject.id,
        noThreadFallbackTitle: "Electron native move",
      });
      await workspace.upsertProjectSessionThreadLink({
        sessionId: moveSession.id,
        projectId: createdProject.id,
        threadId: "thread:electron-native-move",
        threadName: "Electron native move",
        threadPreview: "Atomic Thread aggregate move",
        modelProvider: "openai",
        cwd: nodexHome,
        statusType: "idle",
        statusActiveFlags: [],
        createdAt: threadTimestamp + 2,
        updatedAt: threadTimestamp + 2,
      });
      await expect(workspace.moveThread({
        threadId: "thread:electron-native-move",
        sourceProjectId: createdProject.id,
        targetProjectId: moveTargetProject.id,
        useDefaultOrder: true,
        runtimeWorkspaceRoots: [moveTargetRoot, nodexHome],
        projectAccessGrant: {
          expectedTargetBindingRevision: moveTargetProject.bindingRevision,
          missingProjectSources: [nodexHome],
        },
        metadata: {
          cwd: moveTargetRoot,
          managedWorktreePath: null,
          projectlessOutputDirectory: null,
          projectlessWorkspaceBrowserRoot: null,
        },
      })).resolves.toMatchObject({
        thread: {
          threadId: "thread:electron-native-move",
          projectId: moveTargetProject.id,
          sessionId: moveSession.id,
          cwd: moveTargetRoot,
        },
      });
      await expect(workspace.getProjectSession(moveSession.id)).resolves.toMatchObject({
        projectId: moveTargetProject.id,
      });
      await expect(
        workspace.readThreadExecutionContext("thread:electron-native-move"),
      ).resolves.toMatchObject({
        projectId: moveTargetProject.id,
        writableRoots: [moveTargetRoot, nodexHome],
      });
      await expect(workspace.getProject(moveTargetProject.id)).resolves.toMatchObject({
        bindingRevision: moveTargetProject.bindingRevision + 1,
        sources: [
          { root: moveTargetRoot, order: 0 },
          { root: nodexHome, order: 1 },
        ],
      });
      const projectlessSession = await workspace.createProjectSession({
        projectId: null,
        noThreadFallbackTitle: "Projectless sidebar order",
      });
      await workspace.upsertProjectSessionThreadLink({
        sessionId: projectlessSession.id,
        projectId: null,
        threadId: "thread:electron-projectless-order",
        threadName: "Projectless ordered Thread",
        threadPreview: "Native projectless ordering",
        modelProvider: "openai",
        cwd: nodexHome,
        statusType: "idle",
        statusActiveFlags: [],
        createdAt: threadTimestamp + 3,
        updatedAt: threadTimestamp + 3,
      });
      await workspace.setThreadPinned(
        "thread:electron-projectless-order",
        true,
      );
      await expect(workspace.setThreadPinned(
        "thread:electron-session",
        true,
        "thread:electron-projectless-order",
      )).resolves.toMatchObject({
        threads: [expect.objectContaining({
          threadId: "thread:electron-session",
          pinnedOrder: 0,
        })],
      });
      await expect(
        workspace.getProjectSession(createdSession.id),
      ).resolves.toMatchObject({ pinned: true });
      await expect(workspace.setThreadPinned(
        "thread:electron-session",
        false,
      )).resolves.toMatchObject({
        threads: expect.arrayContaining([
          expect.objectContaining({
            threadId: "thread:electron-session",
            pinnedOrder: null,
          }),
        ]),
      });
      await expect(
        workspace.getProjectSession(createdSession.id),
      ).resolves.toMatchObject({ pinned: false });
      await expect(workspace.setThreadPinned(
        "thread:electron-session",
        true,
        null,
      )).resolves.toMatchObject({
        threads: expect.arrayContaining([
          expect.objectContaining({
            threadId: "thread:electron-session",
            pinnedOrder: 1,
          }),
        ]),
      });
      await expect(workspace.reorderPinnedThreads([
        "thread:electron-session",
      ])).resolves.toMatchObject({
        threads: [],
      });
      await expect(workspace.setThreadUnread(
        "thread:electron-session",
        true,
      )).resolves.toMatchObject({
        threadId: "thread:electron-session",
        hasUnreadTurn: true,
      });
      await expect(
        workspace.getProjectSession(createdSession.id),
      ).resolves.toMatchObject({ unread: true });
      await expect(workspace.setThreadUnread(
        "thread:electron-session",
        false,
      )).resolves.toMatchObject({
        threadId: "thread:electron-session",
        hasUnreadTurn: false,
      });
      await expect(
        workspace.getProjectSession(createdSession.id),
      ).resolves.toMatchObject({ unread: false });
      await expect(workspace.setThreadArchived(
        "thread:electron-projectless-order",
        true,
      )).resolves.toMatchObject({
        threads: expect.not.arrayContaining([
          expect.objectContaining({
            threadId: "thread:electron-projectless-order",
          }),
        ]),
      });
      await expect(
        workspace.getProjectSession(projectlessSession.id),
      ).resolves.toMatchObject({
        archived: true,
        pinned: false,
        unread: false,
      });
      await expect(workspace.setThreadArchived(
        "thread:electron-projectless-order",
        false,
      )).resolves.toMatchObject({
        threads: [],
      });
      await expect(
        workspace.getProjectSession(projectlessSession.id),
      ).resolves.toMatchObject({ archived: false });
      await expect(workspace.deleteThread(
        "thread:electron-projectless-order",
      )).resolves.toMatchObject({
        deleted: true,
        sidebar: {
          threads: expect.not.arrayContaining([
            expect.objectContaining({
              threadId: "thread:electron-projectless-order",
            }),
          ]),
        },
      });
      await expect(
        workspace.getProjectSession(projectlessSession.id),
      ).resolves.toMatchObject({ archived: true, thread: null });
      const backgroundProcess = {
        id: "thread:electron-session:item:dev-server",
        threadId: "thread:electron-session",
        threadTitle: "Electron linked Thread",
        itemId: "item:dev-server",
        turnId: "turn:dev-server",
        command: "pnpm dev",
        cwd: nodexHome,
        processId: "process:dev-server",
        osPid: 4812,
        terminalSessionId: null,
        source: "app-server" as const,
        startedAtMs: threadTimestamp + 1,
        updatedAtMs: threadTimestamp + 2,
      };
      await expect(
        workspace.upsertBackgroundProcess(backgroundProcess),
      ).resolves.toEqual(backgroundProcess);
      await expect(
        workspace.listBackgroundProcesses("thread:electron-session"),
      ).resolves.toEqual([backgroundProcess]);
      expect(listCurrentProcessFiles()).not.toContain(databasePath);
      await expect(
        workspace.detachProjectSessionThread(createdSession.id),
      ).resolves.toBe(true);
      await expect(
        workspace.getProjectSession(createdSession.id),
      ).resolves.toMatchObject({ thread: null });
      const turnAuthority = createDesktopNodexAgentAuthorityPort({
        authority: Promise.resolve(runtime),
      });
      const authorityLaunch = await turnAuthority.beginTurn({
        threadId: "thread:electron-session",
        rootThreadId: "thread:electron-session",
        actorProjectId: createdProject.id,
        builtinFullAccess: false,
      });
      const frozenAuthority = await turnAuthority.bindTurn(
        authorityLaunch,
        "turn:electron-session",
      );
      expect(frozenAuthority).toMatchObject({
        threadId: "thread:electron-session",
        turnId: "turn:electron-session",
        rootThreadId: "thread:electron-session",
        actorProjectId: createdProject.id,
        scope: "project",
        source: "project_turn",
      });
      if (!frozenAuthority) {
        throw new Error("Core did not freeze the Agent Turn authority");
      }
      await expect(turnAuthority.capturePersisted({
        threadId: "thread:electron-session",
        turnId: "turn:electron-session",
        rootThreadId: "thread:electron-session",
        actorProjectId: createdProject.id,
      })).resolves.toMatchObject({
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        libraryId: runtime.rootClient.handshake.library_id,
      });
      const agentResources = createDesktopNodexAgentResourceAuthorityPort({
        authority: Promise.resolve(runtime),
      });
      const consentPlan = await agentResources.plan({
        authority: frozenAuthority,
        callId: "call:electron-session",
        intents: [{
          target: { kind: "page", pageId: copiedDataSourcePageId },
          action: "write",
        }],
      });
      expect(consentPlan).toMatchObject({
        kind: "consent_required",
        requirements: [{
          grant: {
            root: { kind: "page", pageId: copiedDataSourcePageId },
            access: "read_write",
          },
          persistable: true,
        }],
      });
      if (consentPlan.kind !== "consent_required") {
        throw new Error("Foreign Page did not require Project consent");
      }
      await agentResources.persistProjectGrants({
        operationId: "electron-agent-project-grants",
        authority: frozenAuthority,
        grants: consentPlan.requirements.map((requirement) => requirement.grant),
      });
      await expect(agentResources.plan({
        authority: frozenAuthority,
        callId: "call:electron-session-after-grant",
        intents: [{
          target: { kind: "page", pageId: copiedDataSourcePageId },
          action: "write",
        }],
      })).resolves.toEqual({ kind: "authorized" });
      const nativeDuplicateContext = {
        threadId: frozenAuthority.threadId,
        callId: "call:electron-native-duplicate",
        authority: frozenAuthority,
        access: {
          read: "allowed" as const,
          write: "consent_required" as const,
          domains: ["document", "placement", "database"] as (
            | "document"
            | "placement"
            | "database"
          )[],
        },
        resolveResourceAccess: async (
          intents: Parameters<typeof agentResources.plan>[0]["intents"],
        ) => await agentResources.plan({
          authority: frozenAuthority,
          callId: "call:electron-native-duplicate",
          intents,
        }),
        authorize: async () => "deny" as const,
      };
      const nativeCreateContext = {
        ...nativeDuplicateContext,
        callId: "call:electron-native-create-pages",
        resolveResourceAccess: async (
          intents: Parameters<typeof agentResources.plan>[0]["intents"],
        ) => await agentResources.plan({
          authority: frozenAuthority,
          callId: "call:electron-native-create-pages",
          intents,
        }),
      };
      const nativeCreateInput = {
        destination: {
          kind: "page" as const,
          pageId: copiedDataSourcePageId,
          at: { kind: "end" as const },
        },
        pages: [{
          title: "**Native first**",
          markdown: "First native body",
        }, {
          title: "Native second",
          markdown: "Second native body",
        }],
        return: ["block_ids" as const, "etags" as const],
      };
      const nativeCreated = await nativeAgentService.registry.execute({
        namespace: NODEX_APP_TOOL_NAMESPACE,
        toolsetRevision: NODEX_APP_TOOLSET_REVISION,
        tool: "create_pages",
      }, nativeCreateInput, nativeCreateContext);
      expect(nativeCreated).toMatchObject({
        effect: "write",
        output: {
          data: {
            created: 2,
            pages: [{
              pageId: expect.any(String),
              location: { kind: "page", pageId: copiedDataSourcePageId },
              bodyBlocksCreated: 1,
              blockIds: [expect.any(String)],
              etags: {
                title: expect.stringMatching(/^nxe1\./u),
                body: expect.stringMatching(/^nxe1\./u),
              },
            }, {
              pageId: expect.any(String),
              location: { kind: "page", pageId: copiedDataSourcePageId },
              bodyBlocksCreated: 1,
              blockIds: [expect.any(String)],
              etags: {
                title: expect.stringMatching(/^nxe1\./u),
                body: expect.stringMatching(/^nxe1\./u),
              },
            }],
          },
        },
      });
      await expect(nativeAgentService.registry.execute({
        namespace: NODEX_APP_TOOL_NAMESPACE,
        toolsetRevision: NODEX_APP_TOOLSET_REVISION,
        tool: "create_pages",
      }, nativeCreateInput, nativeCreateContext)).resolves.toEqual(nativeCreated);
      const nativeMoveContext = {
        ...nativeDuplicateContext,
        callId: "call:electron-native-move-pages",
        resolveResourceAccess: async (
          intents: Parameters<typeof agentResources.plan>[0]["intents"],
        ) => await agentResources.plan({
          authority: frozenAuthority,
          callId: "call:electron-native-move-pages",
          intents,
        }),
      };
      const moveTargetConsent = await agentResources.plan({
        authority: frozenAuthority,
        callId: "call:electron-native-move-target-consent",
        intents: [{
          target: { kind: "page", pageId: nativeContentBlockId },
          action: "create_child",
        }],
      });
      if (moveTargetConsent.kind === "consent_required") {
        await agentResources.persistProjectGrants({
          operationId: "electron-agent-move-target-grant",
          authority: frozenAuthority,
          grants: moveTargetConsent.requirements.map((requirement) => requirement.grant),
        });
      } else if (moveTargetConsent.kind !== "authorized") {
        throw new Error("Native Agent Page-move target was not grantable");
      }
      const createdPageIds = CreatePagesV6OutputSchema.parse(nativeCreated.output).data.pages
        .map((page) => page.pageId)
        .reverse();
      const nativeMoveInput = {
        pageIds: createdPageIds,
        destination: {
          kind: "page" as const,
          pageId: nativeContentBlockId,
          at: { kind: "start" as const },
        },
      };
      const nativeMoved = await nativeAgentService.registry.execute({
        namespace: NODEX_APP_TOOL_NAMESPACE,
        toolsetRevision: NODEX_APP_TOOLSET_REVISION,
        tool: "move_pages",
      }, nativeMoveInput, nativeMoveContext);
      expect(nativeMoved).toMatchObject({
        effect: "write",
        output: {
          data: {
            moved: 2,
            pages: [{
              pageId: createdPageIds[0],
              location: { kind: "page", pageId: nativeContentBlockId },
            }, {
              pageId: createdPageIds[1],
              location: { kind: "page", pageId: nativeContentBlockId },
            }],
          },
        },
      });
      await expect(nativeAgentService.registry.execute({
        namespace: NODEX_APP_TOOL_NAMESPACE,
        toolsetRevision: NODEX_APP_TOOLSET_REVISION,
        tool: "move_pages",
      }, nativeMoveInput, nativeMoveContext)).resolves.toEqual(nativeMoved);
      const nativeDuplicateInput = {
        pageId: copiedDataSourcePageId,
        destination: {
          kind: "page" as const,
          pageId: copiedDataSourcePageId,
          at: { kind: "end" as const },
        },
        return: ["block_map" as const, "etags" as const],
      };
      const nativeDuplicate = await nativeAgentService.registry.execute({
        namespace: NODEX_APP_TOOL_NAMESPACE,
        toolsetRevision: NODEX_APP_TOOLSET_REVISION,
        tool: "duplicate_page",
      }, nativeDuplicateInput, nativeDuplicateContext);
      expect(nativeDuplicate).toMatchObject({
        effect: "write",
        output: {
          data: {
            sourcePageId: copiedDataSourcePageId,
            pageId: expect.any(String),
            location: { kind: "page", pageId: copiedDataSourcePageId },
            bodyBlocksCreated: expect.any(Number),
            blockMap: expect.objectContaining({
              [copiedDataSourcePageId]: expect.any(String),
            }),
            etags: {
              title: expect.stringMatching(/^nxe1\./u),
              body: expect.stringMatching(/^nxe1\./u),
            },
          },
        },
      });
      await expect(nativeAgentService.registry.execute({
        namespace: NODEX_APP_TOOL_NAMESPACE,
        toolsetRevision: NODEX_APP_TOOLSET_REVISION,
        tool: "duplicate_page",
      }, nativeDuplicateInput, nativeDuplicateContext)).resolves.toEqual(nativeDuplicate);
      await workspace.setProjectPinned(projectId, { pinned: true });
      await workspace.setProjectPinned(createdProject.id, { pinned: true });
      const pinnedOrder = [createdProject.id, projectId];
      await workspace.setPinnedProjectOrder({
        orderedProjectIds: pinnedOrder,
      });
      const reorderedProjects = await workspace.listProjectWindow({
        first: 200,
      });
      expect(
        reorderedProjects.items
          .filter((project) => project.pinned)
          .sort((left, right) =>
            (left.pinnedOrder ?? Number.MAX_SAFE_INTEGER) -
            (right.pinnedOrder ?? Number.MAX_SAFE_INTEGER),
          )
          .map((project) => project.id),
      ).toEqual(pinnedOrder);
      expect(listCurrentProcessFiles()).not.toContain(databasePath);
      const automation = createDesktopAutomationModuleBridge({
        authority: Promise.resolve(runtime),
      });
      const automationDefinition = await automation.createDefinition({
        kind: "cron",
        name: "Electron Automation Adapter",
        prompt: "Exercise the native Automation boundary.",
        rrule: "FREQ=DAILY;BYHOUR=9",
        cwds: [nodexHome],
        executionEnvironment: "worktree",
      });
      expect(automationDefinition).toMatchObject({
        id: "electron-automation-adapter",
        status: "ACTIVE",
        prompt: "Exercise the native Automation boundary.",
      });
      await expect(automation.listDefinitions()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: automationDefinition.id }),
        ]),
      );
      await expect(
        automation.dispatchDefinitionNow(automationDefinition.id),
      ).resolves.toMatchObject({
        id: automationDefinition.id,
        lastRunAt: expect.any(Number),
      });
      await expect(automation.beginRun({
        threadId: "thread:electron-session",
        automationId: automationDefinition.id,
        threadTitle: "Electron Automation run",
        sourceCwd: nodexHome,
      })).resolves.toBe(true);
      await expect(automation.completeRunForReview({
        threadId: "thread:electron-session",
        inboxTitle: "Native report ready",
        inboxSummary: "Review the native Automation run.",
      })).resolves.toBe(true);
      await expect(automation.readInbox(10)).resolves.toMatchObject({
        items: [{
          automationId: automationDefinition.id,
          threadId: "thread:electron-session",
          description: "Review the native Automation run.",
        }],
        unreadRunCounts: { total: 1 },
      });
      await expect(automation.setRunReadState({
        threadId: "thread:electron-session",
        readAt: Date.now(),
      })).resolves.toMatchObject({
        threadId: "thread:electron-session",
        readAt: expect.any(Number),
      });
      await expect(automation.archiveRun(
        {
          threadId: "thread:electron-session",
          archivedReason: "manual",
        },
        {
          archivedUserMessage: "Run the native report.",
          archivedAssistantMessage: "Native report complete.",
        },
      )).resolves.toBe(true);
      await expect(
        automation.getRun("thread:electron-session"),
      ).resolves.toMatchObject({
        status: "ARCHIVED",
        archivedUserMessage: "Run the native report.",
        archivedAssistantMessage: "Native report complete.",
        archivedReason: "manual",
      });
      await expect(
        automation.unarchiveRun("thread:electron-session"),
      ).resolves.toBe(true);
      await expect(
        automation.deleteRun("thread:electron-session"),
      ).resolves.toBe(true);
      await expect(automation.listPageOccurrences(
        createdProject.id,
        new Date("2026-07-19T00:00:00.000Z"),
        new Date("2026-07-21T00:00:00.000Z"),
      )).resolves.toEqual({ items: [], nextCursor: null });
      await expect(
        automation.claimDueReminders(10, 120_000),
      ).resolves.toEqual([]);
      await expect(
        automation.deleteDefinition(automationDefinition.id),
      ).resolves.toMatchObject({
        success: true,
        status: "deleted",
        deletedRunCount: 0,
      });
      const administration = createDesktopStoreAdministrationBridge({
        authority: Promise.resolve(runtime),
      });
      const nativeBackup = await administration.createBackup({
        trigger: "manual",
        label: "Electron native authority",
      });
      expect(nativeBackup).toMatchObject({
        trigger: "manual",
        label: "Electron native authority",
        includesAssets: true,
        dbBytes: expect.any(Number),
      });
      await expect(administration.listBackups()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: nativeBackup.id }),
        ]),
      );
      await expect(administration.runMaintenance({
        tasks: [
          "document_revision_finalize",
          "document_compaction",
          "history_retention",
          "block_retention",
        ],
        blockRetentionCount: 0,
      })).resolves.toBeUndefined();
      await expect(administration.deleteBackup(nativeBackup.id)).resolves.toEqual({
        success: true,
        deletedBackupId: nativeBackup.id,
      });
      expect(listCurrentProcessFiles()).not.toContain(databasePath);
      await expect(
        runtime.clientForProject(projectId).databaseRead({
          kind: "catalog_window",
          window: { after: null, first: 10 },
        }),
      ).resolves.toMatchObject({ value: { kind: "catalog_window" } });

      const canvasDocumentId = primaryCanvasDocumentId(projectId);
      const canvasAccessContext = { kind: "project", projectId } as const;
      const canvasBinding = {
        libraryId: runtime.identity.libraryId,
        accessContext: canvasAccessContext,
      };
      const firstCanvas = createCoreCanvasSceneAdapter(
        runtime.clientForProject(projectId),
        canvasBinding,
      );
      const secondCanvas = createCoreCanvasSceneAdapter(
        runtime.clientForProject(projectId),
        canvasBinding,
      );
      const firstCanvasRequest = {
        accessContext: canvasAccessContext,
        documentId: canvasDocumentId,
        clientSessionId: "renderer:electron-canvas:first",
      } as const;
      const secondCanvasRequest = {
        ...firstCanvasRequest,
        clientSessionId: "renderer:electron-canvas:second",
      } as const;
      const secondCanvasEvents: CanvasSceneRealtimeEvent[] = [];
      const closeFirstCanvas = firstCanvas.subscribe(
        firstCanvasRequest,
        () => undefined,
      );
      const secondCanvasSubscription = secondCanvas.subscribeWithLifecycle(
        secondCanvasRequest,
        (event) => secondCanvasEvents.push(event),
      );
      const closeSecondCanvas = secondCanvasSubscription.close;
      try {
        await secondCanvasSubscription.ready;
        const firstCanvasSync = await firstCanvas.sync({
          ...firstCanvasRequest,
          syncRequestId: "sync:electron:first",
        });
        if (!firstCanvasSync.ok) {
          throw new Error(
            `Core Canvas sync failed: ${firstCanvasSync.error.code}: ${firstCanvasSync.error.message}`,
          );
        }
        if (firstCanvasSync.value.kind !== "snapshot") {
          throw new Error("Initial Core Canvas sync did not return a snapshot");
        }
        const currentGridMode = firstCanvasSync.value.scene.appState
          .gridModeEnabled;
        const nextGridMode = currentGridMode !== true;
        const mutationId = "electron-canvas-mutation:one";
        const canvasMutation = await firstCanvas.applyMutation({
          ...firstCanvasRequest,
          mutationId,
          storeEpoch: firstCanvasSync.value.storeEpoch,
          generation: firstCanvasSync.value.generation,
          baseHeadSeq: firstCanvasSync.value.headSeq,
          elementCandidates: [],
          appStateIntents: {
            gridModeEnabled: {
              expected: Object.prototype.hasOwnProperty.call(
                firstCanvasSync.value.scene.appState,
                "gridModeEnabled",
              )
                ? { kind: "value", value: currentGridMode }
                : { kind: "absent" },
              value: { kind: "value", value: nextGridMode },
            },
          },
          fileAdditions: {},
        });
        if (!canvasMutation.ok) {
          throw new Error(
            `Core Canvas mutation failed: ${canvasMutation.error.code}: ${canvasMutation.error.message}`,
          );
        }
        await waitUntil(
          () => secondCanvasEvents.some((event) =>
            event.type === "canvas_scene_committed"
            && event.mutationId === mutationId),
          "Second Canvas subscriber did not receive the durable mutation",
        );
        const secondCanvasSync = await secondCanvas.sync({
          ...secondCanvasRequest,
          syncRequestId: "sync:electron:second",
        });
        if (!secondCanvasSync.ok) {
          throw new Error(
            `Second Core Canvas sync failed: ${secondCanvasSync.error.code}: ${secondCanvasSync.error.message}`,
          );
        }
        if (secondCanvasSync.value.kind !== "snapshot") {
          throw new Error("Second Core Canvas sync did not return a snapshot");
        }
        expect(
          secondCanvasSync.value.scene.appState.gridModeEnabled,
        ).toBe(nextGridMode);
        const corruptCanvasSync = await secondCanvas.sync({
          ...secondCanvasRequest,
          syncRequestId: "sync:electron:wrong-hash",
          knownStoreEpoch: secondCanvasSync.value.storeEpoch,
          knownGeneration: secondCanvasSync.value.generation,
          knownHeadSeq: secondCanvasSync.value.headSeq,
          knownSceneHash: "0".repeat(64),
        });
        expect(corruptCanvasSync).toMatchObject({
          ok: false,
          error: { code: "canvas_scene_corrupt", retryable: false },
        });
        const currentCanvasSync = await secondCanvas.sync({
          ...secondCanvasRequest,
          syncRequestId: "sync:electron:current",
          knownStoreEpoch: secondCanvasSync.value.storeEpoch,
          knownGeneration: secondCanvasSync.value.generation,
          knownHeadSeq: secondCanvasSync.value.headSeq,
          knownSceneHash: secondCanvasSync.value.sceneHash,
        });
        expect(currentCanvasSync).toMatchObject({
          ok: true,
          value: {
            kind: "up_to_date",
            syncRequestId: "sync:electron:current",
            headSeq: secondCanvasSync.value.headSeq,
          },
        });
        expect(listCurrentProcessFiles()).not.toContain(databasePath);
      } finally {
        closeFirstCanvas();
        closeSecondCanvas();
      }

      const library = createCoreLibraryModuleAdapter({
        client: runtime.clientForProject(projectId),
        libraryId: runtime.rootClient.handshake.library_id,
        profileId: runtime.rootClient.handshake.generation.profile_id,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
      });
      await expect(library.read({
        read: { mode: "metadata" },
      })).resolves.toMatchObject({
        ok: true,
        value: {
          libraryId: runtime.rootClient.handshake.library_id,
          storeEpoch: runtime.rootClient.handshake.store_epoch,
        },
      });
      const createdPage = await library.apply({
        operationId: "electron-library-adapter-create",
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        operation: {
          kind: "create_page",
          pageId: "page:electron-library-adapter",
          documentId: "document:electron-library-adapter",
          title: "Electron Library Adapter",
          parent: { kind: "library" },
        },
      });
      if (!createdPage.ok) {
        throw new Error(
          `Core Library Adapter create failed: ${createdPage.error.code}: ${createdPage.error.message}`,
        );
      }
      expect(createdPage).toMatchObject({
        ok: true,
        value: {
          createdTarget: {
            kind: "page",
            pageId: "page:electron-library-adapter",
          },
          duplicate: false,
        },
      });
      await expect(library.apply({
        operationId: "electron-library-adapter-grant",
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        operation: {
          kind: "grant_project_access",
          projectId,
          target: {
            kind: "page",
            pageId: "page:electron-library-adapter",
          },
          access: "read_write",
        },
      })).resolves.toMatchObject({
        ok: true,
        value: {
          operationKind: "grant_project_access",
          // A Project-created Library-root Page grants its creator read/write
          // access atomically; repeating that grant is a semantic no-op.
          didMutate: false,
        },
      });
      await expect(library.readProjectPageDetail(
        projectId,
        "page:electron-library-adapter",
      )).resolves.toMatchObject({
        ok: true,
        value: {
          projectId,
          libraryId: runtime.rootClient.handshake.library_id,
          page: {
            pageId: "page:electron-library-adapter",
            title: "Electron Library Adapter",
          },
          document: { readiness: "ready" },
        },
      });
      await expect(library.resolvePageTarget({
        accessContext: { kind: "project", projectId },
        targetPageId: "page:electron-library-adapter",
      })).resolves.toMatchObject({
        status: "available",
        targetPageId: "page:electron-library-adapter",
        page: {
          pageId: "page:electron-library-adapter",
          title: "Electron Library Adapter",
        },
        document: { readiness: "ready" },
      });
      await expect(library.resolvePageTarget({
        accessContext: { kind: "library" },
        targetPageId: "page:electron-library-adapter",
      })).resolves.toMatchObject({
        status: "available",
        targetPageId: "page:electron-library-adapter",
        page: {
          pageId: "page:electron-library-adapter",
          title: "Electron Library Adapter",
        },
        document: { readiness: "ready" },
      });
      await expect(library.resolvePageOwnershipPath({
        accessContext: { kind: "project", projectId },
        targetPageId: "page:electron-library-adapter",
      })).resolves.toMatchObject({
        libraryId: runtime.rootClient.handshake.library_id,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        commitSeq: expect.any(Number),
        status: "available",
        targetPageId: "page:electron-library-adapter",
        ancestors: [],
      });
      await expect(library.resolvePageOwnershipPath({
        accessContext: { kind: "library" },
        targetPageId: "page:electron-library-adapter",
      })).resolves.toMatchObject({
        libraryId: runtime.rootClient.handshake.library_id,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        commitSeq: expect.any(Number),
        status: "available",
        targetPageId: "page:electron-library-adapter",
        ancestors: [],
      });
      await expect(library.listPageHistory({
        requestingProjectId: projectId,
        pageId: "page:electron-library-adapter",
        pageSize: 10,
      })).resolves.toMatchObject({
        ok: true,
        value: {
          libraryId: runtime.rootClient.handshake.library_id,
          pageId: "page:electron-library-adapter",
          documentId: "document:electron-library-adapter",
        },
      });
      const rootLibrary = createCoreLibraryModuleAdapter({
        client: runtime.rootClient,
        libraryId: runtime.rootClient.handshake.library_id,
        profileId: runtime.rootClient.handshake.generation.profile_id,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
      });
      const rootCreatedPage = await rootLibrary.apply({
        operationId: "electron-root-library-create",
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        operation: {
          kind: "create_page",
          pageId: "page:electron-root-library",
          documentId: "document:electron-root-library",
          title: "Root Library Page",
          parent: { kind: "library" },
        },
      });
      if (!rootCreatedPage.ok) {
        throw new Error(
          `Root Library create failed: ${rootCreatedPage.error.code}: ${rootCreatedPage.error.message}`,
        );
      }
      expect(rootCreatedPage).toMatchObject({
        ok: true,
        value: {
          createdTarget: {
            kind: "page",
            pageId: "page:electron-root-library",
          },
        },
      });
      await expect(rootLibrary.findPageLocation(
        "page:electron-library-adapter",
      )).resolves.toEqual({
        pageId: "page:electron-library-adapter",
        projectId,
      });
      const libraryPageDetail = await rootLibrary.readLibraryPageDetail(
        "page:electron-library-adapter",
      );
      expect(libraryPageDetail).toMatchObject({
        ok: true,
        value: {
          accessContext: { kind: "library" },
          page: { pageId: "page:electron-library-adapter" },
        },
      });
      if (!libraryPageDetail.ok) throw new Error("Expected Library Page Detail");
      expect("projectId" in libraryPageDetail.value).toBe(false);
      await expect(libraryDatabase.apply({
        operationId: "electron-library-page-enter-database",
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        operations: [{
          kind: "transfer_page",
          pageId: "page:electron-library-adapter",
          expectedParentRevision:
            libraryPageDetail.value.page.parentRevision,
          expectedActiveMembershipRevision: 0,
          target: {
            kind: "data_source",
            dataSourceId: primaryDataSource.dataSourceId,
          },
        }],
      })).resolves.toMatchObject({
        ok: true,
        value: {
          accessContext: { kind: "library" },
          operationKinds: ["transfer_page"],
        },
      });
      await expect(rootLibrary.searchPages({
        projectIds: [projectId],
        query: "Electron Library Adapter",
        limit: 10,
      })).resolves.toEqual([expect.objectContaining({
        projectId,
        pageId: "page:electron-library-adapter",
        status: "triage",
      })]);
      const libraryDocuments = createCoreDocumentSyncAdapter(
        runtime.rootClient,
      );
      const preparedLibraryDocument = await libraryDocuments.prepareOwner({
        ownerBlockId: "page:electron-library-adapter",
        operationId: "electron-library-owner-prepare",
        clientSessionId: "renderer:electron-library-owner-prepare",
      });
      if (!preparedLibraryDocument.ok) {
        throw new Error(
          `Core Library Document preparation failed: ${preparedLibraryDocument.error.code}: ${preparedLibraryDocument.error.message}`,
        );
      }
      expect(preparedLibraryDocument.value).toMatchObject({
        ownerBlockId: "page:electron-library-adapter",
        documentId: "document:electron-library-adapter",
        ownerType: "page",
        readiness: "ready",
        sync: { kind: "yjs" },
      });
      const firstDocument = new Y.Doc({
        guid: "document:electron-library-adapter",
      });
      // Library providers intentionally use the unscoped root client. Core binds
      // that transport to its trusted local Library capability instead of
      // accepting an Adapter-selected content owner.
      const firstProvider = new NodexYProvider({
        documentId: firstDocument.guid,
        document: firstDocument,
        adapter: libraryDocuments,
        clientSessionId: "renderer:electron-authority:first",
        autoConnect: false,
        localCheckpointStore: null,
      });
      const secondDocument = new Y.Doc({
        guid: "document:electron-library-adapter",
      });
      const secondProvider = new NodexYProvider({
        documentId: secondDocument.guid,
        document: secondDocument,
        adapter: createCoreDocumentSyncAdapter(runtime.rootClient),
        clientSessionId: "renderer:electron-authority:second",
        autoConnect: false,
        localCheckpointStore: null,
      });
      try {
        await firstProvider.connect();
        expect(firstProvider.getStatus().phase).toBe("synced");
        firstDocument.transact(() => {
          const title = firstDocument.getText("title");
          title.delete(0, title.length);
          title.insert(0, "Electron native Document sync");
        });
        await firstProvider.flush();
        await secondProvider.connect();
        expect(secondDocument.getText("title").toString()).toBe(
          "Electron native Document sync",
        );
        expect(listCurrentProcessFiles()).not.toContain(databasePath);
      } finally {
        firstProvider.destroy();
        secondProvider.destroy();
        firstDocument.destroy();
        secondDocument.destroy();
      }
    } finally {
      if (runtime) {
        await runtime.rootClient.shutdown().catch(() => undefined);
        const socketPath = path.join(nodexHome, "run/core/core.sock");
        await waitUntil(
          () => !existsSync(socketPath),
          "Core runtime socket remained after authority test shutdown",
        );
      }
    }
  });
});
