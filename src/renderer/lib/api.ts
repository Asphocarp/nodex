import { resolveInvokeTransport, resolveRendererTransport } from "./renderer-transport";
import type { IpcApi } from "../../shared/ipc-api";
import type { Card, CardUpdateResult } from "./types";
import type { DocumentSyncAdapter } from "./nodex-y-provider";
import type { OwnedBlockDocumentDescriptor } from "../../shared/block-documents/contracts";
import type { DocumentSyncCommandResult } from "../../shared/block-documents/document-sync";
import type {
  CardReferenceReadModel,
  ResolveCardReferenceInput,
} from "../../shared/block-references";
import type {
  DatabaseViewReadModel,
  ReadDatabaseViewReferenceInput,
} from "../../shared/database-views";

const BROWSER_CODEX_INVOKE_CHANNELS = new Set<string>([
  "codex:thread:archive",
  "codex:thread:unarchive",
]);

export async function invoke<Channel extends keyof IpcApi>(
  channel: Channel,
  ...args: IpcApi[Channel]["args"]
): Promise<IpcApi[Channel]["result"]>;
export async function invoke(
  channel: string,
  ...args: unknown[]
): Promise<unknown>;
export async function invoke(
  channel: string,
  ...args: unknown[]
): Promise<unknown> {
  const transport = resolveInvokeTransport(channel);

  if (
    channel.startsWith("codex:")
    && transport.kind !== "electron"
    && !BROWSER_CODEX_INVOKE_CHANNELS.has(channel)
  ) {
    throw new Error("Codex threads require Electron in this release");
  }

  return transport.invoke(channel, ...args);
}

export function createDocumentSyncAdapter(projectId: string): DocumentSyncAdapter {
  const transport = resolveRendererTransport();
  const createAdapter = transport.createDocumentSyncAdapter;
  if (createAdapter) {
    return createAdapter(projectId);
  }
  throw new Error("Document sync is unavailable for this renderer transport");
}

export function getOwnedBlockDocumentDescriptor(
  projectId: string,
  ownerBlockId: string,
): Promise<OwnedBlockDocumentDescriptor> {
  return resolveRendererTransport().getOwnedBlockDocumentDescriptor(
    projectId,
    ownerBlockId,
  );
}

export function prepareOwnedBlockDocument(
  projectId: string,
  ownerBlockId: string,
): Promise<DocumentSyncCommandResult<OwnedBlockDocumentDescriptor>> {
  return resolveRendererTransport().prepareOwnedBlockDocument(
    projectId,
    ownerBlockId,
  );
}

export function resolveCardReference(
  input: ResolveCardReferenceInput,
): Promise<CardReferenceReadModel | null> {
  return invoke("block-reference:card:resolve", input);
}

export function readDatabaseViewReference(
  input: ReadDatabaseViewReferenceInput,
): Promise<DatabaseViewReadModel | null> {
  return invoke("database-view:reference:get", input);
}

const CARD_DESCRIPTION_UPDATE_CHUNK_SIZE = 16 * 1024;

