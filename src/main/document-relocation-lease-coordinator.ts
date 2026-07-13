export const DEFAULT_DOCUMENT_RELOCATION_LEASE_DEADLINE_MS = 5_000;
export const MAX_DOCUMENT_RELOCATION_LEASE_DEADLINE_MS = 10_000;
const MAX_CLOSED_LEASE_RECEIPTS = 1_024;
const MAX_IDENTITY_LENGTH = 512;

export interface RelocationLeaseDocumentHead {
  readonly documentId: string;
  readonly generation: number;
  readonly expectedHeadSeq: number;
}

export interface BeginDocumentRelocationLease {
  readonly leaseId: string;
  readonly documents: readonly RelocationLeaseDocumentHead[];
  readonly deadlineMs?: number;
}

export interface DocumentRelocationLeaseAcknowledgement {
  readonly participantSessionKey: string;
  readonly documentId: string;
  readonly generation: number;
  readonly headSeq: number;
  readonly acknowledgedAt: number;
}

export interface PreparedDocumentRelocationLease {
  readonly leaseId: string;
  readonly deadlineAt: number;
  readonly preparedAt: number;
  readonly documents: readonly RelocationLeaseDocumentHead[];
  readonly resolvedHeads: readonly {
    readonly documentId: string;
    readonly generation: number;
    readonly headSeq: number;
  }[];
  readonly acknowledgements: readonly DocumentRelocationLeaseAcknowledgement[];
}

export type DocumentRelocationLeaseEvent =
  | {
      readonly kind: "prepare";
      readonly leaseId: string;
      readonly participantSessionKey: string;
      readonly documents: readonly RelocationLeaseDocumentHead[];
      readonly deadlineAt: number;
    }
  | {
      readonly kind: "release";
      readonly leaseId: string;
      readonly participantSessionKey: string;
      readonly documentIds: readonly string[];
      readonly releasedAt: number;
    }
  | {
      readonly kind: "cancel";
      readonly leaseId: string;
      readonly participantSessionKey: string;
      readonly documentIds: readonly string[];
      readonly reason: DocumentRelocationLeaseFailureCode;
      readonly cancelledAt: number;
    };

export type DocumentRelocationLeaseFailureCode =
  | "invalid_request"
  | "lease_id_collision"
  | "document_busy"
  | "prepare_publish_failed"
  | "participant_disconnected"
  | "participant_nack"
  | "lease_timeout"
  | "lease_cancelled";

export interface DocumentRelocationLeaseFailure {
  readonly code: DocumentRelocationLeaseFailureCode;
  readonly message: string;
  readonly leaseId?: string;
  readonly documentId?: string;
  readonly participantSessionKey?: string;
}

export type DocumentRelocationLeasePrepareResult =
  | { readonly ok: true; readonly value: PreparedDocumentRelocationLease }
  | { readonly ok: false; readonly error: DocumentRelocationLeaseFailure };

export type DocumentRelocationLeaseCommandErrorCode =
  | "invalid_request"
  | "document_busy"
  | "lease_not_found"
  | "lease_not_prepared"
  | "lease_closed"
  | "participant_not_expected"
  | "document_not_expected"
  | "duplicate_ack"
  | "document_generation_mismatch"
  | "document_head_regressed";

export interface DocumentRelocationLeaseCommandError {
  readonly code: DocumentRelocationLeaseCommandErrorCode;
  readonly message: string;
  readonly leaseId?: string;
  readonly documentId?: string;
  readonly participantSessionKey?: string;
}

export type DocumentRelocationLeaseCommandResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: DocumentRelocationLeaseCommandError };

export interface DocumentRelocationLeaseCoordinatorClock {
  readonly now: () => number;
}

export interface DocumentRelocationLeaseCoordinatorTimers {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (timer: unknown) => void;
}

export interface DocumentRelocationLeaseCoordinatorOptions {
  readonly publishEvent: (event: DocumentRelocationLeaseEvent) => void;
  readonly clock?: DocumentRelocationLeaseCoordinatorClock;
  readonly timers?: DocumentRelocationLeaseCoordinatorTimers;
  readonly defaultDeadlineMs?: number;
}

