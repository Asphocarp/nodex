import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, waitFor } from "@testing-library/react";
import { createElement, useEffect } from "react";
import type {
  CodexHostMessage,
  CodexSidebarSnapshot,
  CodexSidebarSyncResult,
  Project,
} from "./types";
import type { ProjectSessionsChangeEvent } from "../../shared/ipc-api";
import { useSidebarThreadSyncModel } from "./use-sidebar-thread-sync-model";
import { installWindowApi } from "../test/browser-globals";
import { render } from "../test/dom";
import { createTestQueryClient, TestQueryProvider } from "../test/query";

let invokeCalls: unknown[][] = [];
let hostMessageListener: ((message: CodexHostMessage) => void) | null = null;
let projectSessionListeners: Array<{
  projectId: string | null;
  listener: (event: ProjectSessionsChangeEvent) => void;
}> = [];
let syncResult: CodexSidebarSyncResult;

const emptySnapshot: CodexSidebarSnapshot = {
  items: [],
  pinnedThreadIds: [],
  projectAssignments: {},
  projectlessThreadIds: [],
  generatedAt: 1,
};

function makeProject(id: string): Project {
  return {
    id,
    name: id,
    description: "",
    icon: undefined,
    sources: [{ root: `/work/${id}`, order: 0 }],
    primaryWorkspaceRoot: `/work/${id}`,
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-01-01T00:00:00.000Z"),
    updated: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function makeSyncResult(input: {
  snapshot?: CodexSidebarSnapshot;
  changedProjectIds?: string[];
  projectlessChanged?: boolean;
  materializedSessionIds?: string[];
} = {}): CodexSidebarSyncResult {
  return {
    snapshot: input.snapshot ?? emptySnapshot,
    source: "sqlite",
    refreshed: false,
    refreshedAt: 0,
    changedProjectIds: input.changedProjectIds ?? [],
    projectlessChanged: input.projectlessChanged ?? false,
    materializedSessionIds: input.materializedSessionIds ?? [],
    failedThreadIds: [],
  };
}

function Harness(props: {
  projects: Project[];
  onSessionsAffected: (result: CodexSidebarSyncResult) => void;
  onSnapshot: (snapshot: CodexSidebarSnapshot) => void;
}) {
  const state = useSidebarThreadSyncModel({
    projects: props.projects,
    onSessionsAffected: props.onSessionsAffected,
  });
  useEffect(() => {
    props.onSnapshot(state.snapshot);
  }, [props, state.snapshot]);
  return createElement("div", { "data-count": state.snapshot.items.length });
}

describe("useSidebarThreadSyncModel", () => {
  beforeEach(() => {
    installWindowApi({
      invoke: async (channel: string, ...args: unknown[]) => {
        invokeCalls.push([channel, ...args]);
        if (channel === "codex:sidebar:snapshot") return emptySnapshot;
        if (channel === "codex:sidebar:sync") return syncResult;
        if (channel === "codex:threads:pinned:set") return syncResult.snapshot;
        return null;
      },
      on: (channel: string, listener: (...args: unknown[]) => void) => {
        if (channel === "codex:host-message") {
          hostMessageListener = (message) => listener(message);
          return () => {
            hostMessageListener = null;
          };
        }
        if (channel === "project-sessions-changed") {
          const sessionListener = (event: ProjectSessionsChangeEvent) => listener(event);
          projectSessionListeners.push({
            projectId: "__all__",
            listener: sessionListener,
          });
          return () => {
            projectSessionListeners = projectSessionListeners
              .filter((entry) => entry.listener !== sessionListener);
          };
        }
        return () => undefined;
      },
    });
  });

  afterEach(() => {
    invokeCalls = [];
    hostMessageListener = null;
    projectSessionListeners = [];
    syncResult = makeSyncResult();
  });

  test("applies sidebarSyncUpdated host messages without scheduling another sync", async () => {
    syncResult = makeSyncResult();
    const affectedResults: CodexSidebarSyncResult[] = [];
    const snapshots: CodexSidebarSnapshot[] = [];
    render(
      createElement(TestQueryProvider, {
        client: createTestQueryClient(),
        children: createElement(Harness, {
          projects: [makeProject("alpha"), makeProject("beta")],
          onSessionsAffected: (result) => affectedResults.push(result),
          onSnapshot: (snapshot) => snapshots.push(snapshot),
        }),
      }),
    );
    await waitFor(() => {
      if (hostMessageListener === null) throw new Error("missing host listener");
      if (!invokeCalls.some((call) => call[0] === "codex:sidebar:sync")) {
        throw new Error("missing mount sync");
      }
    });
    affectedResults.length = 0;
    snapshots.length = 0;
    const callsBeforeMessage = invokeCalls.length;
    const broadcastResult = makeSyncResult({
      snapshot: {
        ...emptySnapshot,
        projectAssignments: { thr_beta: "beta" },
        generatedAt: 2,
      },
      changedProjectIds: ["beta"],
      materializedSessionIds: ["session_beta"],
    });

    await act(async () => {
      hostMessageListener?.({
        type: "sidebarSyncUpdated",
        hostId: "local",
        result: broadcastResult,
        reason: "host-message",
      });
      await Promise.resolve();
    });

    expect(invokeCalls.length).toBe(callsBeforeMessage);
    expect(affectedResults[affectedResults.length - 1]?.changedProjectIds.includes("beta")).toBeTrue();
    await waitFor(() => {
      if (snapshots[snapshots.length - 1]?.projectAssignments.thr_beta !== "beta") {
        throw new Error("missing beta snapshot");
      }
    });
  });

  test("adds inactive project and projectless scopes to session-change read sync results", async () => {
    syncResult = makeSyncResult();
    const affectedResults: CodexSidebarSyncResult[] = [];
    render(
      createElement(TestQueryProvider, {
        client: createTestQueryClient(),
        children: createElement(Harness, {
          projects: [makeProject("alpha"), makeProject("beta")],
          onSessionsAffected: (result) => affectedResults.push(result),
          onSnapshot: () => undefined,
        }),
      }),
    );
    await waitFor(() => {
      if (projectSessionListeners.length < 3) {
        throw new Error("missing project session listeners");
      }
      if (!invokeCalls.some((call) => call[0] === "codex:sidebar:sync")) {
        throw new Error("missing mount sync");
      }
    });
    affectedResults.length = 0;

    await act(async () => {
      for (const entry of projectSessionListeners) {
        entry.listener({ projectId: "beta", changeType: "update" });
      }
      await Promise.resolve();
    });
    await waitFor(() => {
      if (!affectedResults.some((result) => result.changedProjectIds.includes("beta"))) {
        throw new Error("missing beta affected result");
      }
    });

    affectedResults.length = 0;
    await act(async () => {
      for (const entry of projectSessionListeners) {
        entry.listener({ projectId: null, changeType: "update" });
      }
      await Promise.resolve();
    });
    await waitFor(() => {
      if (!affectedResults.some((result) => result.projectlessChanged)) {
        throw new Error("missing projectless affected result");
      }
    });
  });
});
