import type { FrozenNodexAgentTurnAuthority } from "./nodex-agent-authority";
import type {
  LibraryResource,
  ProjectResourceAction,
  ProjectResourceAuthorizationReason,
} from "./resource-authorization";

/**
 * Internal resource coordinates used by main and the SQLite writer while
 * authorizing Nodex tools. These shapes never enter the public tool catalog.
 */
export type NodexAgentAuthorizationTarget =
  | LibraryResource
  | { readonly kind: "library"; readonly libraryId: string }
  | { readonly kind: "page_or_block"; readonly id: string };

export interface NodexAgentResourceIntent {
  readonly target: NodexAgentAuthorizationTarget;
  readonly action: ProjectResourceAction;
}

export type NodexAgentResourceGrantRoot =
  | { readonly kind: "page"; readonly pageId: string }
  | { readonly kind: "database"; readonly databaseId: string }
  | { readonly kind: "library"; readonly libraryId: string };

export interface NodexAgentResourceGrantSpec {
  readonly root: NodexAgentResourceGrantRoot;
  readonly access: "read" | "read_write";
  /** Library roots are capability-specific and never imply whole-Library access. */
  readonly libraryActions?: readonly Extract<ProjectResourceAction, "create_child">[];
}

interface NodexAgentResourceAccessOverlayBase {
  readonly kind: "inspection" | "consent";
  readonly rootThreadId: string;
  readonly actorProjectId: string;
  readonly libraryId: string;
  readonly storeEpoch: string;
  readonly grants: readonly NodexAgentResourceGrantSpec[];
  /**
   * A Project-scoped decision for a Library destination cannot be persisted
   * until the resulting Pages exist. The mutation transaction consumes this
   * bit by creating Page-root grants atomically with the placement.
   */
  readonly persistResultingPageGrants?: boolean;
}

export type NodexAgentResourceAccessOverlay =
  | (NodexAgentResourceAccessOverlayBase & {
      readonly scope: "call";
      readonly threadId: string;
      readonly turnId: string;
      readonly callId: string;
    })
  | (NodexAgentResourceAccessOverlayBase & {
      readonly kind: "consent";
      readonly scope: "task";
    });

export interface NodexAgentResourceConsentRequirement {
  readonly intent: NodexAgentResourceIntent;
  readonly grant: NodexAgentResourceGrantSpec;
  readonly reason: Extract<
    ProjectResourceAuthorizationReason,
    "grant_missing" | "grant_read_only"
  > | "library_consent_required";
  readonly persistable: boolean;
}

export type NodexAgentResourceAccessPlan =
  | {
      readonly kind: "authorized";
      readonly resourceAccess?: NodexAgentResourceAccessOverlay;
    }
  | {
      readonly kind: "consent_required";
      readonly requirements: readonly NodexAgentResourceConsentRequirement[];
      readonly inspectionAccess: NodexAgentResourceAccessOverlay;
    }
  | {
      readonly kind: "denied";
      readonly intent: NodexAgentResourceIntent;
      readonly reason: ProjectResourceAuthorizationReason;
    };

export interface PersistNodexAgentProjectResourceGrantsInput {
  readonly authority: FrozenNodexAgentTurnAuthority;
  readonly grants: readonly NodexAgentResourceGrantSpec[];
}