interface ExpectedAcknowledgement {
  readonly participantSessionKey: string;
  readonly document: RelocationLeaseDocumentHead;
}

interface ActiveLease {
  readonly leaseId: string;
  readonly documents: readonly RelocationLeaseDocumentHead[];
  readonly expectedAcknowledgements: ReadonlyMap<
    string,
    ExpectedAcknowledgement
  >;
  readonly participantDocuments: ReadonlyMap<
    string,
    readonly RelocationLeaseDocumentHead[]
  >;
  readonly acknowledgements: Map<
    string,
    DocumentRelocationLeaseAcknowledgement
  >;
  readonly deadlineAt: number;
  readonly timer: unknown;
  readonly resolve: (result: DocumentRelocationLeasePrepareResult) => void;
  phase: "publishing" | "preparing" | "prepared";
  preparedValue: PreparedDocumentRelocationLease | null;
}

interface ClosedLeaseReceipt {
  readonly outcome: "released" | "cancelled";
  readonly reason?: DocumentRelocationLeaseFailureCode;
}

const defaultClock: DocumentRelocationLeaseCoordinatorClock = {
  now: () => Date.now(),
};

const defaultTimers: DocumentRelocationLeaseCoordinatorTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

const isBoundedIdentity = (value: string): boolean =>
  value.length > 0 &&
  value.length <= MAX_IDENTITY_LENGTH &&
  value === value.trim();

const isSafeIntegerAtLeast = (value: number, minimum: number): boolean =>
  Number.isSafeInteger(value) && value >= minimum;

const acknowledgementKey = (
  participantSessionKey: string,
  documentId: string,
): string => JSON.stringify([participantSessionKey, documentId]);

const normalizeDocuments = (
  documents: readonly RelocationLeaseDocumentHead[],
):
  | {
      readonly ok: true;
      readonly value: readonly RelocationLeaseDocumentHead[];
    }
  | { readonly ok: false; readonly message: string } => {
  if (documents.length < 1) {
    return { ok: false, message: "A relocation lease requires a Document" };
  }
  const normalized = documents.map((document) => ({ ...document }));
  for (const document of normalized) {
    if (!isBoundedIdentity(document.documentId)) {
      return { ok: false, message: "Document identity is invalid" };
    }
    if (!isSafeIntegerAtLeast(document.generation, 1)) {
      return { ok: false, message: "Document generation is invalid" };
    }
    if (!isSafeIntegerAtLeast(document.expectedHeadSeq, 0)) {
      return { ok: false, message: "Document head is invalid" };
    }
  }
  const documentIds = normalized.map((document) => document.documentId);
  if (new Set(documentIds).size !== documentIds.length) {
    return { ok: false, message: "Relocation lease Documents must be unique" };
  }
  normalized.sort((left, right) =>
    left.documentId < right.documentId
      ? -1
      : left.documentId > right.documentId
        ? 1
        : 0,
  );
  return { ok: true, value: normalized };
};

const normalizeDeadlineMs = (
  value: number | undefined,
  fallback: number,
): number | null => {
  const deadlineMs = value ?? fallback;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) return null;
  return Math.min(
    Math.max(1, Math.floor(deadlineMs)),
    MAX_DOCUMENT_RELOCATION_LEASE_DEADLINE_MS,
  );
};

export class DocumentRelocationLeaseCoordinator {
  private readonly publishEvent: (event: DocumentRelocationLeaseEvent) => void;

  private readonly clock: DocumentRelocationLeaseCoordinatorClock;

  private readonly timers: DocumentRelocationLeaseCoordinatorTimers;

  private readonly defaultDeadlineMs: number;

  private readonly participantSessionsByDocument = new Map<
    string,
    Set<string>
  >();

  private readonly documentsByParticipantSession = new Map<
    string,
    Set<string>
  >();

  private readonly activeLeases = new Map<string, ActiveLease>();

  private readonly leaseIdByDocument = new Map<string, string>();

  private readonly closedLeases = new Map<string, ClosedLeaseReceipt>();

