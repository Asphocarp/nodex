import type {
  GrantLibraryResourceToProjectOperation,
  LibraryResourceTarget as AnyLibraryResourceTarget,
  LibraryWriteParent,
  MoveLibraryBlockOperation,
  SetLibraryProjectAccessOperation,
} from "../../shared/library-module";

type LibraryMoveableResourceTarget = Exclude<
  AnyLibraryResourceTarget,
  { readonly kind: "canvas" }
>;

export const buildLibraryMoveOperation = (input: Readonly<{
  target: LibraryMoveableResourceTarget;
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
  target: LibraryMoveableResourceTarget;
  projectId: string;
  access: "read" | "read_write";
}>): GrantLibraryResourceToProjectOperation => ({
  kind: "grant_project_access",
  projectId: input.projectId,
  target: input.target,
  access: input.access,
});

export const buildLibraryProjectAccessOperation = (input: Readonly<{
  target: LibraryMoveableResourceTarget;
  changes: SetLibraryProjectAccessOperation["changes"];
}>): SetLibraryProjectAccessOperation => ({
  kind: "set_project_access",
  target: input.target,
  changes: input.changes,
});
