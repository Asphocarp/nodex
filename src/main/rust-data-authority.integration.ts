import { execFileSync } from "node:child_process";
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
import { createCoreDocumentSyncAdapter } from "./core-client/document-sync-adapter";
import { createDesktopDocumentSyncBridge } from "./core-client/desktop-document-sync-bridge";
import { createCoreBlockTransferAdapter } from "./core-client/block-transfer-adapter";
import { createCoreProjectWorkspaceAdapter } from "./core-client/project-workspace-adapter";
import {
  createDesktopAutomationModuleBridge,
  type DesktopAutomationModulePort,
} from "./core-client/desktop-automation-module-bridge";
import {
  createDesktopStoreAdministrationBridge,
  type DesktopStoreAdministrationPort,
} from "./core-client/desktop-store-administration-bridge";
import type { CoreEventEnvelope } from "./core-client/types";
import { NodexYProvider } from "../renderer/lib/nodex-y-provider";
import { closeDatabase, getDb } from "./local-store/database";
import { LIBRARY_MODULE_CONTRACT_VERSION } from "../shared/library-module";
import { PAGE_HISTORY_CONTRACT_VERSION } from "../shared/page-history";
import { DATABASE_MODULE_V2_CONTRACT_VERSION } from "../shared/database-module-v2";
import { parseDataSourcePropertyId } from "../shared/database-identities";
import {
  CANVAS_SCENE_SYNC_VERSION,
  primaryCanvasDocumentId,
  type CanvasSceneRealtimeEvent,
} from "../shared/block-documents";
import { BLOCK_TRANSFER_INTENT_CONTRACT_VERSION } from "../shared/block-transfer";
import {
  DOCUMENT_HTTP_CONTENT_TYPE,
  decodeDocumentSyncHttpResponse,
  encodeDocumentSyncHttpRequest,
} from "../shared/block-documents/http-contract";
import {
  __resetHttpServerDependenciesForTests,
  __setHttpContentModuleDependenciesForTests,
  getHttpServerOptions,
} from "./http-server";

const CORE_BINARY = path.resolve("target/debug/nodex-core");
const temporaryDirectories: string[] = [];

const unavailableAutomationPort = (): DesktopAutomationModulePort => {
  const unavailable = async (): Promise<never> => {
    throw new Error("TypeScript Automation fallback must not run");
  };
  return {
    listDefinitions: unavailable,
    getDefinition: unavailable,
    createDefinition: unavailable,
    updateDefinition: unavailable,
    deleteDefinition: unavailable,
    dispatchDefinitionNow: unavailable,
    claimDueDefinitions: unavailable,
    completeLease: unavailable,
    failLease: unavailable,
    settleInterruptedRuns: unavailable,
    getRun: unavailable,
    beginRun: unavailable,
    replacePendingRunThread: unavailable,
    setRunThreadTitle: unavailable,
    completeRunForReview: unavailable,
    setRunInboxItem: unavailable,
    acceptRun: unavailable,
    archiveRun: unavailable,
    deleteRun: unavailable,
    unarchiveRun: unavailable,
    readInbox: unavailable,
    setRunReadState: unavailable,
    markAllRunsRead: unavailable,
    listPageOccurrences: unavailable,
    completePageOccurrence: unavailable,
    skipPageOccurrence: unavailable,
    updatePageOccurrence: unavailable,
    snoozeReminder: unavailable,
    claimDueReminders: unavailable,
    completeReminderLease: unavailable,
    failReminderLease: unavailable,
  };
};

const unavailableStoreAdministrationPort = (): DesktopStoreAdministrationPort => {
  const unavailable = async (): Promise<never> => {
    throw new Error("TypeScript Store Administration fallback must not run");
  };
  return {
    listBackups: unavailable,
    createBackup: unavailable,
    deleteBackup: unavailable,
    restoreBackup: unavailable,
    pruneBackups: unavailable,
    runMaintenance: unavailable,
  };
};