  constructor(options: DocumentRelocationLeaseCoordinatorOptions) {
    this.publishEvent = options.publishEvent;
    this.clock = options.clock ?? defaultClock;
    this.timers = options.timers ?? defaultTimers;
    const defaultDeadlineMs = normalizeDeadlineMs(
      options.defaultDeadlineMs,
      DEFAULT_DOCUMENT_RELOCATION_LEASE_DEADLINE_MS,
    );
    if (defaultDeadlineMs === null) {
      throw new Error("Default relocation lease deadline must be positive");
    }
    this.defaultDeadlineMs = defaultDeadlineMs;
  }

  subscribe(
    participantSessionKey: string,
    documentId: string,
  ): DocumentRelocationLeaseCommandResult<{ readonly duplicate: boolean }> {
    if (
      !isBoundedIdentity(participantSessionKey) ||
      !isBoundedIdentity(documentId)
    ) {
      return this.commandError(
        "invalid_request",
        "Participant session and Document identities must be non-empty",
        { participantSessionKey, documentId },
      );
    }
    const existingSessions = this.participantSessionsByDocument.get(documentId);
    if (existingSessions?.has(participantSessionKey)) {
      return { ok: true, value: { duplicate: true } };
    }
    const blockingLeaseId = this.leaseIdByDocument.get(documentId);
    if (blockingLeaseId !== undefined) {
      return this.commandError(
        "document_busy",
        `Document ${documentId} is fenced by relocation lease ${blockingLeaseId}`,
        { documentId },
      );
    }

    const sessions = existingSessions ?? new Set<string>();
    sessions.add(participantSessionKey);
    this.participantSessionsByDocument.set(documentId, sessions);
    const documents =
      this.documentsByParticipantSession.get(participantSessionKey) ??
      new Set<string>();
    documents.add(documentId);
    this.documentsByParticipantSession.set(participantSessionKey, documents);
    return { ok: true, value: { duplicate: false } };
  }

  unsubscribe(
    participantSessionKey: string,
    documentId: string,
  ): DocumentRelocationLeaseCommandResult<{ readonly removed: boolean }> {
    if (
      !isBoundedIdentity(participantSessionKey) ||
      !isBoundedIdentity(documentId)
    ) {
      return this.commandError(
        "invalid_request",
        "Participant session and Document identities must be non-empty",
        { participantSessionKey, documentId },
      );
    }
    const removed = this.removeSubscription(participantSessionKey, documentId);
    if (!removed) return { ok: true, value: { removed: false } };
    this.cancelLeasesForParticipantDocument(
      participantSessionKey,
      documentId,
      "participant_disconnected",
    );
    return { ok: true, value: { removed: true } };
  }

  disconnect(participantSessionKey: string): number {
    const documents = this.documentsByParticipantSession.get(
      participantSessionKey,
    );
    if (documents === undefined) return 0;
    const documentIds = [...documents];
    for (const documentId of documentIds) {
      this.removeSubscription(participantSessionKey, documentId);
    }
    const affectedLeaseIds = new Set<string>();
    for (const lease of this.activeLeases.values()) {
      if (
        lease.phase === "prepared" ||
        !this.hasUnacknowledgedParticipantDocument(
          lease,
          participantSessionKey,
        )
      ) {
        continue;
      }
      affectedLeaseIds.add(lease.leaseId);
    }
    for (const leaseId of affectedLeaseIds) {
      this.failLease(leaseId, {
        code: "participant_disconnected",
        message: `Participant ${participantSessionKey} disconnected during relocation preparation`,
        leaseId,
        participantSessionKey,
      });
    }
    return documentIds.length;
  }

  snapshotParticipantSessionKeys(documentId: string): readonly string[] {
    return [
      ...(this.participantSessionsByDocument.get(documentId) ?? []),
    ].sort();
  }

  getFencedDocumentIds(): readonly string[] {
    return [...this.leaseIdByDocument.keys()].sort();
  }

