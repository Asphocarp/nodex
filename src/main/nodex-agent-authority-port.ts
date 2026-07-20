import type { FrozenNodexAgentTurnAuthority } from "../shared/nodex-agent-authority";

export interface PendingNodexAgentAuthoritySnapshot {
  readonly threadId: string;
  readonly rootThreadId: string;
  readonly actorProjectId: string;
  readonly libraryId: string;
  readonly profileId: string;
  readonly storeEpoch: string;
  readonly scope: FrozenNodexAgentTurnAuthority["scope"];
  readonly source: FrozenNodexAgentTurnAuthority["source"];
  readonly permissionProfileId: string | null;
  readonly inheritedFrom?: Readonly<{
    threadId: string;
    turnId: string;
  }>;
}

export interface NodexAgentTurnAuthorityLaunch {
  readonly launchId: string;
  readonly snapshot: PendingNodexAgentAuthoritySnapshot;
  boundTurnId: string | null;
  aborted: boolean;
}

export interface BeginNodexAgentTurnAuthorityInput {
  readonly threadId: string;
  readonly rootThreadId: string;
  readonly actorProjectId: string;
  readonly builtinFullAccess: boolean;
  readonly inheritedAuthority?: FrozenNodexAgentTurnAuthority | null;
}

export interface CaptureNodexAgentTurnAuthorityInput {
  readonly threadId: string;
  readonly turnId: string;
  readonly rootThreadId: string;
  readonly actorProjectId: string;
}

export interface NodexAgentAuthorityPort {
  beginTurn(
    input: BeginNodexAgentTurnAuthorityInput,
  ): Promise<NodexAgentTurnAuthorityLaunch | null>;
  bindTurn(
    launch: NodexAgentTurnAuthorityLaunch | null,
    turnId: string,
  ): Promise<FrozenNodexAgentTurnAuthority | null>;
  observeTurnStarted(
    threadId: string,
    turnId: string,
  ): Promise<FrozenNodexAgentTurnAuthority | null>;
  abortTurn(launch: NodexAgentTurnAuthorityLaunch | null): void;
  inheritTurn(
    input: CaptureNodexAgentTurnAuthorityInput,
    inheritedAuthority: FrozenNodexAgentTurnAuthority,
  ): Promise<FrozenNodexAgentTurnAuthority | null>;
  capturePersisted(
    input: CaptureNodexAgentTurnAuthorityInput,
  ): Promise<FrozenNodexAgentTurnAuthority | null>;
  hasRecordedAuthority(
    input: CaptureNodexAgentTurnAuthorityInput,
  ): Promise<boolean>;
  capture(
    input: CaptureNodexAgentTurnAuthorityInput,
  ): Promise<FrozenNodexAgentTurnAuthority | null>;
}
