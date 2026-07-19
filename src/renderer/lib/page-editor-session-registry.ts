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

/**
 * One PageTab-local collaborative model. React claims only a short-lived view
 * lease; explicit tab close or descriptor invalidation disposes the model.
 */
export class PageEditorSession {
  readonly key: string;
  readonly descriptor: OwnedDocumentDescriptor;
  readonly runtime: BlockDocumentSurfaceRuntime;

  private readonly connectBarrier: Promise<void>;
  private connectPromise: Promise<void> | null = null;
  private disposePromise: Promise<void> | null = null;
  private editor: RetainedBlockNoteEditor | null = null;
  private editorKey: string | null = null;
  private selectionBookmark: CollaborativeSelectionBookmark | null = null;
  private nextViewGeneration = 0;
  private activeViewGeneration = 0;
  private disposed = false;

  constructor(input: {
    readonly key: string;
    readonly descriptor: OwnedDocumentDescriptor;
    readonly runtime: BlockDocumentSurfaceRuntime;
    readonly connectBarrier?: Promise<void>;
  }) {
    this.key = input.key;
    this.descriptor = input.descriptor;
    this.runtime = input.runtime;
    this.connectBarrier = input.connectBarrier ?? Promise.resolve();
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

    this.runtime.clearLocalAwareness();
    if (options.persist === false) return true;
    void this.persist();
    return true;
  }

  async persist(): Promise<void> {
    if (this.disposed) return;
    const status = this.runtime.getStatus();
    if (
      !status.ready
      || status.reloadRequired
      || status.phase === "closing"
      || status.phase === "closed"
    ) {
      return;
    }
    await this.runtime.persist().then(() => undefined, () => undefined);
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

  restoreSelection<
    BSchema extends BlockSchema,
    ISchema extends InlineContentSchema,
    SSchema extends StyleSchema,
  >(editor: BlockNoteEditor<BSchema, ISchema, SSchema>): boolean {
    if (this.disposed || editor !== this.editor || !this.selectionBookmark) {
      return false;
    }
    return restoreCollaborativeSelection(editor, this.selectionBookmark);
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.activeViewGeneration = 0;
    this.runtime.clearLocalAwareness();

    const editor = this.editor;
    this.editor = null;
    this.editorKey = null;
    this.selectionBookmark = null;
    editor?._tiptapEditor.destroy();

    this.disposePromise = this.connectBarrier
      .catch(() => undefined)
      .then(() => this.runtime.close())
      .then(() => undefined);
    return this.disposePromise;
  }
}

export class PageEditorSessionRegistry {
  private readonly sessions = new Map<string, PageEditorSession>();

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
    const session = new PageEditorSession({
      key: input.key,
      descriptor: input.descriptor,
      runtime: input.createRuntime(),
      connectBarrier,
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
    await Promise.all([...this.sessions.values()].map((session) =>
      session.persist()
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
}

export const pageEditorSessionRegistry = new PageEditorSessionRegistry();