  prepare(
    input: BeginDocumentRelocationLease,
  ): Promise<DocumentRelocationLeasePrepareResult> {
    if (!isBoundedIdentity(input.leaseId)) {
      return Promise.resolve({
        ok: false,
        error: {
          code: "invalid_request",
          message: "Relocation lease identity is invalid",
        },
      });
    }
    if (
      this.activeLeases.has(input.leaseId) ||
      this.closedLeases.has(input.leaseId)
    ) {
      return Promise.resolve({
        ok: false,
        error: {
          code: "lease_id_collision",
          message: `Relocation lease ${input.leaseId} already exists`,
          leaseId: input.leaseId,
        },
      });
    }
    const documents = normalizeDocuments(input.documents);
    if (!documents.ok) {
      return Promise.resolve({
        ok: false,
        error: {
          code: "invalid_request",
          message: documents.message,
          leaseId: input.leaseId,
        },
      });
    }
    const deadlineMs = normalizeDeadlineMs(
      input.deadlineMs,
      this.defaultDeadlineMs,
    );
    if (deadlineMs === null) {
      return Promise.resolve({
        ok: false,
        error: {
          code: "invalid_request",
          message: "Relocation lease deadline must be positive",
          leaseId: input.leaseId,
        },
      });
    }
    for (const document of documents.value) {
      const blockingLeaseId = this.leaseIdByDocument.get(document.documentId);
      if (blockingLeaseId === undefined) continue;
      return Promise.resolve({
        ok: false,
        error: {
          code: "document_busy",
          message: `Document ${document.documentId} is fenced by relocation lease ${blockingLeaseId}`,
          leaseId: input.leaseId,
          documentId: document.documentId,
        },
      });
    }

    const participantDocuments = new Map<
      string,
      RelocationLeaseDocumentHead[]
    >();
    const expectedAcknowledgements = new Map<string, ExpectedAcknowledgement>();
    for (const document of documents.value) {
      const participantSessionKeys = this.snapshotParticipantSessionKeys(
        document.documentId,
      );
      for (const participantSessionKey of participantSessionKeys) {
        const participantDocumentHeads =
          participantDocuments.get(participantSessionKey) ?? [];
        participantDocumentHeads.push(document);
        participantDocuments.set(
          participantSessionKey,
          participantDocumentHeads,
        );
        expectedAcknowledgements.set(
          acknowledgementKey(participantSessionKey, document.documentId),
          { participantSessionKey, document },
        );
      }
    }

    const now = this.clock.now();
    const deadlineAt = now + deadlineMs;
    let resolvePrepare: (
      result: DocumentRelocationLeasePrepareResult,
    ) => void = () => undefined;
    const result = new Promise<DocumentRelocationLeasePrepareResult>(
      (resolve) => {
        resolvePrepare = resolve;
      },
    );
    const timer = this.timers.setTimeout(() => {
      this.failLease(input.leaseId, {
        code: "lease_timeout",
        message: `Relocation lease ${input.leaseId} timed out`,
        leaseId: input.leaseId,
      });
    }, deadlineMs);
    const lease: ActiveLease = {
      leaseId: input.leaseId,
      documents: documents.value,
      expectedAcknowledgements,
      participantDocuments,
      acknowledgements: new Map(),
      deadlineAt,
      timer,
      resolve: resolvePrepare,
      phase: "publishing",
      preparedValue: null,
    };
    this.activeLeases.set(input.leaseId, lease);
    for (const document of documents.value) {
      this.leaseIdByDocument.set(document.documentId, input.leaseId);
    }

    try {
      for (const [participantSessionKey, subscribedDocuments] of [
        ...participantDocuments.entries(),
      ].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
        this.publishEvent({
          kind: "prepare",
          leaseId: input.leaseId,
          participantSessionKey,
          documents: [...subscribedDocuments].sort((left, right) =>
            left.documentId < right.documentId
              ? -1
              : left.documentId > right.documentId
                ? 1
                : 0,
          ),
          deadlineAt,
        });
        if (!this.activeLeases.has(input.leaseId)) return result;
      }
    } catch (error) {
      this.failLease(input.leaseId, {
        code: "prepare_publish_failed",
        message: `Could not publish relocation preparation: ${
          error instanceof Error ? error.message : String(error)
        }`,
        leaseId: input.leaseId,
      });
      return result;
    }

    lease.phase = "preparing";
    this.prepareIfComplete(lease);
    return result;
  }

