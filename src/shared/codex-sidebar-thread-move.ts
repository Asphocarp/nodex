import { z } from "zod";
import type {
  CodexSidebarSnapshot,
} from "./types";

export type CodexSidebarProjectKind = "local" | "remote";

export type CodexSidebarThreadContainerId =
  | "pinned"
  | "chats"
  | "cloud"
  | `project-pinned:${string}`
  | `project:${string}`
  | `reorder-only:${string}`;

export interface CodexSidebarThreadContainerLocation {
  projectId: string | null;
  pinned: boolean;
}

interface CodexSidebarThreadMoveBase {
  hostId: "local";
  threadId: string;
  sourceContainerId: CodexSidebarThreadContainerId;
  targetContainerId: CodexSidebarThreadContainerId;
  projectAccessGrant?: CodexSidebarThreadMoveProjectAccessGrant;
}

export interface CodexSidebarThreadMoveProjectAccessGrant {
  targetProjectId: string;
  expectedBindingRevision: number;
  missingProjectSources: string[];
}

export type CodexSidebarThreadMovePlacement =
  | {
      beforeThreadId: string;
      insertAtEnd?: never;
      useDefaultOrder?: never;
    }
  | {
      beforeThreadId: null;
      insertAtEnd: true;
      useDefaultOrder?: never;
    }
  | {
      beforeThreadId: null;
      insertAtEnd?: never;
      useDefaultOrder: true;
    }
  | {
      beforeThreadId: null;
      insertAtEnd?: never;
      useDefaultOrder?: never;
    };

export type CodexSidebarThreadMoveInput = CodexSidebarThreadMoveBase
  & CodexSidebarThreadMovePlacement;

export interface CodexSidebarThreadMoveScope {
  projectId: string | null;
}

export interface CodexSidebarThreadMoveSuccess {
  status: "moved";
  threadId: string;
  source: CodexSidebarThreadMoveScope;
  destination: CodexSidebarThreadMoveScope;
  snapshot: CodexSidebarSnapshot;
}

export interface CodexSidebarThreadMoveConfirmationRequired {
  status: "confirmation-required";
  reason: "target-project-needs-source-access";
  threadId: string;
  targetProjectId: string;
  targetBindingRevision: number;
  missingProjectSources: string[];
  targetProjectName: string;
}

export type CodexSidebarThreadMoveResult =
  | CodexSidebarThreadMoveSuccess
  | CodexSidebarThreadMoveConfirmationRequired;

export interface CodexSidebarProjectThreadOrderInput {
  projectId: string;
  orderedThreadIds: string[] | null;
}

export interface CodexSidebarProjectThreadOrderResult {
  snapshot: CodexSidebarSnapshot;
}

export interface CodexSidebarChatsThreadOrderInput {
  threadIdsInDisplayOrder: string[];
  visibleThreadIds: string[];
  nextVisibleThreadIds: string[];
}

export interface CodexSidebarChatsThreadOrderResult {
  orderedThreadIds: string[];
  snapshot: CodexSidebarSnapshot;
}

const ContainerIdSchema = z.string().trim().min(1).refine((value) => (
  value === "pinned"
  || value === "chats"
  || value === "cloud"
  || value.startsWith("project-pinned:") && value.length > "project-pinned:".length
  || value.startsWith("project:") && value.length > "project:".length
  || value.startsWith("reorder-only:") && value.length > "reorder-only:".length
), "Invalid sidebar thread container id") as z.ZodType<CodexSidebarThreadContainerId>;

const ProjectAccessGrantSchema = z.object({
  targetProjectId: z.string().trim().min(1),
  expectedBindingRevision: z.number().int().positive().safe(),
  missingProjectSources: z.array(z.string().trim().min(1)).min(1),
}).strict() satisfies z.ZodType<CodexSidebarThreadMoveProjectAccessGrant>;

const MoveBaseSchema = z.object({
  hostId: z.literal("local"),
  threadId: z.string().trim().min(1),
  sourceContainerId: ContainerIdSchema,
  targetContainerId: ContainerIdSchema,
  projectAccessGrant: ProjectAccessGrantSchema.optional(),
});

const MovePlacementSchema = z.union([
  z.object({
    beforeThreadId: z.string().trim().min(1),
    insertAtEnd: z.undefined().optional(),
    useDefaultOrder: z.undefined().optional(),
  }),
  z.object({
    beforeThreadId: z.null(),
    insertAtEnd: z.literal(true),
    useDefaultOrder: z.undefined().optional(),
  }),
  z.object({
    beforeThreadId: z.null(),
    insertAtEnd: z.undefined().optional(),
    useDefaultOrder: z.literal(true),
  }),
  z.object({
    beforeThreadId: z.null(),
    insertAtEnd: z.undefined().optional(),
    useDefaultOrder: z.undefined().optional(),
  }),
]);

export const CodexSidebarThreadMoveInputSchema = MoveBaseSchema.and(
  MovePlacementSchema,
) as z.ZodType<CodexSidebarThreadMoveInput>;

export const CodexSidebarProjectThreadOrderInputSchema = z.object({
  projectId: z.string().trim().min(1),
  orderedThreadIds: z.array(z.string().trim().min(1)).nullable(),
}) satisfies z.ZodType<CodexSidebarProjectThreadOrderInput>;

export const CodexSidebarChatsThreadOrderInputSchema = z.object({
  threadIdsInDisplayOrder: z.array(z.string().trim().min(1)),
  visibleThreadIds: z.array(z.string().trim().min(1)),
  nextVisibleThreadIds: z.array(z.string().trim().min(1)),
}) satisfies z.ZodType<CodexSidebarChatsThreadOrderInput>;

export function isCodexSidebarThreadContainerId(
  value: string,
): value is CodexSidebarThreadContainerId {
  return ContainerIdSchema.safeParse(value).success;
}

export function readCodexSidebarProjectContainerId(
  containerId: CodexSidebarThreadContainerId,
): string | null {
  const prefix = containerId.startsWith("project-pinned:")
    ? "project-pinned:"
    : containerId.startsWith("project:")
      ? "project:"
      : null;
  if (prefix === null) return null;
  const projectId = containerId.slice(prefix.length).trim();
  return projectId || null;
}

export function readCodexSidebarThreadContainerLocation(
  containerId: CodexSidebarThreadContainerId,
): CodexSidebarThreadContainerLocation | null {
  if (containerId === "pinned") return { projectId: null, pinned: true };
  if (containerId === "chats") return { projectId: null, pinned: false };

  const projectId = readCodexSidebarProjectContainerId(containerId);
  if (projectId === null) return null;
  return {
    projectId,
    pinned: containerId.startsWith("project-pinned:"),
  };
}

export function codexSidebarProjectThreadContainerId(
  projectId: string,
  pinned: boolean,
): CodexSidebarThreadContainerId {
  return pinned ? `project-pinned:${projectId}` : `project:${projectId}`;
}

export function isCodexSidebarPinnedThreadContainerId(
  containerId: string,
): boolean {
  return containerId === "pinned" || containerId.startsWith("project-pinned:");
}
