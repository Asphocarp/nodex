import {
  captureCollaborativeSelection,
  restoreCollaborativeSelection,
  type BlockNoteEditor,
  type BlockSchema,
  type CollaborativeSelectionBookmark,
  type InlineContentSchema,
  type StyleSchema,
} from "@blocknote/core";
import type { OwnedDocumentDescriptor } from "../../shared/block-documents";
import type { BlockDocumentSurfaceRuntime } from "./block-document-surface-runtime";

interface RetainedBlockNoteEditor {
  readonly _tiptapEditor: {
    destroy: () => void;
  };
}

interface CanonicalPageDocumentEntry {
  readonly identity: string;
  readonly descriptor: OwnedDocumentDescriptor;
  readonly runtime: BlockDocumentSurfaceRuntime;
  readonly connectBarrier: Promise<void>;
  references: number;
  activeAwarenessViews: number;
  closing: boolean;
  closePromise: Promise<void> | null;
}

export interface PageEditorAwarenessLease {
  acquire: () => void;
  release: () => void;
}

export const makePageEditorSessionKey = (
  projectSessionId: string,
  tabId: string,
): string => `${projectSessionId}\u0000${tabId}`;

export const makePageEditorRuntimeIdentity = (
  descriptor: OwnedDocumentDescriptor,
): string => [
  descriptor.projectId,
  descriptor.ownerBlockId,
  descriptor.ownerType,
  descriptor.ownerLifecycle,
  descriptor.documentId,
  descriptor.storeEpoch,
  descriptor.generation,
  descriptor.schemaKey,
  descriptor.schemaVersion,
  descriptor.readiness,
  descriptor.sync.kind,
].join("\u0000");

const hasSameRuntimeIdentity = (
  left: OwnedDocumentDescriptor,
  right: OwnedDocumentDescriptor,
): boolean =>
  makePageEditorRuntimeIdentity(left) === makePageEditorRuntimeIdentity(right);

const persistRuntime = async (
  runtime: BlockDocumentSurfaceRuntime,
): Promise<void> => {
  const status = runtime.getStatus();
  if (
    !status.ready
    || status.reloadRequired
    || status.phase === "closing"
    || status.phase === "closed"
  ) {
    return;
  }
  await runtime.persist().then(() => undefined, () => undefined);
};

/**
 * One view's editor/selection lease over a canonical document session.
 *
 * The Y.Doc/provider lives in PageEditorSessionRegistry's document map, not in
 * the tab key. This is the important boundary: two tab groups can render the
 * same Page without opening two independent local authorities.
 */
export class PageEditorSession {
  readonly key: string;
  readonly descriptor: OwnedDocumentDescriptor;
  readonly runtime: BlockDocumentSurfaceRuntime;
  readonly awarenessLease: PageEditorAwarenessLease;

  private readonly connectBarrier: Promise<void>;
  private readonly releaseRuntime: () => Promise<void>;
  private connectPromise: Promise<void> | null = null;
  private disposePromise: Promise<void> | null = null;
  private editor: RetainedBlockNoteEditor | null = null;
  private editorKey: string | null = null;
  private selectionBookmark: CollaborativeSelectionBookmark | null = null;
  private shouldRestoreEditorFocus = false;
  private nextViewGeneration = 0;
  private activeViewGeneration = 0;
  private disposed = false;

  constructor(input: {
    readonly key: string;
    readonly descriptor: OwnedDocumentDescriptor;
    readonly runtime: BlockDocumentSurfaceRuntime;
    readonly connectBarrier?: Promise<void>;
    readonly releaseRuntime?: () => Promise<void>;
    readonly awarenessLease?: PageEditorAwarenessLease;
  }) {
    this.key = input.key;
    this.descriptor = input.descriptor;
    this.runtime = input.runtime;
    this.connectBarrier = input.connectBarrier ?? Promise.resolve();
    this.releaseRuntime = input.releaseRuntime ?? (() => this.runtime.close().then(() => undefined));
    this.awarenessLease = input.awarenessLease ?? {
      acquire: () => undefined,
      release: () => this.runtime.clearLocalAwareness(),
    };
  }

  connect(): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error("Page editor session is disposed"));
    }
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.connectBarrier.then(() => this.runtime.connect());
    return this.connectPromise;
  }

  claimView(): number {
    if (this.disposed) {
      throw new Error("Cannot claim a disposed Page editor session");
    }
    this.nextViewGeneration += 1;
    this.activeViewGeneration = this.nextViewGeneration;
    return this.activeViewGeneration;
  }

  releaseView(
    generation: number,
    options: { readonly persist?: boolean } = {},
  ): boolean {
    if (generation !== this.activeViewGeneration) return false;
    this.activeViewGeneration = 0;
    if (this.disposed) return true;

    this.awarenessLease.release();
    if (options.persist === false) return true;
    void this.persist();
    return true;
  }

  async persist(): Promise<void> {
    if (this.disposed) return;
    await persistRuntime(this.runtime);
  }

  getOrCreateEditor<Editor extends RetainedBlockNoteEditor>(
    editorKey: string,
    create: () => Editor,
  ): Editor {
    if (this.disposed) {
      throw new Error("Cannot create an editor for a disposed Page session");
    }
    if (this.editor) {
      if (this.editorKey !== editorKey) {
        throw new Error("Page editor identity changed without a new session");
      }
      return this.editor as Editor;
    }

    const editor = create();
    this.editor = editor;
    this.editorKey = editorKey;
    return editor;
  }

  captureSelection<
    BSchema extends BlockSchema,
    ISchema extends InlineContentSchema,
    SSchema extends StyleSchema,
  >(editor: BlockNoteEditor<BSchema, ISchema, SSchema>): void {
    if (this.disposed || editor !== this.editor) return;
    this.selectionBookmark = captureCollaborativeSelection(editor);
  }

  setShouldRestoreEditorFocus(value: boolean): void {
    if (this.disposed) return;
    this.shouldRestoreEditorFocus = value;
  }

  restoreSelection<
    BSchema extends BlockSchema,
    ISchema extends InlineContentSchema,
    SSchema extends StyleSchema,
  >(editor: BlockNoteEditor<BSchema, ISchema, SSchema>): boolean {
    if (this.disposed || editor !== this.editor || !this.selectionBookmark) {
      return false;
    }
    const restored = restoreCollaborativeSelection(editor, this.selectionBookmark);
    if (this.shouldRestoreEditorFocus) editor.focus();
    return restored;
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.activeViewGeneration = 0;
    this.awarenessLease.release();

    const editor = this.editor;
    this.editor = null;
    this.editorKey = null;
    this.selectionBookmark = null;
    this.shouldRestoreEditorFocus = false;
    editor?._tiptapEditor.destroy();

    this.disposePromise = this.connectBarrier
      .catch(() => undefined)
      .then(() => this.releaseRuntime())
      .then(() => undefined);
    return this.disposePromise;
  }
}

