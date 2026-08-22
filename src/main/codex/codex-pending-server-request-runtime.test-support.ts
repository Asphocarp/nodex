import { CodexAppServerNoResponse } from "@nodex/effect-codex-app-server/protocol";
import type { RequestId } from "@nodex/codex-app-server-protocol";
import {
  buildCodexPendingServerRequestEntry,
  CodexPendingServerRequestRuntimeClosedError,
  type CodexPendingServerRequest,
  type CodexPendingServerRequestCounts,
  type CodexPendingServerRequestFor,
  type CodexPendingServerRequestIdentity,
  type CodexPendingServerRequestKind,
  type CodexPendingServerRequestRegistration,
  type CodexPendingServerRequestResponse,
  type CodexPendingServerRequestRuntimeService,
  type CodexServerRequestOccurrenceCompletion,
} from "../codex-application/CodexPendingServerRequestRuntime";

interface TestCodexPendingServerRequestRuntimeOptions {
  readonly respond: (
    threadId: string,
    requestId: RequestId,
    occurrenceToken: number,
    response: unknown,
  ) => void;
  readonly reject: (
    threadId: string,
    requestId: RequestId,
    occurrenceToken: number,
    reason: unknown,
  ) => void;
}

type EntryState = "claimed" | "queued" | "settled";

/** Synchronous fixture for the legacy CodexService suite; production uses the scoped Module. */
export class TestCodexPendingServerRequestRuntime implements CodexPendingServerRequestRuntimeService {
  private readonly all = new Set<CodexPendingServerRequest>();
  private readonly entriesByKind = new Map<
    CodexPendingServerRequestKind,
    Map<RequestId, CodexPendingServerRequest[]>
  >();
  private readonly stateByEntry = new WeakMap<CodexPendingServerRequest, EntryState>();
  private closed = false;

  constructor(private readonly options: TestCodexPendingServerRequestRuntimeOptions) {}

  completion(
    threadId: string,
    requestId: RequestId,
    occurrenceToken: number | undefined,
  ): CodexServerRequestOccurrenceCompletion {
    if (occurrenceToken === undefined) {
      throw new Error("Codex application request is missing its Effect occurrence token");
    }
    let settled = false;
    return {
      resolve: (response) => {
        if (settled) return;
        settled = true;
        this.options.respond(threadId, requestId, occurrenceToken, response);
      },
      reject: (reason) => {
        if (settled) return;
        settled = true;
        this.options.reject(threadId, requestId, occurrenceToken, reason);
      },
    };
  }

  register<Registration extends CodexPendingServerRequestRegistration>(
    registration: Registration,
  ): CodexPendingServerRequestFor<Registration["kind"]> {
    if (this.closed) throw new CodexPendingServerRequestRuntimeClosedError();
    const entry = buildCodexPendingServerRequestEntry(registration);
    const byId =
      this.entriesByKind.get(entry.kind) ?? new Map<RequestId, CodexPendingServerRequest[]>();
    this.entriesByKind.set(entry.kind, byId);
    const queue = byId.get(entry.requestId) ?? [];
    queue.push(entry);
    byId.set(entry.requestId, queue);
    this.all.add(entry);
    this.stateByEntry.set(entry, "queued");
    return entry as CodexPendingServerRequestFor<Registration["kind"]>;
  }

  find<Kind extends CodexPendingServerRequestKind>(
    kind: Kind,
    requestId: RequestId,
    predicate: (entry: CodexPendingServerRequestFor<Kind>) => boolean = () => true,
  ): CodexPendingServerRequestFor<Kind> | undefined {
    const queue = this.entriesByKind.get(kind)?.get(requestId) ?? [];
    return queue.find((entry) => predicate(entry as CodexPendingServerRequestFor<Kind>)) as
      | CodexPendingServerRequestFor<Kind>
      | undefined;
  }

  takeFirst<Kind extends CodexPendingServerRequestKind>(
    kind: Kind,
    requestId: RequestId,
    predicate: (entry: CodexPendingServerRequestFor<Kind>) => boolean = () => true,
  ): CodexPendingServerRequestFor<Kind> | undefined {
    return this.claim(kind, requestId, predicate, false)[0];
  }

  takeAll<Kind extends CodexPendingServerRequestKind>(
    kind: Kind,
    requestId: RequestId,
    predicate: (entry: CodexPendingServerRequestFor<Kind>) => boolean = () => true,
  ): readonly CodexPendingServerRequestFor<Kind>[] {
    return this.claim(kind, requestId, predicate, true);
  }

  has(kind: CodexPendingServerRequestKind, requestId: RequestId): boolean {
    return (this.entriesByKind.get(kind)?.get(requestId)?.length ?? 0) > 0;
  }