function yieldToInput(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

function getDescriptionChunkEnd(description: string, start: number): number {
  const initialEnd = Math.min(description.length, start + CARD_DESCRIPTION_UPDATE_CHUNK_SIZE);
  if (initialEnd >= description.length || initialEnd <= start) return initialEnd;

  const previousCodeUnit = description.charCodeAt(initialEnd - 1);
  if (previousCodeUnit < 0xd800 || previousCodeUnit > 0xdbff) return initialEnd;
  return initialEnd - 1;
}

export async function updateCardDescription(input: {
  projectId: string;
  columnId?: Card["status"];
  cardId: string;
  description: string;
  sessionId?: string;
  expectedRevision?: number;
}): Promise<CardUpdateResult> {
  const { description, ...startInput } = input;
  const { stagingId } = await invoke("card:description:update:start", startInput);
  try {
    for (let index = 0; index < description.length;) {
      const chunkEnd = getDescriptionChunkEnd(description, index);
      const chunk = description.slice(index, chunkEnd);
      await invoke("card:description:update:chunk", stagingId, chunk);
      await yieldToInput();
      index = chunkEnd;
    }
    return await invoke("card:description:update:finish", stagingId);
  } catch (error) {
    try {
      await invoke("card:description:update:abort", stagingId);
    } catch {
      // Best-effort cleanup; surface the original save failure.
    }
    throw error;
  }
}

export function subscribeBoardChanges(
  projectId: string,
  callback: (event: import("../../shared/ipc-api").BoardChangeEvent) => void,
): () => void {
  return resolveRendererTransport().subscribeBoardChanges(projectId, callback);
}

export function subscribeProjectSessionChanges(
  projectId: string | null,
  callback: (event: import("../../shared/ipc-api").ProjectSessionsChangeEvent) => void,
): () => void {
  return resolveRendererTransport().subscribeProjectSessionChanges(projectId, callback);
}

export function subscribeProjectChanges(
  callback: (event: import("../../shared/ipc-api").ProjectsChangeEvent) => void,
): () => void {
  return resolveRendererTransport().subscribeProjectChanges(callback);
}

export function subscribeCodexHostMessages(
  callback: (message: import("./types").CodexHostMessage) => void,
): () => void {
  return resolveRendererTransport().subscribeCodexHostMessages(callback);
}

export function subscribeCodexRendererClientRequests(
  callback: (message: import("./types").CodexRendererClientRequestMessage) => void,
): () => void {
  return resolveRendererTransport().subscribeCodexRendererClientRequests(callback);
}

export function subscribeDesktopNotificationActions(
  callback: (
    payload: import("./types").DesktopNotificationActionPayload & {
      conversationId: string | null;
      requestId: string | null;
    },
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeDesktopNotificationActions(callback);
}

export function subscribeGitBranchChanges(
  callback: (event: { cwd: string }) => void,
): () => void {
  return resolveRendererTransport().subscribeGitBranchChanges(callback);
}

export function subscribeAppUpdateStatus(
  callback: (status: import("./types").AppUpdateStatus) => void,
): () => void {
  return resolveRendererTransport().subscribeAppUpdateStatus(callback);
}

export function subscribeCommandKeymapChanges(
  callback: (state: import("../../shared/command-keybindings").CommandKeymapState) => void,
): () => void {
  return resolveRendererTransport().subscribeCommandKeymapChanges(callback);
}

export function subscribeCommandPaletteThreadIndexUpdates(
  callback: (event: import("./types").CommandPaletteThreadIndexUpdatedEvent) => void,
): () => void {
  return resolveRendererTransport().subscribeCommandPaletteThreadIndexUpdates(callback);
}

export function subscribeCodexScheduledAutomationChanges(
  callback: (event: import("./types").CodexScheduledAutomationChangedEvent) => void,
): () => void {
  return resolveRendererTransport().subscribeCodexScheduledAutomationChanges(callback);
}

export function subscribeCodexAutomationRunsUpdates(
  callback: (event: import("./types").CodexAutomationRunsUpdatedEvent) => void,
): () => void {
  return resolveRendererTransport().subscribeCodexAutomationRunsUpdates(callback);
}

export function subscribeCrossWindowDragActiveChanges(
  callback: (
    preview: import("../../shared/cross-window-drag").CrossWindowDragPreview | null,
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeCrossWindowDragActiveChanges(callback);
}

export function subscribeCrossWindowDragSourceResults(
  callback: (
    result: import("../../shared/cross-window-drag").CrossWindowDragSourceResult,
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeCrossWindowDragSourceResults(callback);
}

export function getWindowFocusState(): Promise<boolean> {
  return resolveRendererTransport().getWindowFocusState();
}

export function subscribeWindowFocusChanges(
  callback: (isFocused: boolean) => void,
): () => void {
  return resolveRendererTransport().subscribeWindowFocusChanges(callback);
}
