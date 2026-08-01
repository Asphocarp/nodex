import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  superviseCoreEventStream,
  type SupervisedCoreEventSubscription,
} from "./core-event-stream-supervisor";
import { initializeDesktopDataAuthority } from "./desktop-data-authority";
import type { CoreAuthorityState } from "./desktop-core-authority-supervisor";

const CORE_BINARY = path.resolve("target/debug/nodex-core");

const waitUntil = async (
  predicate: () => boolean,
  message: string,
): Promise<void> => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
};

describe("Desktop native Core generation recovery", () => {
  test("keeps existing facades and event supervision alive after the Core is killed", async () => {
    expect(existsSync(CORE_BINARY), "run pnpm run core:test:client").toBe(true);
    accessSync(CORE_BINARY, constants.X_OK);
    const nodexHome = mkdtempSync(path.join(tmpdir(), "nodex-core-recovery-"));
    const runtime = await initializeDesktopDataAuthority({
      buildId: "desktop-core-recovery-integration",
      environment: { NODEX_CORE_EXECUTABLE: CORE_BINARY },
      isPackaged: false,
      nodexHome,
    });
    const rootClient = runtime.rootClient;
    const projectClient = runtime.clientForProject("project:recovery");
    const initialPid = rootClient.handshake.generation.pid;
    const observedStates: CoreAuthorityState["kind"][] = [];
    const releaseState = runtime.subscribeToCoreAuthority((state) => {
      observedStates.push(state.kind);
    });
    let eventSubscription: SupervisedCoreEventSubscription | null = null;

    const createProject = {
      operationId: "desktop-core-recovery-create-project",
      intent: {
        appearance: null,
        description: "Core generation recovery fixture",
        kind: "create_initial_project" as const,
        name: "Recovery",
        project_id: "project:recovery",
        source_roots: [path.join(nodexHome, "workspace")],
        starter_page: {
          document_id: "document:recovery",
          nfm: "Recovery fixture.",
          page_id: "page:recovery",
          title_markdown: "Recovery",
        },
      },
    };

    try {
      const committed = await rootClient.workspaceApply(createProject);
      expect(committed.receipt.duplicate).toBe(false);

      eventSubscription = superviseCoreEventStream({
        initialAfter: rootClient.handshake.event_head,
        open: (after, onEvent, onResyncRequired, signal) =>
          rootClient.openEventStream(after, onEvent, onResyncRequired, signal),
        onEvent: () => undefined,
        onResyncRequired: () => undefined,
        retryDelayMs: 10,
        maxRetryDelayMs: 100,
      });
      await eventSubscription.ready;

      process.kill(initialPid, "SIGKILL");
      await waitUntil(
        () => rootClient.handshake.generation.pid !== initialPid,
        "Desktop authority did not bind to a new Core generation",
      );

      const metadata = await projectClient.libraryRead({ kind: "metadata" });
      expect(metadata.value).toMatchObject({
        kind: "metadata",
        library_id: runtime.identity.libraryId,
        profile_id: runtime.identity.profileId,
      });
      const replayed = await rootClient.workspaceApply(createProject);
      expect(replayed.event_sequence).toBe(committed.event_sequence);
      expect(replayed.receipt.duplicate).toBe(true);
      expect(runtime.rootClient).toBe(rootClient);
      expect(runtime.clientForProject("project:recovery")).toBe(projectClient);
      expect(observedStates).toContain("recovering");
      expect(observedStates.at(-1)).toBe("ready");
      await eventSubscription.waitUntilConnected();
    } finally {
      eventSubscription?.close();
      releaseState();
      await rootClient.shutdown().catch(() => undefined);
      await waitUntil(
        () => !existsSync(path.join(nodexHome, "run/core/core.sock")),
        "Recovered Core socket remained during integration-test cleanup",
      ).catch(() => undefined);
      runtime.close();
      rmSync(nodexHome, { recursive: true, force: true });
    }
  });
});
