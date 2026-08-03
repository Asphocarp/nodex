import { MoreHorizontal } from "lucide-react";
import { useState, type ReactElement } from "react";

import {
  CodexArchiveIcon,
  CodexMoveToIcon,
  CodexOpenInIcon,
  CodexProjectAccessIcon,
  RefreshIcon,
} from "@/components/shared/icons";
import {
  NodexDialog,
  NodexDialogAction,
  NodexDialogBody,
  NodexDialogContent,
  NodexDialogDescription,
  NodexDialogFooter,
  NodexDialogFrame,
  NodexDialogHeader,
  NodexDialogTitle,
} from "@/components/ui/dialog";
import {
  NodexDropdownItem,
  NodexDropdownMenu,
} from "@/components/ui/dropdown";
import { toast } from "@/components/ui/toast";
import {
  buildLibraryMoveOperation,
  buildLibraryProjectGrantOperation,
} from "@/lib/library-operations";
import {
  useApplyLibraryOperation,
  useLibraryCatalog,
  useLibraryPath,
} from "@/lib/use-library-navigation";
import type {
  LibraryResourceTarget as AnyLibraryResourceTarget,
  LibraryWriteParent,
} from "../../../shared/library-module";

export type LibraryResourceTarget = Exclude<
  AnyLibraryResourceTarget,
  { readonly kind: "canvas" }
>;

export interface LibraryProjectOption {
  readonly id: string;
  readonly name: string;
}

type DialogKind = "move" | "grant" | "open_project" | "archive" | null;

const targetId = (target: LibraryResourceTarget): string =>
  target.kind === "page" ? target.pageId : target.databaseId;

