import type {
  GrantLibraryResourceToProjectOperation,
  LibraryResourceTarget,
  LibraryWriteParent,
  MoveLibraryBlockOperation,
} from "../../shared/library-module";

export const buildLibraryMoveOperation = (input: Readonly<{
  target: LibraryResourceTarget;
  expectedLocationRevision: number;
  parent: LibraryWriteParent;
}>): MoveLibraryBlockOperation => ({
  kind: "move_block",
  target: input.target.kind === "page"
    ? {
        kind: "page",
        pageId: input.target.pageId,
        expectedLocationRevision: input.expectedLocationRevision,
      }
    : {
        kind: "database",
        databaseId: input.target.databaseId,
        expectedLocationRevision: input.expectedLocationRevision,
      },
  parent: input.parent,
});

export const buildLibraryProjectGrantOperation = (input: Readonly<{
  target: LibraryResourceTarget;
  projectId: string;
  access: "read" | "read_write";
}>): GrantLibraryResourceToProjectOperation => ({
  kind: "grant_project_access",
  projectId: input.projectId,
  target: input.target,
  access: input.access,
});