  counts(): CodexPendingServerRequestCounts {
    const count = (kind: CodexPendingServerRequestKind): number =>
      [...this.all].filter((entry) => entry.kind === kind).length;
    const counts = {
      approvals: count("approval"),
      dynamicToolCalls: count("dynamic-tool"),
      mcpElicitations: count("mcp-elicitation"),
      permissionRequests: count("permission"),
      privateServerRequests: count("private"),
      userInputs: count("user-input"),
    };
    return { ...counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) };
  }

  complete<Entry extends CodexPendingServerRequest>(
    entry: Entry,
    response: CodexPendingServerRequestResponse<Entry>,
  ): void {
    if (!this.settle(entry)) return;
    this.options.respond(entry.threadId, entry.requestId, entry.occurrenceToken, response);
  }

  reject(entry: CodexPendingServerRequest, reason: unknown): void {
    if (!this.settle(entry)) return;
    this.options.reject(entry.threadId, entry.requestId, entry.occurrenceToken, reason);
  }

  discard(entry: CodexPendingServerRequest): void {
    this.settle(entry);
  }

  disconnectIdentities(): readonly CodexPendingServerRequestIdentity[] {
    const byIdentity = new Map<string, CodexPendingServerRequestIdentity>();
    for (const entry of this.queuedMatching(
      (candidate) => candidate.kind !== "dynamic-tool" || candidate.disposition === "stored",
    )) {
      byIdentity.set(
        `${entry.threadId}\u0000${typeof entry.requestId}:${String(entry.requestId)}`,
        { threadId: entry.threadId, requestId: entry.requestId },
      );
    }
    return [...byIdentity.values()];
  }

  abandonIdentity(threadId: string, requestId: RequestId): void {
    for (const entry of this.queuedMatching(
      (candidate) =>
        candidate.threadId === threadId &&
        candidate.requestId === requestId &&
        (candidate.kind !== "dynamic-tool" || candidate.disposition === "stored"),
    )) {
      this.complete(entry, CodexAppServerNoResponse);
    }
  }

  rejectRemovedTurns(
    threadId: string,
    retainedTurnIds: ReadonlySet<string>,
    options: { readonly retainTurnless?: boolean } = {},
  ): void {
    const retainTurnless = options.retainTurnless ?? true;
    for (const entry of [...this.all]) {
      if (entry.threadId !== threadId) continue;
      if ((retainTurnless && entry.turnId.length === 0) || retainedTurnIds.has(entry.turnId)) {
        continue;
      }
      this.reject(entry, new Error(`${entry.kind} request cleared after thread history changed`));
    }
  }

  rejectDispatchedDynamicForThread(threadId: string, reason: unknown): void {
    for (const entry of [...this.all]) {
      if (
        entry.kind !== "dynamic-tool" ||
        entry.disposition !== "dispatched" ||
        entry.threadId !== threadId
      ) {
        continue;
      }
      this.reject(entry, reason);
    }
  }

  async shutdown(reason: unknown): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const entry of [...this.all]) this.reject(entry, reason);
  }

  private claim<Kind extends CodexPendingServerRequestKind>(
    kind: Kind,
    requestId: RequestId,
    predicate: (entry: CodexPendingServerRequestFor<Kind>) => boolean,
    all: boolean,
  ): readonly CodexPendingServerRequestFor<Kind>[] {
    const queue = this.entriesByKind.get(kind)?.get(requestId) ?? [];
    const selected: CodexPendingServerRequestFor<Kind>[] = [];
    for (const candidate of [...queue]) {
      const entry = candidate as CodexPendingServerRequestFor<Kind>;
      if (!predicate(entry)) continue;
      this.removeQueued(entry);
      this.stateByEntry.set(entry, "claimed");
      selected.push(entry);
      if (!all) break;
    }
    return selected;
  }

  private settle(entry: CodexPendingServerRequest): boolean {
    if (this.stateByEntry.get(entry) === "settled") return false;
    this.removeQueued(entry);
    this.stateByEntry.set(entry, "settled");
    this.all.delete(entry);
    return true;
  }

  private removeQueued(entry: CodexPendingServerRequest): void {
    const byId = this.entriesByKind.get(entry.kind);
    const queue = byId?.get(entry.requestId);
    if (!queue) return;
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
    if (queue.length === 0) byId?.delete(entry.requestId);
    if (byId?.size === 0) this.entriesByKind.delete(entry.kind);
  }

  private queuedMatching(
    predicate: (entry: CodexPendingServerRequest) => boolean,
  ): readonly CodexPendingServerRequest[] {
    return [...this.all].filter(
      (entry) => this.stateByEntry.get(entry) === "queued" && predicate(entry),
    );
  }
}