  acknowledge(input: {
    readonly leaseId: string;
    readonly participantSessionKey: string;
    readonly documentId: string;
    readonly generation: number;
    readonly headSeq: number;
  }): DocumentRelocationLeaseCommandResult<{
    readonly accepted: true;
    readonly prepared: boolean;
    readonly acknowledgedAt: number;
  }> {
    const lease = this.activeLeases.get(input.leaseId);
    if (lease === undefined) {
      return this.commandError(
        this.closedLeases.has(input.leaseId)
          ? "lease_closed"
          : "lease_not_found",
        `Relocation lease ${input.leaseId} is not accepting acknowledgements`,
        input,
      );
    }
    if (lease.phase === "prepared") {
      return this.commandError(
        "lease_closed",
        `Relocation lease ${input.leaseId} is already prepared`,
        input,
      );
    }
    const expectedKey = acknowledgementKey(
      input.participantSessionKey,
      input.documentId,
    );
    const expected = lease.expectedAcknowledgements.get(expectedKey);
    if (expected === undefined) {
      if (!lease.participantDocuments.has(input.participantSessionKey)) {
        return this.commandError(
          "participant_not_expected",
          `Participant ${input.participantSessionKey} is not part of lease ${input.leaseId}`,
          input,
        );
      }
      return this.commandError(
        "document_not_expected",
        `Participant ${input.participantSessionKey} does not hold Document ${input.documentId} in this lease`,
        input,
      );
    }
    if (lease.acknowledgements.has(expectedKey)) {
      return this.commandError(
        "duplicate_ack",
        "Each relocation lease participant must ACK a Document exactly once",
        input,
      );
    }
    if (input.generation !== expected.document.generation) {
      return this.commandError(
        "document_generation_mismatch",
        `Document ${input.documentId} generation changed during relocation preparation`,
        input,
      );
    }
    if (
      !isSafeIntegerAtLeast(input.headSeq, expected.document.expectedHeadSeq)
    ) {
      return this.commandError(
        "document_head_regressed",
        `Document ${input.documentId} ACK head precedes the fenced head`,
        input,
      );
    }
    const acknowledgedAt = this.clock.now();
    if (acknowledgedAt >= lease.deadlineAt) {
      this.failLease(input.leaseId, {
        code: "lease_timeout",
        message: `Relocation lease ${input.leaseId} timed out`,
        leaseId: input.leaseId,
      });
      return this.commandError(
        "lease_closed",
        `Relocation lease ${input.leaseId} reached its deadline`,
        input,
      );
    }
    lease.acknowledgements.set(expectedKey, {
      participantSessionKey: input.participantSessionKey,
      documentId: input.documentId,
      generation: input.generation,
      headSeq: input.headSeq,
      acknowledgedAt,
    });
    this.prepareIfComplete(lease);
    return {
      ok: true,
      value: {
        accepted: true,
        prepared: lease.preparedValue !== null,
        acknowledgedAt,
      },
    };
  }

  nack(input: {
    readonly leaseId: string;
    readonly participantSessionKey: string;
    readonly documentId: string;
    readonly message?: string;
  }): DocumentRelocationLeaseCommandResult<{ readonly cancelled: true }> {
    const lease = this.activeLeases.get(input.leaseId);
    if (lease === undefined) {
      return this.commandError(
        this.closedLeases.has(input.leaseId)
          ? "lease_closed"
          : "lease_not_found",
        `Relocation lease ${input.leaseId} is not accepting NACKs`,
        input,
      );
    }
    if (lease.phase === "prepared") {
      return this.commandError(
        "lease_closed",
        `Relocation lease ${input.leaseId} already accepted every ACK`,
        input,
      );
    }
    const key = acknowledgementKey(
      input.participantSessionKey,
      input.documentId,
    );
    if (!lease.expectedAcknowledgements.has(key)) {
      if (!lease.participantDocuments.has(input.participantSessionKey)) {
        return this.commandError(
          "participant_not_expected",
          `Participant ${input.participantSessionKey} is not part of lease ${input.leaseId}`,
          input,
        );
      }
      return this.commandError(
        "document_not_expected",
        `Participant ${input.participantSessionKey} does not hold Document ${input.documentId} in this lease`,
        input,
      );
    }
    this.failLease(input.leaseId, {
      code: "participant_nack",
      message:
        input.message?.trim() ||
        `Participant ${input.participantSessionKey} rejected relocation preparation`,
      leaseId: input.leaseId,
      documentId: input.documentId,
      participantSessionKey: input.participantSessionKey,
    });
    return { ok: true, value: { cancelled: true } };
  }

