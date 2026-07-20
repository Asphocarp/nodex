import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

import {
  NODEX_AGENT_AUTHORITY_PROVENANCE_VERSION,
  nodexAgentAuthorityFingerprint,
  type FrozenNodexAgentTurnAuthority,
  type NodexAgentAuthoritySource,
} from "../../shared/nodex-agent-authority";
import type { NodexAgentAccess } from "../../shared/nodex-agent-tools";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { getDb } from "../local-store/database";
import { FULL_ACCESS_PERMISSION_PROFILE_ID } from "./codex-permission-resolver";
import type {
  BeginNodexAgentTurnAuthorityInput,
  CaptureNodexAgentTurnAuthorityInput,
  NodexAgentAuthorityPort,
  NodexAgentTurnAuthorityLaunch,
} from "../nodex-agent-authority-port";

export type {
  BeginNodexAgentTurnAuthorityInput,
  CaptureNodexAgentTurnAuthorityInput,
  NodexAgentTurnAuthorityLaunch,
} from "../nodex-agent-authority-port";

interface ProjectAuthorityCoordinates {
  readonly projectId: string;
  readonly libraryId: string;
  readonly profileId: string;
  readonly storeEpoch: string;
}

interface AuthorityRow {
  readonly thread_id: string;
  readonly turn_id: string;
  readonly root_thread_id: string;
  readonly actor_project_id: string;
  readonly library_id: string;
  readonly profile_id: string;
  readonly store_epoch: string;
  readonly scope: FrozenNodexAgentTurnAuthority["scope"];
  readonly source: NodexAgentAuthoritySource;
  readonly permission_profile_id: string | null;
  readonly authority_fingerprint: string;
  readonly provenance_version: number;
}

const normalizeIdentity = (value: string): string | null => {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 512
    ? normalized
    : null;
};

const readProjectAuthorityCoordinates = (
  database: Database.Database,
  projectId: string,
): ProjectAuthorityCoordinates | null => {
  const row = database.prepare(`
    SELECT
      project.id AS projectId,
      project.library_id AS libraryId,
      library.profile_id AS profileId
    FROM projects project
    INNER JOIN libraries library ON library.id = project.library_id
    WHERE project.id = ?
    LIMIT 1
  `).get(projectId) as Omit<ProjectAuthorityCoordinates, "storeEpoch"> | undefined;
  const storeEpoch = readBlockStoreEpoch(database);
  if (!row || !storeEpoch) return null;
  return { ...row, storeEpoch };
};

export const canAutoApproveNodexAgentWrite = (
  frozen: FrozenNodexAgentTurnAuthority | null,
  current: FrozenNodexAgentTurnAuthority | null,
): boolean => frozen?.scope === "library"
  && current?.scope === "library"
  && nodexAgentAuthorityFingerprint(frozen)
    === nodexAgentAuthorityFingerprint(current);

export const resolveNodexAgentWriteAccess = (input: {
  readonly authorityScope: FrozenNodexAgentTurnAuthority["scope"] | null;
  readonly hasActorProject: boolean;
}): NodexAgentAccess["write"] => {
  if (!input.hasActorProject || input.authorityScope === null) return "unavailable";
  return "granted";
};

const authorityFromRow = (row: AuthorityRow): FrozenNodexAgentTurnAuthority => ({
  threadId: row.thread_id,
  turnId: row.turn_id,
  rootThreadId: row.root_thread_id,
  actorProjectId: row.actor_project_id,
  libraryId: row.library_id,
  storeEpoch: row.store_epoch,
  scope: row.scope,
  source: row.source,
});

const readAuthorityRow = (
  database: Database.Database,
  threadId: string,
  turnId: string,
): AuthorityRow | null => (
  database.prepare(`
    SELECT
      thread_id, turn_id, root_thread_id, actor_project_id, library_id,
      profile_id, store_epoch, scope, source, permission_profile_id,
      authority_fingerprint, provenance_version
    FROM nodex_agent_turn_authorities
    WHERE thread_id = ? AND turn_id = ?
    LIMIT 1
  `).get(threadId, turnId) as AuthorityRow | undefined
) ?? null;

const rowsMatch = (left: AuthorityRow, right: AuthorityRow): boolean =>
  left.thread_id === right.thread_id
  && left.turn_id === right.turn_id
  && left.root_thread_id === right.root_thread_id
  && left.actor_project_id === right.actor_project_id
  && left.library_id === right.library_id
  && left.profile_id === right.profile_id
  && left.store_epoch === right.store_epoch
  && left.scope === right.scope
  && left.source === right.source
  && left.permission_profile_id === right.permission_profile_id
  && left.authority_fingerprint === right.authority_fingerprint
  && left.provenance_version === right.provenance_version;

export class CodexNodexAgentAuthorityRegistry {
  private readonly pendingByThreadId = new Map<
    string,
    NodexAgentTurnAuthorityLaunch[]
  >();