export function LibraryResourceActions({
  target,
  title,
  expectedLocationRevision,
  expectedMetadataRevision,
  lifecycle = "active",
  projects = [],
  triggerButton,
  onOpenInProject,
}: {
  readonly target: LibraryResourceTarget;
  readonly title: string;
  readonly expectedLocationRevision: number;
  readonly expectedMetadataRevision?: number;
  readonly lifecycle?: "active" | "archived";
  readonly projects?: readonly LibraryProjectOption[];
  readonly triggerButton?: ReactElement;
  readonly onOpenInProject?: (
    projectId: string,
    target: LibraryResourceTarget,
    title: string,
  ) => void | Promise<void>;
}) {
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [destination, setDestination] = useState("library");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [access, setAccess] = useState<"read" | "read_write">("read_write");
  const { mutation } = useApplyLibraryOperation();
  const pages = useLibraryCatalog({
    kinds: ["page"],
    lifecycle: "active",
    limit: 100,
  }, dialog === "move");
  const destinationPageId = destination.startsWith("page:")
    ? destination.slice("page:".length)
    : "disabled-library-destination";
  const destinationPath = useLibraryPath(
    { kind: "page", pageId: destinationPageId },
    destination.startsWith("page:"),
  );
  const destinationNode = destinationPath.data?.nodes.at(-1);

  const applyMove = async () => {
    let parent: LibraryWriteParent = { kind: "library" };
    if (destination.startsWith("page:")) {
      if (!destinationNode || destinationNode.kind !== "page") {
        toast.danger("The destination Page changed. Choose it again.");
        return;
      }
      parent = {
        kind: "page",
        pageId: destinationNode.pageId,
        expectedDocumentGeneration: destinationNode.documentGeneration,
        expectedDocumentHeadSeq: destinationNode.documentHeadSeq,
      };
    }
    try {
      await mutation.mutateAsync(buildLibraryMoveOperation({
        target,
        expectedLocationRevision,
        parent,
      }));
      setDialog(null);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Could not move Library item");
    }
  };

  const applyGrant = async (openAfterGrant: boolean) => {
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) {
      toast.danger("Choose an active Project");
      return;
    }
    try {
      const receipt = await mutation.mutateAsync(buildLibraryProjectGrantOperation({
        projectId: project.id,
        target,
        access,
      }));
      if (!receipt.didMutate) toast.info(`${project.name} already has this access`);
      setDialog(null);
      if (openAfterGrant) await onOpenInProject?.(project.id, target, title);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Could not grant Project access");
    }
  };

  const applyLifecycle = async () => {
    if (expectedMetadataRevision === undefined) return;
    try {
      await mutation.mutateAsync({
        kind: lifecycle === "active" ? "archive_resource" : "restore_resource",
        target: target.kind === "page"
          ? {
              kind: "page",
              pageId: target.pageId,
              expectedMetadataRevision,
            }
          : {
              kind: "database",
              databaseId: target.databaseId,
              expectedMetadataRevision,
            },
      });
      setDialog(null);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Could not update Library item");
    }
  };

  const selectedDestinationIsSelf = destination === `page:${targetId(target)}`;
  const defaultTrigger = (
    <button
      type="button"
      aria-label={`Actions for ${title}`}
      className="flex size-7 items-center justify-center rounded-md text-token-description-foreground hover:bg-token-bg-secondary hover:text-token-text-primary focus-visible:outline focus-visible:outline-2"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <MoreHorizontal className="icon-xs" />
    </button>
  );

  return (
    <>
      <NodexDropdownMenu
        triggerButton={triggerButton ?? defaultTrigger}
        align="end"
      >
        <NodexDropdownItem
          leftSlot={<CodexMoveToIcon />}
          onSelect={() => setDialog("move")}
        >
          Move to…
        </NodexDropdownItem>
        <NodexDropdownItem
          leftSlot={<CodexProjectAccessIcon />}
          disabled={projects.length === 0}
          onSelect={() => setDialog("grant")}
        >
          Give Project access…
        </NodexDropdownItem>
        {onOpenInProject ? (
          <NodexDropdownItem
            leftSlot={<CodexOpenInIcon />}
            disabled={projects.length === 0}
            onSelect={() => setDialog("open_project")}
          >
            Open in Project…
          </NodexDropdownItem>
        ) : null}
        {expectedMetadataRevision !== undefined ? (
          <NodexDropdownItem
            leftSlot={lifecycle === "active"
              ? <CodexArchiveIcon />
              : <RefreshIcon />}
            onSelect={() => {
              if (lifecycle === "active") {
                setDialog("archive");
                return;
              }
              void applyLifecycle();
            }}
          >
            {lifecycle === "active" ? "Archive" : "Restore"}
          </NodexDropdownItem>
        ) : null}
      </NodexDropdownMenu>

      <NodexDialog open={dialog === "move"} onOpenChange={(open) => !open && setDialog(null)}>
        <NodexDialogContent size="compact">
          <NodexDialogFrame>
            <NodexDialogHeader>
              <NodexDialogTitle>Move {title}</NodexDialogTitle>
              <NodexDialogDescription>
                Choose its owning location. IDs, Documents, and Database bindings are preserved.
              </NodexDialogDescription>
            </NodexDialogHeader>
            <NodexDialogBody>
              <label className="grid gap-1.5 text-sm text-token-text-primary">
                Destination
                <select
                  value={destination}
                  className="h-9 rounded-lg bg-token-bg-secondary px-3 outline-none focus:ring-2 focus:ring-token-border"
                  onChange={(event) => setDestination(event.target.value)}
                >
                  <option value="library">Library root</option>
                  {(pages.data?.items ?? []).map((page) => page.target.kind === "page" ? (
                    <option key={page.target.pageId} value={`page:${page.target.pageId}`}>
                      {page.title || "Untitled"} — {page.locationLabel}
                    </option>
                  ) : null)}
                </select>
              </label>
            </NodexDialogBody>
            <NodexDialogFooter>
              <NodexDialogAction onClick={() => setDialog(null)}>
                Cancel
              </NodexDialogAction>
              <NodexDialogAction
                tone="primary"
                disabled={mutation.isPending || selectedDestinationIsSelf || destinationPath.isPending}
                onClick={() => void applyMove()}
              >
                Move
              </NodexDialogAction>
            </NodexDialogFooter>
          </NodexDialogFrame>
        </NodexDialogContent>
      </NodexDialog>

      <NodexDialog
        open={dialog === "grant" || dialog === "open_project"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <NodexDialogContent size="compact">
          <NodexDialogFrame>
            <NodexDialogHeader>
              <NodexDialogTitle>
                {dialog === "open_project" ? "Open in Project" : "Give Project access"}
              </NodexDialogTitle>
              <NodexDialogDescription>
                The grant applies recursively to {title}. Ownership and the Project&apos;s primary Database do not change.
              </NodexDialogDescription>
            </NodexDialogHeader>
            <NodexDialogBody className="gap-3">
              <label className="grid gap-1.5 text-sm text-token-text-primary">
                Project
                <select
                  value={projectId}
                  className="h-9 rounded-lg bg-token-bg-secondary px-3 outline-none focus:ring-2 focus:ring-token-border"
                  onChange={(event) => setProjectId(event.target.value)}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </label>
              <fieldset className="grid gap-1.5 text-sm text-token-text-primary">
                <legend className="mb-1">Access</legend>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="library-project-access"
                    checked={access === "read"}
                    onChange={() => setAccess("read")}
                  />
                  Read
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="library-project-access"
                    checked={access === "read_write"}
                    onChange={() => setAccess("read_write")}
                  />
                  Read &amp; write
                </label>
              </fieldset>
            </NodexDialogBody>
            <NodexDialogFooter>
              <NodexDialogAction onClick={() => setDialog(null)}>
                Cancel
              </NodexDialogAction>
              <NodexDialogAction
                tone="primary"
                disabled={!projectId || mutation.isPending}
                onClick={() => void applyGrant(dialog === "open_project")}
              >
                {dialog === "open_project" ? "Grant and open" : "Grant access"}
              </NodexDialogAction>
            </NodexDialogFooter>
          </NodexDialogFrame>
        </NodexDialogContent>
      </NodexDialog>

      <NodexDialog open={dialog === "archive"} onOpenChange={(open) => !open && setDialog(null)}>
        <NodexDialogContent size="compact">
          <NodexDialogFrame>
            <NodexDialogHeader>
              <NodexDialogTitle>Archive this {target.kind}?</NodexDialogTitle>
              <NodexDialogDescription>
                {title} will leave the active Library and remain available under Archived.
              </NodexDialogDescription>
            </NodexDialogHeader>
            <NodexDialogFooter>
              <NodexDialogAction onClick={() => setDialog(null)}>
                Cancel
              </NodexDialogAction>
              <NodexDialogAction
                tone="danger"
                disabled={mutation.isPending}
                onClick={() => void applyLifecycle()}
              >
                Archive
              </NodexDialogAction>
            </NodexDialogFooter>
          </NodexDialogFrame>
        </NodexDialogContent>
      </NodexDialog>
    </>
  );
}