  release(leaseId: string): DocumentRelocationLeaseCommandResult<{
    readonly released: true;
    readonly duplicate: boolean;
  }> {
    const closed = this.closedLeases.get(leaseId);
    if (closed?.outcome === "released") {
      return { ok: true, value: { released: true, duplicate: true } };
    }
    if (closed !== undefined) {
      return this.commandError(
        "lease_closed",
        `Relocation lease ${leaseId} was cancelled`,
        { leaseId },
      );
    }
    const lease = this.activeLeases.get(leaseId);
    if (lease === undefined) {
      return this.commandError(
        "lease_not_found",
        `Relocation lease ${leaseId} does not exist`,
        { leaseId },
      );
    }
    if (lease.phase !== "prepared") {
      return this.commandError(
        "lease_not_prepared",
        `Relocation lease ${leaseId} cannot release before every ACK`,
        { leaseId },
      );
    }
    this.cleanupLease(lease);
    this.rememberClosed(leaseId, { outcome: "released" });
    this.publishTerminalEvents(lease, "release");
    return { ok: true, value: { released: true, duplicate: false } };
  }

  cancel(leaseId: string): DocumentRelocationLeaseCommandResult<{
    readonly cancelled: true;
    readonly duplicate: boolean;
  }> {
    const closed = this.closedLeases.get(leaseId);
    if (closed?.outcome === "cancelled") {
      return { ok: true, value: { cancelled: true, duplicate: true } };
    }
    if (closed !== undefined) {
      return this.commandError(
        "lease_closed",
        `Relocation lease ${leaseId} was already released`,
        { leaseId },
      );
    }
    const lease = this.activeLeases.get(leaseId);
    if (lease === undefined) {
      return this.commandError(
        "lease_not_found",
        `Relocation lease ${leaseId} does not exist`,
        { leaseId },
      );
    }
    this.failLease(leaseId, {
      code: "lease_cancelled",
      message: `Relocation lease ${leaseId} was cancelled by its caller`,
      leaseId,
    });
    return { ok: true, value: { cancelled: true, duplicate: false } };
  }

  private removeSubscription(
    participantSessionKey: string,
    documentId: string,
  ): boolean {
    const sessions = this.participantSessionsByDocument.get(documentId);
    if (!sessions?.delete(participantSessionKey)) return false;
    if (sessions.size === 0) {
      this.participantSessionsByDocument.delete(documentId);
    }
    const documents = this.documentsByParticipantSession.get(
      participantSessionKey,
    );
    documents?.delete(documentId);
    if (documents?.size === 0) {
      this.documentsByParticipantSession.delete(participantSessionKey);
    }
    return true;
  }

  private cancelLeasesForParticipantDocument(
    participantSessionKey: string,
    documentId: string,
    reason: DocumentRelocationLeaseFailureCode,
  ): void {
    const leaseId = this.leaseIdByDocument.get(documentId);
    if (leaseId === undefined) return;
    const lease = this.activeLeases.get(leaseId);
    if (
      lease === undefined ||
      lease.phase === "prepared" ||
      !this.hasUnacknowledgedParticipantDocument(
        lease,
        participantSessionKey,
        documentId,
      )
    ) {
      return;
    }
    this.failLease(leaseId, {
      code: reason,
      message: `Participant ${participantSessionKey} left Document ${documentId} during relocation preparation`,
      leaseId,
      documentId,
      participantSessionKey,
    });
  }

  private hasUnacknowledgedParticipantDocument(
    lease: ActiveLease,
    participantSessionKey: string,
    documentId?: string,
  ): boolean {
    const documents = lease.participantDocuments.get(participantSessionKey);
    if (!documents) return false;
    return documents.some((document) => {
      if (documentId && document.documentId !== documentId) return false;
      const key = acknowledgementKey(
        participantSessionKey,
        document.documentId,
      );
      return (
        lease.expectedAcknowledgements.has(key) &&
        !lease.acknowledgements.has(key)
      );
    });
  }