const waitUntil = async (
  predicate: () => boolean,
  message: string,
): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
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
  __resetHttpServerDependenciesForTests();
  closeDatabase();
  delete process.env.NODEX_CORE_BACKEND;
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
    process.env.NODEX_CORE_BACKEND = "rust";
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
      expect(() => getDb()).toThrow(
        "native Rust Core owns this Profile",
      );
      expect(listCurrentProcessFiles()).not.toContain(databasePath);

      const startup = await runtime.rootClient.workspaceRead({ kind: "startup" });
      if (startup.value.kind !== "startup") {
        throw new Error("Core did not return the Workspace startup snapshot");
      }
      const projectId = startup.value.projects[0]?.id;
      if (!projectId) throw new Error("Core startup has no Project");
      const desktopWorkspace = createDesktopProjectWorkspaceBridge({
        authority: Promise.resolve(runtime),
        typescript: {} as never,
      });
      __setHttpContentModuleDependenciesForTests({
        projectWorkspace: desktopWorkspace,
      });
      const projectsHttpResponse = await getHttpServerOptions(51_284).fetch(
        new Request("http://127.0.0.1:51284/api/projects"),
      );
      expect(projectsHttpResponse.status).toBe(200);
      await expect(projectsHttpResponse.json()).resolves.toMatchObject({
        projects: expect.arrayContaining([
          expect.objectContaining({ id: projectId }),
        ]),
      });
      __setHttpContentModuleDependenciesForTests({
        sqlInspection: {
          getSchema: async () => null,
          executeReadOnlyQuery: async () => null,
        },
      });
      const sqlHttpResponse = await getHttpServerOptions(51_284).fetch(
        new Request(
          `http://127.0.0.1:51284/api/projects/${projectId}/schema`,
        ),
      );
      expect(sqlHttpResponse.status).toBe(404);
      expect(listCurrentProcessFiles()).not.toContain(databasePath);
      const database = createCoreDatabaseModuleAdapter({
        client: runtime.clientForProject(projectId),
        projectId,
        libraryId: runtime.rootClient.handshake.library_id,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
      });
      const databaseCatalog = await database.read({
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId,
        read: { target: { kind: "project_default" }, mode: "catalog" },
      });
      expect(databaseCatalog).toMatchObject({
        ok: true,
        value: {
          projectId,
          libraryId: runtime.rootClient.handshake.library_id,
          value: { kind: "catalog" },
        },
      });
      if (!databaseCatalog.ok || databaseCatalog.value.value.kind !== "catalog") {
        throw new Error("Expected Core Database catalog");
      }
      expect(databaseCatalog.value.value.databases.length).toBeGreaterThan(0);
      __setHttpContentModuleDependenciesForTests({
        database: {
          read: (request) => database.read(request),
          apply: (request) => database.apply(request),
        },
      });
      const databaseHttpResponse = await getHttpServerOptions(51_284).fetch(
        new Request(
          `http://127.0.0.1:51284/api/projects/${projectId}/database-module/read`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              version: DATABASE_MODULE_V2_CONTRACT_VERSION,
              projectId,
              read: { target: { kind: "project_default" }, mode: "catalog" },
            }),
          },
        ),
      );
      expect(databaseHttpResponse.status).toBe(200);
      await expect(databaseHttpResponse.json()).resolves.toMatchObject({
        ok: true,
        value: {
          projectId,
          libraryId: runtime.rootClient.handshake.library_id,
          value: { kind: "catalog" },
        },
      });
      const primaryDatabase = databaseCatalog.value.value.databases[0];
      const primaryDataSource = primaryDatabase?.dataSources[0];
      const primaryView = primaryDatabase?.views.find((view) =>
        view.dataSourceId === primaryDataSource?.dataSourceId
      );
      if (!primaryDatabase || !primaryDataSource || !primaryView) {
        throw new Error("Core Database catalog omitted its primary authority");
      }
      const nativePropertyId = parseDataSourcePropertyId("p_rustcore");
      const databaseWrite = {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
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
          valueType: "text",
          config: {},
        }],
      } as const;
      const databaseEvents: CoreEventEnvelope[] = [];
      const databaseEventSubscription = await runtime.rootClient.openEventStream(
        runtime.rootClient.handshake.event_head,
        (event) => databaseEvents.push(event),
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
          event.event.operation_id === databaseWrite.operationId),
        "Core Database event was not published",
      );
      expect(databaseEvents.find((event) =>
        event.event.operation_id === databaseWrite.operationId
      )).toMatchObject({
        event: {
          payload: {
            module: "database",
            event: { project_id: projectId },
          },
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
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
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
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
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
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
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
          valueType: "text",
          config: {},
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
          event.event.operation_id
            === "electron-library-database-put-property"),
        "Core Library Database event was not published",
      );
      expect(databaseEvents.find((event) =>
        event.event.operation_id === "electron-library-database-put-property"
      )).toMatchObject({
        event: {
          payload: {
            module: "database",
            event: { project_id: null },
          },
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
        version: 1 as const,
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
          placement: { kind: "space" as const },
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
        typescript: {} as never,
      });
      __setHttpContentModuleDependenciesForTests({
        documentSync: {
          realtime: desktopDocuments,
          getOwnedDocumentDescriptor: (targetProjectId, ownerBlockId) =>
            desktopDocuments.getOwnedDocumentDescriptor(
              targetProjectId,
              ownerBlockId,
            ),
          prepareOwnedBlockDocument: (targetProjectId, ownerBlockId) =>
            desktopDocuments.prepareOwnedBlockDocument(
              targetProjectId,
              ownerBlockId,
            ),
          prepareLibraryOwnedBlockDocument: (ownerBlockId) =>
            desktopDocuments.prepareLibraryOwnedBlockDocument(ownerBlockId),
        },
      });
      const documentEventsResponse = await getHttpServerOptions(51_284).fetch(
        new Request(
          `http://127.0.0.1:51284/api/projects/${projectId}/documents/${nativeSourceDocumentId}/events?clientSessionId=http-native-document`,
        ),
      );
      expect(documentEventsResponse.status).toBe(200);
      const documentEventReader = documentEventsResponse.body?.getReader();
      if (!documentEventReader) throw new Error("Native HTTP SSE body is missing");
      const documentSyncResponse = await getHttpServerOptions(51_284).fetch(
        new Request(
          `http://127.0.0.1:51284/api/projects/${projectId}/documents/${nativeSourceDocumentId}/sync`,
          {
            method: "POST",
            headers: { "Content-Type": DOCUMENT_HTTP_CONTENT_TYPE },
            body: encodeDocumentSyncHttpRequest({
              documentId: nativeSourceDocumentId,
              clientSessionId: "http-native-document",
              stateVector: new Uint8Array(),
            }).slice().buffer,
          },
        ),
      );
      expect(documentSyncResponse.status).toBe(200);
      expect(decodeDocumentSyncHttpResponse(
        new Uint8Array(await documentSyncResponse.arrayBuffer()),
      )).toMatchObject({
        documentId: nativeSourceDocumentId,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        generation: 1,
        headSeq: 1,
      });
      await documentEventReader.cancel();
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
        version: 1 as const,
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
        version: 1 as const,
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
      await expect(projectDocuments.applyDocumentMutation(
        changeRequest,
        false,
      )).resolves.toMatchObject({
        ok: false,
        error: { code: "write_fence_required", retryable: true },
      });
      const changed = await projectDocuments.applyDocumentMutation(
        changeRequest,
        true,
      );
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
        version: 1 as const,
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
      await expect(projectDocuments.restoreVersion(
        restoreRequest,
        false,
      )).resolves.toMatchObject({
        ok: false,
        error: { code: "write_fence_required", retryable: true },
      });
      const restored = await projectDocuments.restoreVersion(
        restoreRequest,
        true,
      );
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
      await expect(projectDocuments.restoreVersion(
        restoreRequest,
        false,
      )).resolves.toMatchObject({
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
          version: 1,
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
            placement: { kind: "space" },
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
        version: BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
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
        source: {
          kind: "document" as const,
          documentId: nativeSourceDocumentId,
        },
        target: {
          kind: "document" as const,
          documentId: nativeTargetDocumentId,
          beforeBlockId: nativeTargetAnchorBlockId,
        },
      };
      const preparedTransfer = await transferAdapter.prepare(transferIntent);
      if (!preparedTransfer.ok) {
        throw new Error(
          `Core Block transfer preparation failed: ${preparedTransfer.error.code}: ${preparedTransfer.error.message}`,
        );
      }
      expect(preparedTransfer.value.leaseDocuments).toEqual([
        {
          documentId: nativeSourceDocumentId,
          generation: 1,
          expectedHeadSeq: 3,
        },
        {
          documentId: nativeTargetDocumentId,
          generation: 1,
          expectedHeadSeq: 1,
        },
      ].sort((left, right) => left.documentId.localeCompare(right.documentId)));
      const transferred = await transferAdapter.apply(
        preparedTransfer.value.request,
      );
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
        finalLocationRevisions: { [nativeContentBlockId]: 2 },
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
      await expect(transferAdapter.lookupCommitted(transferIntent)).resolves
        .toMatchObject({
          ok: true,
          value: {
            operationId: transferIntent.operationId,
            duplicate: true,
            finalLocationRevisions: { [nativeContentBlockId]: 2 },
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
      const preparedLibraryPromotion = await transferAdapter.prepare(
        promoteToLibraryIntent,
      );
      if (!preparedLibraryPromotion.ok) {
        throw new Error(
          `Core Library promotion preparation failed: ${preparedLibraryPromotion.error.code}: ${preparedLibraryPromotion.error.message}`,
        );
      }
      expect(preparedLibraryPromotion.value.leaseDocuments).toEqual([{
        documentId: nativeTargetDocumentId,
        generation: 1,
        expectedHeadSeq: 2,
      }]);
      const promotedToLibrary = await transferAdapter.apply(
        preparedLibraryPromotion.value.request,
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
            kind: "space",
            projectId,
            rankKey: expect.any(String),
          },
        },
        finalLocationRevisions: { [nativeContentBlockId]: 3 },
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
          viewId: primaryView.viewId,
          groupKey: "ship",
        },
      };
      const preparedDataSourceCopy = await transferAdapter.prepare(
        copyToDataSourceIntent,
      );
      if (!preparedDataSourceCopy.ok) {
        throw new Error(
          `Core Data Source copy preparation failed: ${preparedDataSourceCopy.error.code}: ${preparedDataSourceCopy.error.message}`,
        );
      }
      expect(preparedDataSourceCopy.value).toMatchObject({
        leaseDocuments: [{
          documentId: nativeTargetDocumentId,
          generation: 1,
          expectedHeadSeq: 3,
        }],
        request: {
          target: {
            kind: "database",
            databaseBlockId: primaryDatabase.database.databaseId,
            dataSourceId: primaryDataSource.dataSourceId,
            viewId: primaryView.viewId,
            groupKey: "ship",
          },
        },
      });
      const copiedToDataSource = await transferAdapter.apply(
        preparedDataSourceCopy.value.request,
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
            kind: "database",
            databaseBlockId: primaryDatabase.database.databaseId,
          },
        },
        finalLocationRevisions: { [copiedDataSourcePageId]: 2 },
        affectedDatabaseBlockIds: [primaryDatabase.database.databaseId],
      });
      const unavailableDatabaseFallback = async (): Promise<never> => {
        throw new Error("TypeScript Database fallback must not run");
      };
      const desktopDatabase = createDesktopDatabaseModuleBridge({
        authority: Promise.resolve(runtime),
        typescript: {
          read: unavailableDatabaseFallback,
          apply: unavailableDatabaseFallback,
          readLibrary: unavailableDatabaseFallback,
          applyLibrary: unavailableDatabaseFallback,
          getBoardSummary: unavailableDatabaseFallback,
          getDatabaseColumn: unavailableDatabaseFallback,
          getDatabaseRowsDetails: unavailableDatabaseFallback,
          getDatabaseRowPage: unavailableDatabaseFallback,
          resolveDatabaseViewReference: unavailableDatabaseFallback,
        },
      });
      const nativeBoard = await desktopDatabase.getBoardSummary(projectId);
      expect(nativeBoard.columns.find((column) => column.id === "ship")?.cards)
        .toEqual(expect.arrayContaining([
          expect.objectContaining({
            id: copiedDataSourcePageId,
            status: "ship",
            hasDescription: false,
          }),
        ]));
      __setHttpContentModuleDependenciesForTests({
        databaseProjections: desktopDatabase,
      });
      const boardHttpResponse = await getHttpServerOptions(51_284).fetch(
        new Request(
          `http://127.0.0.1:51284/api/projects/${projectId}/board-summary`,
        ),
      );
      expect(boardHttpResponse.status).toBe(200);
      await expect(boardHttpResponse.json()).resolves.toMatchObject({
        columns: expect.arrayContaining([
          expect.objectContaining({
            id: "ship",
            cards: expect.arrayContaining([
              expect.objectContaining({ id: copiedDataSourcePageId }),
            ]),
          }),
        ]),
      });
      const columnHttpResponse = await getHttpServerOptions(51_284).fetch(
        new Request(
          `http://127.0.0.1:51284/api/projects/${projectId}/column?id=ship`,
        ),
      );
      expect(columnHttpResponse.status).toBe(200);
      await expect(columnHttpResponse.json()).resolves.toMatchObject({
        id: "ship",
        cards: expect.arrayContaining([
          expect.objectContaining({
            id: copiedDataSourcePageId,
            description: expect.any(String),
          }),
        ]),
      });
      await expect(desktopDatabase.getDatabaseRowsDetails(projectId, {
        pageIds: [copiedDataSourcePageId, copiedDataSourcePageId],
      })).resolves.toEqual([
        expect.objectContaining({
          id: copiedDataSourcePageId,
          status: "ship",
          description: expect.any(String),
          runInTarget: "localProject",
        }),
      ]);
      await expect(desktopDatabase.getDatabaseRowPage(
        projectId,
        copiedDataSourcePageId,
        "ship",
      )).resolves.toMatchObject({
        id: copiedDataSourcePageId,
        status: "ship",
        order: 0,
      });
      const lifecycleLibrary = createCoreLibraryModuleAdapter({
        client: runtime.clientForProject(projectId),
        libraryId: runtime.rootClient.handshake.library_id,
        profileId: runtime.rootClient.handshake.profile_id,
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
                position: { groupKey: "ship" },
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
        version: 2 as const,
        projectId,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        actor: { kind: "electron_renderer", clientId: "rust-authority-test" },
      };
      const propertyMutation = await lifecycleLibrary.applyBlockPropertyMutation({
        version: 2,
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
        }, {
          scope: "data_source",
          pageId: copiedDataSourcePageId,
          dataSourceId: primaryDataSource.dataSourceId,
          propertyId: parseDataSourcePropertyId("assignee"),
          operation: "set",
          expectedRevision: 1,
          value: "native-core",
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
          fields: [
            { scope: "data_source", propertyId: "assignee", revision: 2 },
            { scope: "intrinsic", propertyKey: "run.target", revision: 2 },
          ],
        },
      });
      const propertyReplay = await lifecycleLibrary.applyBlockPropertyMutation({
        version: 2,
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
        }, {
          scope: "data_source",
          pageId: copiedDataSourcePageId,
          dataSourceId: primaryDataSource.dataSourceId,
          propertyId: parseDataSourcePropertyId("assignee"),
          operation: "set",
          expectedRevision: 1,
          value: "native-core",
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
                position: { groupKey: "ship" },
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
        requestingProjectId: projectId,
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
      const preparedPageMove = await transferAdapter.prepare(
        moveDataSourcePageToLibraryIntent,
      );
      if (!preparedPageMove.ok) {
        throw new Error(
          `Core Data Source Page move preparation failed: ${preparedPageMove.error.code}: ${preparedPageMove.error.message}`,
        );
      }
      expect(preparedPageMove.value).toMatchObject({
        leaseDocuments: [],
        request: {
          source: {
            kind: "database",
            databaseBlockId: primaryDatabase.database.databaseId,
            dataSourceId: primaryDataSource.dataSourceId,
            memberships: {
              [copiedDataSourcePageId]: {
                membershipId: expect.any(String),
                revision: restoredMembershipRevision,
              },
            },
          },
          target: {
            kind: "space",
            libraryId: runtime.rootClient.handshake.library_id,
          },
        },
      });
      const movedPageToLibrary = await transferAdapter.apply(
        preparedPageMove.value.request,
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
            kind: "space",
            projectId,
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
          viewId: primaryView.viewId,
          groupKey: "ship",
        },
      };
      const preparedPageReturn = await transferAdapter.prepare(
        moveLibraryPageToDataSourceIntent,
      );
      if (!preparedPageReturn.ok) {
        throw new Error(
          `Core Library Page move preparation failed: ${preparedPageReturn.error.code}: ${preparedPageReturn.error.message}`,
        );
      }
      expect(preparedPageReturn.value).toMatchObject({
        leaseDocuments: [],
        request: {
          source: {
            kind: "space",
            libraryId: runtime.rootClient.handshake.library_id,
          },
          target: {
            kind: "database",
            databaseBlockId: primaryDatabase.database.databaseId,
          },
        },
      });
      const returnedPageToDataSource = await transferAdapter.apply(
        preparedPageReturn.value.request,
      );
      if (!returnedPageToDataSource.ok) {
        throw new Error(
          `Core Library Page move failed: ${returnedPageToDataSource.error.code}: ${returnedPageToDataSource.error.message}`,
        );
      }
      expect(returnedPageToDataSource.value).toMatchObject({
        finalLocations: {
          [copiedDataSourcePageId]: {
            kind: "database",
            databaseBlockId: primaryDatabase.database.databaseId,
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
      const preparedPageNesting = await transferAdapter.prepare(
        moveDataSourcePageIntoPageIntent,
      );
      if (!preparedPageNesting.ok) {
        throw new Error(
          `Core Page nesting preparation failed: ${preparedPageNesting.error.code}: ${preparedPageNesting.error.message}`,
        );
      }
      expect(preparedPageNesting.value).toMatchObject({
        leaseDocuments: [{ documentId: expect.any(String) }],
        request: {
          source: {
            kind: "database",
            memberships: {
              [copiedDataSourcePageId]: {
                revision: restoredMembershipRevision + 2,
              },
            },
          },
          target: {
            kind: "document",
            pageId: nativeContentBlockId,
          },
        },
      });
      const nestedPage = await transferAdapter.apply(
        preparedPageNesting.value.request,
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
      const preparedRecursivePageCopy = await transferAdapter.prepare(
        copyRecursivePageIntent,
      );
      if (!preparedRecursivePageCopy.ok) {
        throw new Error(
          `Core recursive Page copy preparation failed: ${preparedRecursivePageCopy.error.code}: ${preparedRecursivePageCopy.error.message}`,
        );
      }
      expect(preparedRecursivePageCopy.value.leaseDocuments.length).toBeGreaterThanOrEqual(2);
      const copiedRecursivePage = await transferAdapter.apply(
        preparedRecursivePageCopy.value.request,
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
          [copiedRecursiveRootId]: { kind: "space", projectId },
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
      const preparedNestedMultiPageCopy = await transferAdapter.prepare(
        nestedMultiPageCopyIntent,
      );
      if (!preparedNestedMultiPageCopy.ok) {
        throw new Error(
          `Core nested multi-Page copy preparation failed: ${preparedNestedMultiPageCopy.error.code}: ${preparedNestedMultiPageCopy.error.message}`,
        );
      }
      const nestedCopyTarget = preparedNestedMultiPageCopy.value.request.target;
      if (nestedCopyTarget.kind !== "document") {
        throw new Error("Core nested multi-Page copy omitted its target Document");
      }
      const nestedMultiPageCopy = await transferAdapter.apply(
        preparedNestedMultiPageCopy.value.request,
      );
      if (!nestedMultiPageCopy.ok) {
        throw new Error(
          `Core nested multi-Page copy failed: ${nestedMultiPageCopy.error.code}: ${nestedMultiPageCopy.error.message}`,
        );
      }
      expect(nestedMultiPageCopy.value.resultRootBlockIds).toHaveLength(2);
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
      const preparedNestedReturn = await transferAdapter.prepare(
        moveNestedPageToLibraryIntent,
      );
      if (!preparedNestedReturn.ok) {
        throw new Error(
          `Core nested Page return preparation failed: ${preparedNestedReturn.error.code}: ${preparedNestedReturn.error.message}`,
        );
      }
      const returnedNestedPage = await transferAdapter.apply(
        preparedNestedReturn.value.request,
      );
      if (!returnedNestedPage.ok) {
        throw new Error(
          `Core nested Page return failed: ${returnedNestedPage.error.code}: ${returnedNestedPage.error.message}`,
        );
      }
      expect(returnedNestedPage.value).toMatchObject({
        finalLocations: {
          [copiedDataSourcePageId]: { kind: "space", projectId },
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
        leftPaneCollapsed: true,
        panels: { bottom: { collapsed: false, size: { heightPx: 340 } } },
      })).resolves.toMatchObject({
        noThreadFallbackTitle: "Electron Session Updated",
        leftPaneCollapsed: true,
        panels: { bottom: { collapsed: false, size: { heightPx: 340 } } },
      });
      await expect(
        workspace.setPinnedProjectSessionOrder(createdProject.id, {
          orderedSessionIds: [createdSession.id],
        }),
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: createdSession.id, pinnedOrder: 0 }),
        ]),
      );
      const firstBrowserTab = await workspace.createProjectSessionTab({
        sessionId: createdSession.id,
        projectId: createdProject.id,
        panelId: "right",
        kind: "browser",
        title: "Browser One",
        config: { projectId: createdProject.id, url: "https://example.test/one" },
      });
      const secondBrowserTab = await workspace.createProjectSessionTab({
        sessionId: createdSession.id,
        projectId: createdProject.id,
        panelId: "right",
        kind: "browser",
        title: "Browser Two",
        config: { projectId: createdProject.id, url: "https://example.test/two" },
      });
      await expect(workspace.updateProjectSessionTab(firstBrowserTab.id, {
        title: "Browser One Updated",
        stateKey: 1,
        state: { scrollY: 24 },
      })).resolves.toMatchObject({
        title: "Browser One Updated",
        stateKey: 1,
        state: { scrollY: 24 },
      });
      const tabbedSession = await workspace.getProjectSession(createdSession.id);
      if (!tabbedSession) throw new Error("Created Session disappeared");
      const splitSession = await workspace.splitProjectSessionPanelGroup({
        sessionId: createdSession.id,
        panelId: "right",
        leafId: tabbedSession.panels.right.layout.activeLeafId,
        side: "right",
        tabId: secondBrowserTab.id,
      });
      expect(splitSession?.tabs.map((tab) => tab.id)).toEqual(
        expect.arrayContaining([firstBrowserTab.id, secondBrowserTab.id]),
      );
      expect(
        splitSession?.panels.right.layout.root.type,
      ).toBe("split");
      const movedSession = await workspace.moveProjectSessionTab({
        tabId: firstBrowserTab.id,
        targetPanelId: "bottom",
      });
      expect(
        movedSession?.tabs.find((tab) => tab.id === firstBrowserTab.id)?.panelId,
      ).toBe("bottom");
      await expect(
        workspace.deleteProjectSessionTab(secondBrowserTab.id),
      ).resolves.toBe(true);
      await expect(
        workspace.getProjectSessionTab(secondBrowserTab.id),
      ).resolves.toBeNull();
      const threadTimestamp = Date.now();
      await expect(workspace.upsertProjectSessionThreadLink({
        sessionId: createdSession.id,
        projectId: createdProject.id,
        threadId: "thread:electron-session",
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
      await expect(
        workspace.detachProjectSessionThread(createdSession.id),
      ).resolves.toBe(true);
      await expect(
        workspace.getProjectSession(createdSession.id),
      ).resolves.toMatchObject({ thread: null });
      const turnAuthority = createDesktopNodexAgentAuthorityPort({
        authority: Promise.resolve(runtime),
        typescript: {} as never,
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
        typescript: {} as never,
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
      await workspace.setProjectPinned(projectId, { pinned: true });
      await workspace.setProjectPinned(createdProject.id, { pinned: true });
      const pinnedOrder = [createdProject.id, projectId];
      const reorderedProjects = await workspace.setPinnedProjectOrder({
        orderedProjectIds: pinnedOrder,
      });
      expect(
        reorderedProjects
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
        typescript: unavailableAutomationPort(),
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
      )).resolves.toEqual([]);
      __setHttpContentModuleDependenciesForTests({ automation });
      const occurrencesHttpResponse = await getHttpServerOptions(51_284).fetch(
        new Request(
          `http://127.0.0.1:51284/api/projects/${createdProject.id}/calendar/occurrences?start=2026-07-19T00:00:00.000Z&end=2026-07-21T00:00:00.000Z`,
        ),
      );
      expect(occurrencesHttpResponse.status).toBe(200);
      await expect(occurrencesHttpResponse.json()).resolves.toEqual({
        occurrences: [],
      });
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
        typescript: unavailableStoreAdministrationPort(),
      });
      const nativeBackup = await administration.createBackup({
        trigger: "manual",
        label: "Electron native authority",
      });
      expect(nativeBackup).toMatchObject({
        version: 2,
        trigger: "manual",
        label: "Electron native authority",
        includesAssets: true,
        dbBytes: expect.any(Number),
      });
      __setHttpContentModuleDependenciesForTests({
        storeAdministration: { port: administration },
      });
      const backupsHttpResponse = await getHttpServerOptions(51_284).fetch(
        new Request("http://127.0.0.1:51284/api/backups"),
      );
      expect(backupsHttpResponse.status).toBe(200);
      await expect(backupsHttpResponse.json()).resolves.toMatchObject({
        backups: expect.arrayContaining([
          expect.objectContaining({ id: nativeBackup.id }),
        ]),
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
          target: { kind: "project_default" },
          mode: "catalog",
        }),
      ).resolves.toMatchObject({ value: { kind: "catalog" } });

      const canvasDocumentId = primaryCanvasDocumentId(projectId);
      const firstCanvas = createCoreCanvasSceneAdapter(
        runtime.clientForProject(projectId),
      );
      const secondCanvas = createCoreCanvasSceneAdapter(
        runtime.clientForProject(projectId),
      );
      const firstCanvasRequest = {
        version: CANVAS_SCENE_SYNC_VERSION,
        projectId,
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
      const closeSecondCanvas = secondCanvas.subscribe(
        secondCanvasRequest,
        (event) => secondCanvasEvents.push(event),
      );
      try {
        const firstCanvasSync = await firstCanvas.sync(firstCanvasRequest);
        if (!firstCanvasSync.ok) {
          throw new Error(
            `Core Canvas sync failed: ${firstCanvasSync.error.code}: ${firstCanvasSync.error.message}`,
          );
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
        const secondCanvasSync = await secondCanvas.sync(secondCanvasRequest);
        if (!secondCanvasSync.ok) {
          throw new Error(
            `Second Core Canvas sync failed: ${secondCanvasSync.error.code}: ${secondCanvasSync.error.message}`,
          );
        }
        expect(
          secondCanvasSync.value.scene.appState.gridModeEnabled,
        ).toBe(nextGridMode);
        expect(listCurrentProcessFiles()).not.toContain(databasePath);
      } finally {
        closeFirstCanvas();
        closeSecondCanvas();
      }

      const library = createCoreLibraryModuleAdapter({
        client: runtime.clientForProject(projectId),
        libraryId: runtime.rootClient.handshake.library_id,
        profileId: runtime.rootClient.handshake.profile_id,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
      });
      await expect(library.read({
        version: LIBRARY_MODULE_CONTRACT_VERSION,
        read: { mode: "metadata" },
      })).resolves.toMatchObject({
        ok: true,
        value: {
          libraryId: runtime.rootClient.handshake.library_id,
          storeEpoch: runtime.rootClient.handshake.store_epoch,
        },
      });
      const createdPage = await library.apply({
        version: LIBRARY_MODULE_CONTRACT_VERSION,
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
        version: LIBRARY_MODULE_CONTRACT_VERSION,
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
          didMutate: true,
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
        requestingProjectId: projectId,
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
        requestingProjectId: projectId,
        targetPageId: "page:electron-library-adapter",
      })).resolves.toEqual({
        status: "available",
        targetPageId: "page:electron-library-adapter",
        ancestors: [],
      });
      await expect(library.listPageHistory({
        version: PAGE_HISTORY_CONTRACT_VERSION,
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
        profileId: runtime.rootClient.handshake.profile_id,
        storeEpoch: runtime.rootClient.handshake.store_epoch,
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
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
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
        score: 1_000_000,
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
      // accepting an Adapter-selected storage Project.
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