  constructor(
    private readonly readDatabase: () => Database.Database = getDb,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  beginTurn(
    input: BeginNodexAgentTurnAuthorityInput,
  ): NodexAgentTurnAuthorityLaunch | null {
    const threadId = normalizeIdentity(input.threadId);
    const rootThreadId = normalizeIdentity(input.rootThreadId);
    const actorProjectId = normalizeIdentity(input.actorProjectId);
    if (!threadId || !rootThreadId || !actorProjectId) return null;

    const coordinates = readProjectAuthorityCoordinates(
      this.readDatabase(),
      actorProjectId,
    );
    if (!coordinates) return null;

    const inherited = input.inheritedAuthority;
    const inheritsLibraryAuthority = inherited?.scope === "library"
      && inherited.actorProjectId === actorProjectId
      && inherited.libraryId === coordinates.libraryId
      && inherited.storeEpoch === coordinates.storeEpoch;
    const builtinFullAccess = input.builtinFullAccess;
    const scope = builtinFullAccess || inheritsLibraryAuthority
      ? "library"
      : "project";
    const source: NodexAgentAuthoritySource = builtinFullAccess
      ? "builtin_full_access"
      : inheritsLibraryAuthority
        ? "inherited_builtin_full_access"
        : "project_turn";
    const launch: NodexAgentTurnAuthorityLaunch = {
      launchId: randomUUID(),
      snapshot: {
        threadId,
        rootThreadId,
        actorProjectId,
        libraryId: coordinates.libraryId,
        profileId: coordinates.profileId,
        storeEpoch: coordinates.storeEpoch,
        scope,
        source,
        permissionProfileId: scope === "library"
          ? FULL_ACCESS_PERMISSION_PROFILE_ID
          : null,
      },
      boundTurnId: null,
      aborted: false,
    };
    const pending = this.pendingByThreadId.get(threadId) ?? [];
    pending.push(launch);
    this.pendingByThreadId.set(threadId, pending);
    return launch;
  }

  bindTurn(
    launch: NodexAgentTurnAuthorityLaunch | null,
    rawTurnId: string,
  ): FrozenNodexAgentTurnAuthority | null {
    if (!launch || launch.aborted) return null;
    const turnId = normalizeIdentity(rawTurnId);
    if (!turnId) return null;
    if (launch.boundTurnId && launch.boundTurnId !== turnId) {
      throw new Error(
        `Nodex Agent authority launch ${launch.launchId} is already bound to Turn ${launch.boundTurnId}`,
      );
    }

    const authority: FrozenNodexAgentTurnAuthority = {
      threadId: launch.snapshot.threadId,
      turnId,
      rootThreadId: launch.snapshot.rootThreadId,
      actorProjectId: launch.snapshot.actorProjectId,
      libraryId: launch.snapshot.libraryId,
      storeEpoch: launch.snapshot.storeEpoch,
      scope: launch.snapshot.scope,
      source: launch.snapshot.source,
    };
    const fingerprint = nodexAgentAuthorityFingerprint(authority);
    const row: AuthorityRow = {
      thread_id: authority.threadId,
      turn_id: authority.turnId,
      root_thread_id: authority.rootThreadId,
      actor_project_id: authority.actorProjectId,
      library_id: authority.libraryId,
      profile_id: launch.snapshot.profileId,
      store_epoch: authority.storeEpoch,
      scope: authority.scope,
      source: authority.source,
      permission_profile_id: launch.snapshot.permissionProfileId,
      authority_fingerprint: fingerprint,
      provenance_version: NODEX_AGENT_AUTHORITY_PROVENANCE_VERSION,
    };
    const database = this.readDatabase();
    const publish = database.transaction(() => {
      const existing = readAuthorityRow(database, authority.threadId, authority.turnId);
      if (existing) {
        if (rowsMatch(existing, row)) return;
        throw new Error(
          `Nodex Agent authority for ${authority.threadId}/${authority.turnId} has different provenance`,
        );
      }
      database.prepare(`
        INSERT INTO nodex_agent_turn_authorities (
          thread_id, turn_id, root_thread_id, actor_project_id, library_id,
          profile_id, store_epoch, scope, source, permission_profile_id,
          authority_fingerprint, provenance_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.thread_id,
        row.turn_id,
        row.root_thread_id,
        row.actor_project_id,
        row.library_id,
        row.profile_id,
        row.store_epoch,
        row.scope,
        row.source,
        row.permission_profile_id,
        row.authority_fingerprint,
        row.provenance_version,
        this.now(),
      );
    });
    publish.immediate();
    launch.boundTurnId = turnId;
    this.removePending(launch);
    return authority;
  }

  observeTurnStarted(
    rawThreadId: string,
    rawTurnId: string,
  ): FrozenNodexAgentTurnAuthority | null {
    const threadId = normalizeIdentity(rawThreadId);
    if (!threadId) return null;
    const pending = this.pendingByThreadId.get(threadId);
    const launch = pending?.find((candidate) => !candidate.aborted) ?? null;
    return this.bindTurn(launch, rawTurnId);
  }

  abortTurn(launch: NodexAgentTurnAuthorityLaunch | null): void {
    if (!launch || launch.boundTurnId) return;
    launch.aborted = true;
    this.removePending(launch);
  }

  inheritTurn(
    input: CaptureNodexAgentTurnAuthorityInput,
    inheritedAuthority: FrozenNodexAgentTurnAuthority,
  ): FrozenNodexAgentTurnAuthority | null {
    const launch = this.beginTurn({
      threadId: input.threadId,
      rootThreadId: input.rootThreadId,
      actorProjectId: input.actorProjectId,
      builtinFullAccess: false,
      inheritedAuthority,
    });
    if (!launch || launch.snapshot.scope !== "library") {
      this.abortTurn(launch);
      return null;
    }
    try {
      return this.bindTurn(launch, input.turnId);
    } catch (error) {
      this.abortTurn(launch);
      throw error;
    }
  }

  capturePersisted(
    input: CaptureNodexAgentTurnAuthorityInput,
  ): FrozenNodexAgentTurnAuthority | null {
    const threadId = normalizeIdentity(input.threadId);
    const turnId = normalizeIdentity(input.turnId);
    const rootThreadId = normalizeIdentity(input.rootThreadId);
    const actorProjectId = normalizeIdentity(input.actorProjectId);
    if (!threadId || !turnId || !rootThreadId || !actorProjectId) return null;

    const database = this.readDatabase();
    const coordinates = readProjectAuthorityCoordinates(database, actorProjectId);
    if (!coordinates) return null;
    const row = readAuthorityRow(database, threadId, turnId);
    if (!row) return null;
    const authority = authorityFromRow(row);
    const fingerprint = nodexAgentAuthorityFingerprint(authority);
    const libraryProvenanceValid = authority.scope === "project"
      ? row.permission_profile_id === null
      : row.permission_profile_id === FULL_ACCESS_PERMISSION_PROFILE_ID;
    if (
      row.provenance_version !== NODEX_AGENT_AUTHORITY_PROVENANCE_VERSION
      || fingerprint !== row.authority_fingerprint
      || authority.rootThreadId !== rootThreadId
      || authority.actorProjectId !== actorProjectId
      || authority.libraryId !== coordinates.libraryId
      || row.profile_id !== coordinates.profileId
      || authority.storeEpoch !== coordinates.storeEpoch
      || !libraryProvenanceValid
    ) {
      return null;
    }
    return authority;
  }

  hasRecordedAuthority(threadId: string, turnId: string): boolean {
    const normalizedThreadId = normalizeIdentity(threadId);
    const normalizedTurnId = normalizeIdentity(turnId);
    if (!normalizedThreadId || !normalizedTurnId) return false;
    return readAuthorityRow(
      this.readDatabase(),
      normalizedThreadId,
      normalizedTurnId,
    ) !== null;
  }

  capture(
    input: CaptureNodexAgentTurnAuthorityInput,
  ): FrozenNodexAgentTurnAuthority | null {
    const threadId = normalizeIdentity(input.threadId);
    const turnId = normalizeIdentity(input.turnId);
    const rootThreadId = normalizeIdentity(input.rootThreadId);
    const actorProjectId = normalizeIdentity(input.actorProjectId);
    if (!threadId || !turnId || !rootThreadId || !actorProjectId) return null;

    const database = this.readDatabase();
    const coordinates = readProjectAuthorityCoordinates(database, actorProjectId);
    if (!coordinates) return null;
    const persisted = this.capturePersisted(input);
    if (persisted) return persisted;
    if (readAuthorityRow(database, threadId, turnId)) return null;
    const bound = this.observeTurnStarted(threadId, turnId);
    if (bound) return this.capture(input);
    return {
      threadId,
      turnId,
      rootThreadId,
      actorProjectId,
      libraryId: coordinates.libraryId,
      storeEpoch: coordinates.storeEpoch,
      scope: "project",
      source: "project_turn",
    };
  }

  private removePending(launch: NodexAgentTurnAuthorityLaunch): void {
    const pending = this.pendingByThreadId.get(launch.snapshot.threadId);
    if (!pending) return;
    const next = pending.filter((candidate) => candidate !== launch);
    if (next.length === 0) {
      this.pendingByThreadId.delete(launch.snapshot.threadId);
      return;
    }
    this.pendingByThreadId.set(launch.snapshot.threadId, next);
  }
}

export const createTypeScriptNodexAgentAuthorityPort = (
  registry = new CodexNodexAgentAuthorityRegistry(),
): NodexAgentAuthorityPort => ({
  beginTurn: async (input) => registry.beginTurn(input),
  bindTurn: async (launch, turnId) => registry.bindTurn(launch, turnId),
  observeTurnStarted: async (threadId, turnId) =>
    registry.observeTurnStarted(threadId, turnId),
  abortTurn: (launch) => registry.abortTurn(launch),
  inheritTurn: async (input, inheritedAuthority) =>
    registry.inheritTurn(input, inheritedAuthority),
  capturePersisted: async (input) => registry.capturePersisted(input),
  hasRecordedAuthority: async (input) =>
    registry.hasRecordedAuthority(input.threadId, input.turnId),
  capture: async (input) => registry.capture(input),
});