export class PageEditorSessionRegistry {
  private readonly sessions = new Map<string, PageEditorSession>();
  private readonly documents = new Map<string, CanonicalPageDocumentEntry>();

  acquire(input: {
    readonly key: string;
    readonly descriptor: OwnedDocumentDescriptor;
    readonly createRuntime: () => BlockDocumentSurfaceRuntime;
  }): PageEditorSession {
    const existing = this.sessions.get(input.key);
    if (existing && hasSameRuntimeIdentity(existing.descriptor, input.descriptor)) {
      return existing;
    }

    const connectBarrier = existing?.dispose() ?? Promise.resolve();
    const identity = makePageEditorRuntimeIdentity(input.descriptor);
    const existingDocument = this.documents.get(identity);
    const document = existingDocument && !existingDocument.closing
      ? existingDocument
      : this.createDocumentEntry({
          identity,
          descriptor: input.descriptor,
          createRuntime: input.createRuntime,
          connectBarrier: existingDocument?.closePromise ?? Promise.resolve(),
        });
    document.references += 1;
    const session = new PageEditorSession({
      key: input.key,
      descriptor: document.descriptor,
      runtime: document.runtime,
      connectBarrier,
      releaseRuntime: () => this.releaseDocument(document),
      awarenessLease: this.createAwarenessLease(document),
    });
    this.sessions.set(input.key, session);
    return session;
  }

  get(key: string): PageEditorSession | null {
    return this.sessions.get(key) ?? null;
  }

  dispose(key: string, expected?: PageEditorSession): Promise<void> {
    const session = this.sessions.get(key);
    if (!session || (expected && session !== expected)) return Promise.resolve();
    this.sessions.delete(key);
    return session.dispose();
  }

  async disposeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map((session) => session.dispose()));
  }

  async persistAll(): Promise<void> {
    await Promise.all([...this.documents.values()].map((entry) =>
      persistRuntime(entry.runtime)
    ));
  }

  async disposeProjectSession(projectSessionId: string): Promise<void> {
    const keyPrefix = `${projectSessionId}\u0000`;
    const matches = [...this.sessions.entries()].filter(([key]) =>
      key.startsWith(keyPrefix)
    );
    for (const [key] of matches) this.sessions.delete(key);
    await Promise.all(matches.map(([, session]) => session.dispose()));
  }

  get size(): number {
    return this.sessions.size;
  }

  get canonicalDocumentSize(): number {
    return this.documents.size;
  }

  private createDocumentEntry(input: {
    readonly identity: string;
    readonly descriptor: OwnedDocumentDescriptor;
    readonly createRuntime: () => BlockDocumentSurfaceRuntime;
    readonly connectBarrier: Promise<void>;
  }): CanonicalPageDocumentEntry {
    const entry: CanonicalPageDocumentEntry = {
      identity: input.identity,
      descriptor: input.descriptor,
      runtime: input.createRuntime(),
      connectBarrier: input.connectBarrier,
      references: 0,
      activeAwarenessViews: 0,
      closing: false,
      closePromise: null,
    };
    this.documents.set(input.identity, entry);
    return entry;
  }

  private createAwarenessLease(
    entry: CanonicalPageDocumentEntry,
  ): PageEditorAwarenessLease {
    let acquired = false;
    return {
      acquire: () => {
        if (acquired || entry.closing) return;
        acquired = true;
        entry.activeAwarenessViews += 1;
      },
      release: () => {
        if (!acquired) {
          if (entry.activeAwarenessViews === 0) {
            entry.runtime.clearLocalAwareness();
          }
          return;
        }
        acquired = false;
        entry.activeAwarenessViews = Math.max(0, entry.activeAwarenessViews - 1);
        if (entry.activeAwarenessViews === 0) {
          entry.runtime.clearLocalAwareness();
        }
      },
    };
  }

  private releaseDocument(entry: CanonicalPageDocumentEntry): Promise<void> {
    if (entry.references > 0) entry.references -= 1;
    if (entry.references > 0 || entry.closePromise) {
      return entry.closePromise ?? Promise.resolve();
    }

    entry.closing = true;
    const closePromise = entry.connectBarrier
      .catch(() => undefined)
      .then(() => entry.runtime.close())
      .then(() => undefined);
    entry.closePromise = closePromise.finally(() => {
      if (this.documents.get(entry.identity) === entry) {
        this.documents.delete(entry.identity);
      }
    });
    return entry.closePromise;
  }
}

export const pageEditorSessionRegistry = new PageEditorSessionRegistry();
