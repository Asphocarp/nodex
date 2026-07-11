import type {
  AppUpdateStatus,
  CodexHostMessage,
  CodexRendererClientRequestMessage,
  CommandPaletteThreadIndexUpdatedEvent,
  DesktopNotificationActionPayload,
} from "./types";
import {
  COMMAND_KEYBINDINGS_CHANGED_CHANNEL,
  type CommandKeymapState,
} from "../../shared/command-keybindings";
import type { BoardChangeEvent, PersistedAtomUpdate, ProjectSessionsChangeEvent, ProjectsChangeEvent } from "../../shared/ipc-api";
import type {
  CrossWindowDragPreview,
  CrossWindowDragSourceResult,
} from "../../shared/cross-window-drag";
import { createElectronDocumentSyncAdapter } from "./electron-document-sync-adapter";
import type { OwnedBlockDocumentDescriptor } from "../../shared/block-documents/contracts";

export type ElectronRendererBridge = NonNullable<Window["api"]>;

export function createElectronRendererTransport(bridge: ElectronRendererBridge) {
  return {
    kind: "electron" as const,
    getOwnedBlockDocumentDescriptor(projectId: string, ownerBlockId: string) {
      return bridge.invoke(
        "block-document:owned:get",
        projectId,
        ownerBlockId,
      ) as Promise<OwnedBlockDocumentDescriptor>;
    },
    createDocumentSyncAdapter(projectId: string) {
      void projectId;
      return createElectronDocumentSyncAdapter(bridge);
    },
    invoke(channel: string, ...args: unknown[]) {
      return bridge.invoke(channel, ...args);
    },
    subscribeBoardChanges(projectId: string, callback: (event: BoardChangeEvent) => void) {
      return bridge.on("board-changed", (...args: unknown[]) => {
        const payload = args[0] as BoardChangeEvent | undefined;
        if (!payload || payload.projectId !== projectId) return;
        callback(payload);
      });
    },
    subscribeProjectSessionChanges(
      projectId: string | null,
      callback: (event: ProjectSessionsChangeEvent) => void,
    ) {
      return bridge.on("project-sessions-changed", (...args: unknown[]) => {
        const payload = args[0] as ProjectSessionsChangeEvent | undefined;
        if (!payload || payload.projectId !== projectId) return;
        callback(payload);
      });
    },
    subscribeProjectChanges(callback: (event: ProjectsChangeEvent) => void) {
      return bridge.on("projects-changed", (...args: unknown[]) => {
        const payload = args[0] as ProjectsChangeEvent | undefined;
        if (!payload) return;
        callback(payload);
      });
    },
    subscribeCodexHostMessages(callback: (message: CodexHostMessage) => void) {
      return bridge.on("codex:host-message", (...args: unknown[]) => {
        const payload = args[0] as CodexHostMessage | undefined;
        if (!payload) return;
        callback(payload);
      });
    },
    subscribeCodexRendererClientRequests(callback: (message: CodexRendererClientRequestMessage) => void) {
      return bridge.on("codex:renderer-client:request", (...args: unknown[]) => {
        const payload = args[0] as CodexRendererClientRequestMessage | undefined;
        if (!payload || typeof payload.requestId !== "string" || typeof payload.method !== "string") return;
        callback(payload);
      });
    },
    subscribeDesktopNotificationActions(
      callback: (message: DesktopNotificationActionPayload & {
        conversationId: string | null;
        requestId: string | null;
      }) => void,
    ) {
      return bridge.on("desktop-notification:action", (...args: unknown[]) => {
        const payload = args[0] as (DesktopNotificationActionPayload & {
          conversationId?: string | null;
          requestId?: string | null;
        }) | undefined;
        if (!payload || typeof payload.notificationId !== "string" || typeof payload.actionType !== "string") {
          return;
        }
        callback({
          ...payload,
          conversationId: payload.conversationId ?? null,
          requestId: payload.requestId ?? null,
        });
      });
    },
    subscribeGitBranchChanges(callback: (event: { cwd: string }) => void) {
      return bridge.on("git:branch:changed", (...args: unknown[]) => {
        const payload = args[0] as { cwd?: string } | undefined;
        if (!payload || typeof payload.cwd !== "string") return;
        callback({ cwd: payload.cwd });
      });
    },
    subscribeAppUpdateStatus(callback: (status: AppUpdateStatus) => void) {
      return bridge.on("app:update-status", (...args: unknown[]) => {
        const payload = args[0] as AppUpdateStatus | undefined;
        if (!payload || typeof payload.status !== "string") return;
        callback(payload);
      });
    },
    subscribeCommandKeymapChanges(callback: (state: CommandKeymapState) => void) {
      return bridge.on(COMMAND_KEYBINDINGS_CHANGED_CHANNEL, (...args: unknown[]) => {
        const payload = args[0] as CommandKeymapState | undefined;
        if (!payload || payload.version !== 1 || !Array.isArray(payload.entries)) return;
        callback(payload);
      });
    },
    subscribeCommandPaletteThreadIndexUpdates(callback: (event: CommandPaletteThreadIndexUpdatedEvent) => void) {
      return bridge.on("codex:threads:palette:index-updated", (...args: unknown[]) => {
        const payload = args[0] as CommandPaletteThreadIndexUpdatedEvent | undefined;
        if (!payload || typeof payload.generation !== "number") return;
        callback(payload);
      });
    },
    subscribeCodexScheduledAutomationChanges(
      callback: (event: import("./types").CodexScheduledAutomationChangedEvent) => void,
    ) {
      return bridge.on("codex:scheduled-automations:changed", (...args: unknown[]) => {
        const payload = args[0] as import("./types").CodexScheduledAutomationChangedEvent | undefined;
        if (!payload || typeof payload.automationId !== "string") return;
        callback(payload);
      });
    },
    subscribeCodexAutomationRunsUpdates(
      callback: (event: import("./types").CodexAutomationRunsUpdatedEvent) => void,
    ) {
      return bridge.on("codex:automation-runs:updated", (...args: unknown[]) => {
        const payload = args[0] as import("./types").CodexAutomationRunsUpdatedEvent | undefined;
        if (!payload || typeof payload.reason !== "string") return;
        callback(payload);
      });
    },
    subscribePersistedAtomUpdates(callback: (update: PersistedAtomUpdate) => void) {
      return bridge.on("persisted-atom:updated", (...args: unknown[]) => {
        const payload = args[0] as PersistedAtomUpdate | undefined;
        if (!payload || typeof payload.key !== "string") return;
        callback(payload);
      });
    },
    subscribeCrossWindowDragActiveChanges(
      callback: (preview: CrossWindowDragPreview | null) => void,
    ) {
      return bridge.on("cross-window-drag:active-changed", (...args: unknown[]) => {
        callback((args[0] as CrossWindowDragPreview | null | undefined) ?? null);
      });
    },
    subscribeCrossWindowDragSourceResults(
      callback: (result: CrossWindowDragSourceResult) => void,
    ) {
      return bridge.on("cross-window-drag:source-result", (...args: unknown[]) => {
        const result = args[0] as CrossWindowDragSourceResult | undefined;
        if (!result || typeof result.sessionId !== "string") return;
        callback(result);
      });
    },
    getWindowFocusState() {
      return bridge.invoke("electron-window:focus:get") as Promise<boolean>;
    },
    subscribeWindowFocusChanges(callback: (isFocused: boolean) => void) {
      return bridge.on("electron-window:focus-changed", (...args: unknown[]) => {
        const payload = args[0] as { isFocused?: boolean } | undefined;
        callback(payload?.isFocused === true);
      });
    },
  };
}