  private prepareIfComplete(lease: ActiveLease): void {
    if (lease.phase !== "preparing") return;
    if (lease.acknowledgements.size !== lease.expectedAcknowledgements.size) {
      return;
    }
    const acknowledgements = [...lease.acknowledgements.values()].sort(
      (left, right) =>
        left.documentId < right.documentId
          ? -1
          : left.documentId > right.documentId
            ? 1
            : left.participantSessionKey < right.participantSessionKey
              ? -1
              : left.participantSessionKey > right.participantSessionKey
                ? 1
                : 0,
    );
    const resolvedHeads = lease.documents.map((document) => ({
      documentId: document.documentId,
      generation: document.generation,
      headSeq: acknowledgements
        .filter((ack) => ack.documentId === document.documentId)
        .reduce(
          (headSeq, ack) => Math.max(headSeq, ack.headSeq),
          document.expectedHeadSeq,
        ),
    }));
    const preparedValue: PreparedDocumentRelocationLease = {
      leaseId: lease.leaseId,
      deadlineAt: lease.deadlineAt,
      preparedAt: this.clock.now(),
      documents: lease.documents,
      resolvedHeads,
      acknowledgements,
    };
    lease.phase = "prepared";
    lease.preparedValue = preparedValue;
    this.timers.clearTimeout(lease.timer);
    lease.resolve({ ok: true, value: preparedValue });
  }

  private failLease(
    leaseId: string,
    failure: DocumentRelocationLeaseFailure,
  ): void {
    const lease = this.activeLeases.get(leaseId);
    if (lease === undefined) return;
    const wasWaiting = lease.phase !== "prepared";
    this.cleanupLease(lease);
    this.rememberClosed(leaseId, {
      outcome: "cancelled",
      reason: failure.code,
    });
    this.publishTerminalEvents(lease, "cancel", failure.code);
    if (wasWaiting) lease.resolve({ ok: false, error: failure });
  }

  private cleanupLease(lease: ActiveLease): void {
    this.timers.clearTimeout(lease.timer);
    this.activeLeases.delete(lease.leaseId);
    for (const document of lease.documents) {
      if (this.leaseIdByDocument.get(document.documentId) !== lease.leaseId) {
        continue;
      }
      this.leaseIdByDocument.delete(document.documentId);
    }
  }

  private publishTerminalEvents(
    lease: ActiveLease,
    kind: "release" | "cancel",
    reason: DocumentRelocationLeaseFailureCode = "lease_cancelled",
  ): void {
    const timestamp = this.clock.now();
    for (const [participantSessionKey, documents] of [
      ...lease.participantDocuments.entries(),
    ].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
      try {
        if (kind === "release") {
          this.publishEvent({
            kind,
            leaseId: lease.leaseId,
            participantSessionKey,
            documentIds: documents.map((document) => document.documentId),
            releasedAt: timestamp,
          });
          continue;
        }
        this.publishEvent({
          kind,
          leaseId: lease.leaseId,
          participantSessionKey,
          documentIds: documents.map((document) => document.documentId),
          reason,
          cancelledAt: timestamp,
        });
      } catch {
        // Fences and timers are already cleaned. A dead participant transport
        // must never resurrect or retain an otherwise terminal lease.
      }
    }
  }

  private rememberClosed(leaseId: string, receipt: ClosedLeaseReceipt): void {
    this.closedLeases.set(leaseId, receipt);
    while (this.closedLeases.size > MAX_CLOSED_LEASE_RECEIPTS) {
      const oldestLeaseId = this.closedLeases.keys().next().value as
        string | undefined;
      if (oldestLeaseId === undefined) return;
      this.closedLeases.delete(oldestLeaseId);
    }
  }

  private commandError(
    code: DocumentRelocationLeaseCommandErrorCode,
    message: string,
    context: {
      readonly leaseId?: string;
      readonly documentId?: string;
      readonly participantSessionKey?: string;
    },
  ): {
    readonly ok: false;
    readonly error: DocumentRelocationLeaseCommandError;
  } {
    return {
      ok: false,
      error: {
        code,
        message,
        ...(context.leaseId === undefined ? {} : { leaseId: context.leaseId }),
        ...(context.documentId === undefined
          ? {}
          : { documentId: context.documentId }),
        ...(context.participantSessionKey === undefined
          ? {}
          : { participantSessionKey: context.participantSessionKey }),
      },
    };
  }
}
