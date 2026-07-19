import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { initializeDesktopDataAuthority } from "./core-client/desktop-data-authority";
import type { RustDataAuthorityRuntime } from "./core-client/desktop-data-authority";
import { createCoreLibraryModuleAdapter } from "./core-client/library-module-adapter";
import { createCoreProjectWorkspaceAdapter } from "./core-client/project-workspace-adapter";
import { closeDatabase, getDb } from "./local-store/database";
import { LIBRARY_MODULE_CONTRACT_VERSION } from "../shared/library-module";

const CORE_BINARY = path.resolve("target/debug/nodex-core");
const temporaryDirectories: string[] = [];

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
      await expect(
        runtime.clientForProject(projectId).databaseRead({
          target: { kind: "project_default" },
          mode: "catalog",
        }),
      ).resolves.toMatchObject({ value: { kind: "catalog" } });

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
