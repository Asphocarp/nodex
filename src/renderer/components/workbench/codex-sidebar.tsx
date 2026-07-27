import type {
  ComponentPropsWithoutRef,
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  ReactNode,
} from "react";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS, useCombinedRefs, type Transform } from "@dnd-kit/utilities";
import {
  BranchStatusIcon,
  CheckmarkIcon,
  CodexArchiveIcon,
  CodexCloseIcon,
  CodexPinOffIcon,
  CodexProjectFolderIcon,
  CodexProjectFolderOpenIcon,
  CodexProjectActionsIcon,
  CodexSessionPinFilledIcon,
  CodexSessionPinIcon,
  CodexSettingsGeneralIcon,
  CodexSpinnerIcon,
  ChevronDownIcon,
  WorktreeStatusIcon,
} from "@/components/shared/icons";
import {
  NodexDropdownItem,
  NodexDropdownMenu,
} from "@/components/ui/dropdown";
import { NodexTooltip } from "@/components/ui/tooltip";
import { invoke } from "@/lib/api";
import { CODEX_SIDEBAR_PROJECT_FOLDER_TRANSITION } from "@/lib/codex-panel-motion";
import { formatElapsedSince } from "@/lib/elapsed-time";
import { appScope, useScopeHandle } from "@/lib/maitai";
import { openModal } from "@/lib/modal-registry";
import type { CodexSidebarThreadItem, Project, ProjectLifecycleMutationResult, ProjectPinnedInput, ProjectSession, ProjectUpdateInput } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_NEW_CHAT_ROW_CLASS,
  SIDEBAR_PROJECT_NEW_CHAT_BUTTON_CLASS,
  SidebarProjectNewChatButton,
} from "./sidebar-new-chat-controls";
import {
  getSidebarGroupDndId,
  type SidebarGroupDndController,
  type SidebarGroupDndPayload,
  useSidebarProjectDndState,
} from "./sidebar-project-group-dnd";
import {
  useSidebarThreadProjectDropTargets,
} from "./sidebar-thread-reorder";
import { StableWorktreeCreateDialog } from "./stable-worktree-create-dialog";
import { suggestStableWorktreeProjectName } from "./stable-worktree-production";
import {
  ProjectArchiveChatsDialog,
  runProjectThreadBatches,
} from "./project-archive-chats-dialog";
import { ProjectEditDialog } from "./project-edit-dialog";
import { ProjectRemoveDialog } from "./project-remove-dialog";

type SidebarRowActionEvent =
  | MouseEvent<HTMLElement>
  | PointerEvent<HTMLElement>
  | KeyboardEvent<HTMLElement>;

export const CODEX_SIDEBAR_PROJECT_ROW_CLASS = "group/folder-row group relative flex h-token-nav-row cursor-interaction items-center justify-between overflow-x-hidden rounded-lg text-sm text-token-foreground hover:bg-token-list-hover-background focus-visible:outline focus-visible:outline-offset-2";
export const CODEX_SIDEBAR_DISCLOSURE_CHEVRON_CLASS = "icon-2xs shrink-0 opacity-0 transition-transform";
export const CODEX_SIDEBAR_SECTION_ACTIONS_CLASS = "flex items-center gap-1 pointer-events-none opacity-0 group-focus-within/projects-section-header:pointer-events-auto group-focus-within/projects-section-header:opacity-100 group-hover/projects-section-header:pointer-events-auto group-hover/projects-section-header:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100";
export const CODEX_SIDEBAR_SECTION_ACTION_BUTTON_CLASS = "border-token-border no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-full electron:rounded-md text-token-foreground enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border-transparent electron:p-1 electron:[&>svg]:icon-sm flex items-center justify-center p-0.5 h-6 w-6 rounded-md !p-1 text-token-foreground opacity-75 hover:opacity-100";
export const CODEX_SIDEBAR_PROJECT_ACTIONS_BUTTON_CLASS = SIDEBAR_PROJECT_NEW_CHAT_BUTTON_CLASS;
export const CODEX_SIDEBAR_THREAD_ROW_CLASS = "group relative h-token-nav-row cursor-interaction rounded-lg py-row-y text-sm hover:bg-token-list-hover-background focus-visible:outline-offset-[-2px]";
export const CODEX_SIDEBAR_THREAD_ACTION_RAIL_CLASS = "pointer-events-none absolute right-0 top-0 z-10 mr-0.5 flex h-full w-[52px] items-center justify-end gap-2 pr-0.5 opacity-0 group-hover:opacity-100 [&:has(:focus-visible)]:opacity-100";
export const CODEX_SIDEBAR_THREAD_ARCHIVE_BUTTON_CLASS = "!h-5 !w-5 !p-0 opacity-50 hover:opacity-100 focus-visible:opacity-100 [&>svg]:!h-4 [&>svg]:!w-4 pointer-events-auto";
const CODEX_SIDEBAR_THREAD_HOVER_CARD_DELAY_MS = 700;
const CODEX_SIDEBAR_THREAD_ELAPSED_REFRESH_MS = 30_000;
const CODEX_SIDEBAR_THREAD_PIN_BUTTON_CLASS = "pointer-events-auto flex h-5 w-5 items-center justify-center leading-none text-token-foreground/70 hover:text-token-foreground [&>svg]:!h-4 [&>svg]:!w-4";
const CODEX_SIDEBAR_THREAD_HOVER_CARD_FALLBACK_PROJECT_LABEL = "Chat";

const NOOP_SIDEBAR_GROUP_DND_CONTROLLER: SidebarGroupDndController = {
  handleDragEnd: () => undefined,
};

export function getCodexSidebarSortableStyle(
  transform: Transform | null,
  transition: string | undefined,
): CSSProperties {
  return {
    transform: CSS.Translate.toString(transform),
    transition,
  };
}

export function stopCodexSidebarRowActionPropagation(event: SidebarRowActionEvent) {
  event.stopPropagation();
}

function stopCodexSidebarRowActionKeyPropagation(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.stopPropagation();
}

// Portals still bubble through their React owner; rows only activate for DOM-owned events.
function isEventWithinCurrentTarget(event: SidebarRowActionEvent): boolean {
  return event.target instanceof Node && event.currentTarget.contains(event.target);
}

function clearCodexSidebarTextSelection(): void {
  document.getSelection()?.removeAllRanges();
}

function isMacPlatform() {
  return typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");
}

function normalizePrimaryWorkspaceRoot(project: Project) {
  return project.primaryWorkspaceRoot?.trim() || "";
}

function normalizeProjectSources(project: Project): string[] {
  return project.sources.map((source) => source.root).filter((root) => root.trim().length > 0);
}

function handleProjectRowKeyboard(
  event: KeyboardEvent<HTMLDivElement>,
  onActivate: () => void,
) {
  if (event.currentTarget !== event.target) return;
  if (event.key !== "Enter" && event.key !== " ") return;

  event.preventDefault();
  onActivate();
}

export function CodexSidebarTopAction({
  label,
  icon,
  shortcutLabel,
  active = false,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  shortcutLabel?: ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="shrink-0 px-row-x">
      <div className="flex flex-col gap-px">
        <CodexSidebarTopActionButton
          label={label}
          icon={icon}
          shortcutLabel={shortcutLabel}
          active={active}
          onClick={onClick}
        />
      </div>
    </div>
  );
}

export function CodexSidebarTopActionButton({
  label,
  icon,
  shortcutLabel,
  active = false,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  shortcutLabel?: ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(SIDEBAR_NEW_CHAT_ROW_CLASS, active && "bg-token-list-hover-background")}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 text-base text-token-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      {shortcutLabel ? (
        <span
          aria-hidden="true"
          className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          <kbd className="inline-flex !rounded-md !border-0 !bg-current/10 !font-sans !text-xs !text-current !shadow-none !px-1.5 !py-0.5 !leading-none">
            {shortcutLabel}
          </kbd>
        </span>
      ) : null}
    </button>
  );
}

export function CodexSidebarSection({
  heading,
  collapsed,
  onToggle,
  actions,
  children,
}: {
  heading: string;
  collapsed: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className="px-row-x"
      data-app-action-sidebar-section=""
      data-app-action-sidebar-section-collapsed={String(collapsed)}
      data-app-action-sidebar-section-heading={heading}
    >
      <div className="flex flex-col">
        <div className="flex items-center justify-between gap-2 pr-0.5 pl-2">
          <div className="min-w-0 flex-1 text-base text-token-input-placeholder-foreground opacity-75">
            <div className="group/projects-section-header flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1">
                <button
                  type="button"
                  data-app-action-sidebar-section-toggle=""
                  className="group/section-toggle flex min-w-0 flex-1 cursor-interaction items-center gap-1 rounded-md py-0.5 pr-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  aria-expanded={!collapsed}
                  onClick={onToggle}
                >
                  <span className="min-w-0 truncate">{heading}</span>
                  <ChevronDownIcon
                    className={cn(
                      CODEX_SIDEBAR_DISCLOSURE_CHEVRON_CLASS,
                      "group-hover/section-toggle:opacity-100 group-focus-visible/section-toggle:opacity-100",
                      collapsed && "-rotate-90",
                    )}
                  />
                </button>
              </div>
              {actions ? (
                <div className={CODEX_SIDEBAR_SECTION_ACTIONS_CLASS}>
                  {actions}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {!collapsed ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{
                height: "auto",
                opacity: 1,
                transitionEnd: {
                  overflow: "visible",
                },
              }}
              exit={{ height: 0, opacity: 0, overflow: "hidden" }}
              transition={CODEX_SIDEBAR_PROJECT_FOLDER_TRANSITION}
              className="overflow-hidden"
              data-app-action-sidebar-section-body-motion=""
            >
              <div className="flex flex-col gap-px pt-1">
                {children}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

function revealInFileManagerLabel(): string {
  if (isMacPlatform()) return "Reveal in Finder";
  const platform = typeof navigator === "undefined" ? "" : navigator.platform.toUpperCase();
  return platform.includes("WIN") ? "Open in Explorer" : "Open in File Manager";
}

export function CodexProjectActionsMenu({
  project,
  threadItems = [],
  onUpdateProject,
  onArchiveProject,
  onSetProjectPinned,
  onCreateStableWorktree,
  canCreateStableWorktree = false,
  stableWorktreeWorkspaceRootOptions = [],
  stableWorktreeWorkspaceRootLabels = {},
  onArchiveThreadItem,
  onMarkThreadItemRead,
  onThreadsChanged,
}: {
  project: Project;
  threadItems?: readonly CodexSidebarThreadItem[];
  onUpdateProject: (projectId: string, updates: ProjectUpdateInput) => Promise<Project | null>;
  onArchiveProject: (projectId: string) => Promise<ProjectLifecycleMutationResult>;
  onSetProjectPinned?: (projectId: string, input: ProjectPinnedInput) => Promise<Project | null>;
  onCreateStableWorktree?: (project: Project, projectName: string) => Promise<void>;
  canCreateStableWorktree?: boolean;
  stableWorktreeWorkspaceRootOptions?: readonly string[];
  stableWorktreeWorkspaceRootLabels?: Readonly<Record<string, string | undefined>>;
  onArchiveThreadItem?: (item: CodexSidebarThreadItem) => Promise<boolean>;
  onMarkThreadItemRead?: (item: CodexSidebarThreadItem) => Promise<void>;
  onThreadsChanged?: () => Promise<unknown> | void;
}) {
  const appHandle = useScopeHandle(appScope);
  const [open, setOpen] = useState(false);
  const [archiveChatsOpen, setArchiveChatsOpen] = useState(false);
  const [createStableWorktreeOpen, setCreateStableWorktreeOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const openEditAfterMenuCloseRef = useRef(false);
  const primaryWorkspaceRoot = normalizePrimaryWorkspaceRoot(project);
  const sourceRoots = normalizeProjectSources(project);
  const initialStableWorktreeProjectName = suggestStableWorktreeProjectName({
    base: project.name,
    workspaceRootOptions: stableWorktreeWorkspaceRootOptions,
    workspaceRootLabels: stableWorktreeWorkspaceRootLabels,
  });
  const archiveableItems = threadItems.filter((item) => (
    !item.archived && !item.disabled && item.kind !== "pending-worktree"
  ));
  const unreadItems = threadItems.filter((item) => item.unread && !item.archived);

  const openProjectFolder = async () => {
    if (!primaryWorkspaceRoot) return;
    await invoke("shell:open-file-link", { path: primaryWorkspaceRoot }, "fileManager");
  };

  const markAllThreadsRead = async () => {
    if (!onMarkThreadItemRead) return;
    await runProjectThreadBatches(unreadItems, async (item) => {
      try {
        await onMarkThreadItemRead(item);
      } catch {
        // Leave the item unread; the next refresh reflects the actual state.
      }
    });
    await onThreadsChanged?.();
  };

  return (
    <div
      className={open ? "opacity-100" : "opacity-0 group-hover/folder-row:opacity-100"}
      onPointerDown={stopCodexSidebarRowActionPropagation}
      onKeyDown={stopCodexSidebarRowActionKeyPropagation}
      onClick={stopCodexSidebarRowActionPropagation}
    >
      <NodexDropdownMenu
        open={open}
        onOpenChange={setOpen}
        onCloseAutoFocus={(event) => {
          if (!openEditAfterMenuCloseRef.current) return;
          openEditAfterMenuCloseRef.current = false;
          event.preventDefault();
          openModal(appHandle, ProjectEditDialog, {
            project,
            onSubmit: async ({ name, sources }) => {
              const updated = await onUpdateProject(project.id, {
                name: name.trim() || project.name,
                sources,
              });
              if (!updated) throw new Error(`Project ${project.id} not found`);
            },
            onArchiveProject,
          });
        }}
        side="bottom"
        align="start"
        contentWidth="xs"
        triggerButton={(
          <button
            type="button"
            className={CODEX_SIDEBAR_PROJECT_ACTIONS_BUTTON_CLASS}
            aria-label={`Project actions for ${project.name}`}
            data-app-action-sidebar-project-actions-menu=""
          >
            <CodexProjectActionsIcon />
          </button>
        )}
      >
          {onSetProjectPinned ? (
            <NodexDropdownItem
              leftSlot={project.pinned ? <CodexPinOffIcon className="icon-xs" /> : <CodexSessionPinIcon className="icon-xs" />}
              onSelect={() => {
                void onSetProjectPinned(project.id, { pinned: !project.pinned });
              }}
            >
              {project.pinned ? "Unpin project" : "Pin project"}
            </NodexDropdownItem>
          ) : null}
          {primaryWorkspaceRoot && sourceRoots.length === 1 ? (
            <NodexDropdownItem
              leftSlot={<CodexProjectFolderOpenIcon className="icon-xs" />}
              onSelect={() => {
                void openProjectFolder();
              }}
            >
              {revealInFileManagerLabel()}
            </NodexDropdownItem>
          ) : null}
          {primaryWorkspaceRoot && onCreateStableWorktree && canCreateStableWorktree ? (
            <NodexDropdownItem
              leftSlot={<WorktreeStatusIcon className="icon-xs" />}
              onSelect={() => {
                setOpen(false);
                setCreateStableWorktreeOpen(true);
              }}
            >
              Create permanent worktree
            </NodexDropdownItem>
          ) : null}
          <NodexDropdownItem
            leftSlot={<CodexSettingsGeneralIcon className="icon-xs" />}
            onSelect={() => {
              openEditAfterMenuCloseRef.current = true;
            }}
          >
            Edit project
          </NodexDropdownItem>
          {onMarkThreadItemRead && unreadItems.length > 0 ? (
            <NodexDropdownItem
              leftSlot={<CheckmarkIcon className="icon-xs" />}
              onSelect={() => {
                setOpen(false);
                void markAllThreadsRead();
              }}
            >
              Mark all as read
            </NodexDropdownItem>
          ) : null}
          <NodexDropdownItem
            leftSlot={<CodexArchiveIcon className="icon-xs" />}
            disabled={!onArchiveThreadItem || archiveableItems.length === 0}
            onSelect={() => {
              setOpen(false);
              setArchiveChatsOpen(true);
            }}
          >
            Archive chats
          </NodexDropdownItem>
          <NodexDropdownItem
            leftSlot={<CodexCloseIcon className="icon-xs" />}
            onSelect={() => {
              setOpen(false);
              setRemoveOpen(true);
            }}
          >
            Remove
          </NodexDropdownItem>
      </NodexDropdownMenu>
      {archiveChatsOpen && onArchiveThreadItem ? (
        <ProjectArchiveChatsDialog
          open={archiveChatsOpen}
          projectName={project.name}
          items={archiveableItems}
          onOpenChange={setArchiveChatsOpen}
          onArchiveItem={onArchiveThreadItem}
          onArchived={onThreadsChanged}
        />
      ) : null}
      {createStableWorktreeOpen ? (
        <StableWorktreeCreateDialog
          open
          initialProjectName={initialStableWorktreeProjectName}
          onOpenChange={setCreateStableWorktreeOpen}
          onCreate={async (projectName) => {
            if (!onCreateStableWorktree) return;
            await onCreateStableWorktree(project, projectName);
          }}
        />
      ) : null}
      {removeOpen ? (
        <ProjectRemoveDialog
          open
          project={project}
          onOpenChange={setRemoveOpen}
          onArchiveProject={onArchiveProject}
        />
      ) : null}
    </div>
  );
}

export function CodexProjectRow({
  project,
  active,
  expanded,
  animateChildren = true,
  groupDndController,
  allowProjectReorder = false,
  threadItems,
  onActivate,
  onSelectProject,
  onStartNewChat,
  onUpdateProject,
  onArchiveProject,
  onSetProjectPinned,
  onCreateStableWorktree,
  stableWorktreeWorkspaceRootOptions,
  stableWorktreeWorkspaceRootLabels,
  onArchiveThreadItem,
  onMarkThreadItemRead,
  onThreadsChanged,
  children,
}: {
  project: Project;
  active: boolean;
  expanded: boolean;
  animateChildren?: boolean;
  groupDndController?: SidebarGroupDndController;
  allowProjectReorder?: boolean;
  threadItems?: readonly CodexSidebarThreadItem[];
  onActivate: () => void;
  onSelectProject?: () => void;
  onStartNewChat?: () => void;
  onUpdateProject: (projectId: string, updates: ProjectUpdateInput) => Promise<Project | null>;
  onArchiveProject: (projectId: string) => Promise<ProjectLifecycleMutationResult>;
  onSetProjectPinned?: (projectId: string, input: ProjectPinnedInput) => Promise<Project | null>;
  onCreateStableWorktree?: (project: Project, projectName: string) => Promise<void>;
  stableWorktreeWorkspaceRootOptions?: readonly string[];
  stableWorktreeWorkspaceRootLabels?: Readonly<Record<string, string | undefined>>;
  onArchiveThreadItem?: (item: CodexSidebarThreadItem) => Promise<boolean>;
  onMarkThreadItemRead?: (item: CodexSidebarThreadItem) => Promise<void>;
  onThreadsChanged?: () => Promise<unknown> | void;
  children?: ReactNode;
}) {
  const sortableEnabled = allowProjectReorder && Boolean(groupDndController);
  const primaryWorkspaceRoot = normalizePrimaryWorkspaceRoot(project);
  const [canCreateStableWorktree, setCanCreateStableWorktree] = useState(false);
  const {
    gutter: gutterThreadDropTarget,
    icon: iconThreadDropTarget,
    row: rowThreadDropTarget,
    whole: wholeThreadDropTarget,
  } = useSidebarThreadProjectDropTargets({
    projectId: project.id,
    targetProjectKind: "local",
  });
  const sortableId = getSidebarGroupDndId(project.id);
  const { activeProjectId, projectDragActive } = useSidebarProjectDndState();
  const dragOverlay = useMemo(() => (
    <div className="flex h-[var(--height-token-row)] max-w-80 items-center gap-2 px-2 text-base text-token-foreground">
      <span className="flex size-5 shrink-0 items-center justify-center">
        <CodexProjectFolderIcon className="icon-xs shrink-0" />
      </span>
      <span className="min-w-0 truncate">{project.name}</span>
    </div>
  ), [project.name]);
  const sortableData = useMemo<SidebarGroupDndPayload>(() => ({
    kind: "sidebar-group",
    controller: groupDndController ?? NOOP_SIDEBAR_GROUP_DND_CONTROLLER,
    dragOverlay,
    projectId: project.id,
  }), [dragOverlay, groupDndController, project.id]);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: sortableId,
    disabled: !sortableEnabled,
    data: sortableData,
  });
  const projectRowRef = useCombinedRefs(
    setNodeRef,
    wholeThreadDropTarget.setNodeRef,
  );
  const activeProjectDrag = isDragging || activeProjectId === project.id;
  const sortableStyle = sortableEnabled && !projectDragActive && transform
    ? getCodexSidebarSortableStyle(transform, transition)
    : undefined;
  const projectChildren = children ? (
    <CodexProjectChildrenDisclosure
      animate={animateChildren}
      expanded={expanded}
      motionKey={`${project.id}-tasks`}
    >
      {children}
    </CodexProjectChildrenDisclosure>
  ) : null;

  useEffect(() => {
    if (!onCreateStableWorktree || !primaryWorkspaceRoot) {
      setCanCreateStableWorktree(false);
      return;
    }

    let disposed = false;
    setCanCreateStableWorktree(false);
    void invoke("git:branch:state", primaryWorkspaceRoot)
      .then((state) => {
        if (disposed) return;
        setCanCreateStableWorktree(Boolean(
          state.currentBranch
          || state.defaultBranch
          || state.branches.length > 0,
        ));
      })
      .catch(() => {
        if (!disposed) setCanCreateStableWorktree(false);
      });

    return () => {
      disposed = true;
    };
  }, [onCreateStableWorktree, primaryWorkspaceRoot]);

  return (
    <div
      ref={projectRowRef}
      className={cn(
        "group/cwd relative flex flex-col",
        activeProjectDrag && "opacity-20",
        wholeThreadDropTarget.isExternalThreadDropTarget
          && wholeThreadDropTarget.isOver
          && "rounded-lg bg-token-list-hover-background",
      )}
      style={sortableStyle}
      inert={activeProjectDrag ? true : undefined}
      onPointerDownCapture={sortableEnabled ? (event) => {
        if (!isEventWithinCurrentTarget(event)) return;
        clearCodexSidebarTextSelection();
      } : undefined}
      role="listitem"
      aria-label={project.name}
    >
      <div
        ref={rowThreadDropTarget.setNodeRef}
        {...(sortableEnabled ? attributes : {})}
        data-app-action-sidebar-project-collapsed={String(!expanded)}
        data-app-action-sidebar-project-id={project.id}
        data-app-action-sidebar-project-label={project.name}
        data-app-action-sidebar-project-row=""
        data-active={active ? "true" : undefined}
        className={cn(
          CODEX_SIDEBAR_PROJECT_ROW_CLASS,
          active && "bg-token-list-hover-background",
          rowThreadDropTarget.isExternalThreadDropTarget
            && rowThreadDropTarget.isOver
            && "bg-token-list-hover-background",
          projectDragActive && "pointer-events-none",
        )}
        role="button"
        tabIndex={0}
        aria-label={project.name}
        aria-expanded={expanded}
        onClick={(event) => {
          if (event.defaultPrevented) return;
          if (!isEventWithinCurrentTarget(event)) return;
          onActivate();
        }}
        onKeyDown={(event) => handleProjectRowKeyboard(event, onActivate)}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 pl-1">
          <span
            ref={iconThreadDropTarget.setNodeRef}
            className={cn(
              "relative flex h-6 w-6 items-center justify-center",
              iconThreadDropTarget.isExternalThreadDropTarget
                && iconThreadDropTarget.isOver
                && "rounded-md bg-token-list-hover-background",
            )}
          >
            {expanded ? (
              <CodexProjectFolderOpenIcon className="icon-xs shrink-0" />
            ) : (
              <CodexProjectFolderIcon className="icon-xs shrink-0" />
            )}
          </span>
          <div
            ref={setActivatorNodeRef}
            className="flex min-w-0 flex-1 cursor-interaction items-center gap-2 whitespace-nowrap rounded-md py-1 pr-0 text-left text-base text-token-foreground"
            {...(sortableEnabled ? listeners : {})}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap">
              <span className="flex min-w-0 flex-1 items-center gap-0.5">
                <span className="min-w-0 truncate pr-1" data-app-action-sidebar-project-label-text="">
                  {project.name}
                </span>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-label={expanded ? "Collapse project" : "Expand project"}
                  className="-ml-1 flex h-5 w-5 shrink-0 cursor-interaction items-center justify-center rounded-sm text-token-foreground opacity-0 group-hover/folder-row:opacity-100 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  data-app-action-sidebar-project-toggle-chevron=""
                  onPointerDown={stopCodexSidebarRowActionPropagation}
                  onMouseDown={stopCodexSidebarRowActionPropagation}
                  onKeyDown={stopCodexSidebarRowActionPropagation}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onActivate();
                  }}
                >
                  <ChevronDownIcon
                    className={cn(
                      "icon-2xs shrink-0 transition-transform",
                      !expanded && "-rotate-90",
                    )}
                  />
                </button>
              </span>
            </span>
          </div>
        </div>
        <div className="flex gap-1">
          <CodexProjectActionsMenu
            project={project}
            threadItems={threadItems}
            onUpdateProject={onUpdateProject}
            onArchiveProject={onArchiveProject}
            onSetProjectPinned={onSetProjectPinned}
            onCreateStableWorktree={onCreateStableWorktree}
            canCreateStableWorktree={canCreateStableWorktree}
            stableWorktreeWorkspaceRootOptions={stableWorktreeWorkspaceRootOptions}
            stableWorktreeWorkspaceRootLabels={stableWorktreeWorkspaceRootLabels}
            onArchiveThreadItem={onArchiveThreadItem}
            onMarkThreadItemRead={onMarkThreadItemRead}
            onThreadsChanged={onThreadsChanged}
          />
          {onStartNewChat ? (
            <SidebarProjectNewChatButton
              label={`Start new chat in ${project.name}`}
              onClick={onStartNewChat}
            />
          ) : null}
        </div>
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          className="sr-only"
          data-app-action-sidebar-select-project=""
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSelectProject?.();
          }}
        />
      </div>
      <div
        ref={gutterThreadDropTarget.setNodeRef}
        aria-hidden
        className={cn(
          "absolute bottom-0 left-0 top-[var(--height-token-nav-row)] z-10 w-2",
          gutterThreadDropTarget.isExternalThreadDropTarget
            && gutterThreadDropTarget.isOver
            && "bg-token-list-hover-background",
        )}
      />
      {projectChildren}
    </div>
  );
}

function CodexProjectChildrenDisclosure({
  animate,
  expanded,
  motionKey,
  children,
}: {
  animate: boolean;
  expanded: boolean;
  motionKey: string;
  children: ReactNode;
}) {
  if (!animate) {
    if (!expanded) return null;

    return (
      <div className="mt-0.5" data-app-action-sidebar-project-list-static="">
        {children}
      </div>
    );
  }

  return (
    <AnimatePresence initial={false}>
      {expanded ? (
        <motion.div
          key={motionKey}
          initial={{ height: 0, opacity: 0 }}
          animate={{
            height: "auto",
            opacity: 1,
            transitionEnd: {
              overflow: "visible",
            },
          }}
          exit={{ height: 0, opacity: 0, overflow: "hidden" }}
          transition={CODEX_SIDEBAR_PROJECT_FOLDER_TRANSITION}
          className="overflow-hidden"
          data-app-action-sidebar-project-list-motion=""
        >
          <div className="pt-0.5">
            {children}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function CodexProjectSessionList({
  project,
  showAll = false,
  children,
}: {
  project: Project;
  showAll?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-app-action-sidebar-project-list-id={project.id}
      data-app-action-sidebar-project-show-all={String(showAll)}
    >
      <div className="isolate flex flex-col [contain:layout]">
        <div className="flex flex-col" role="list" aria-label={`Automations in ${project.name}`}>
          {children}
        </div>
      </div>
    </div>
  );
}

function normalizeSidebarHoverCardText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function basenameFromWorkspacePath(path: string | null) {
  const normalized = normalizeSidebarHoverCardText(path);
  if (!normalized) return null;

  const segments = normalized.split(/[\\/]+/).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? normalized;
}

function resolveSidebarThreadHoverCardProjectLabel(
  item: CodexSidebarThreadItem,
  projectLabel?: string | null,
) {
  const explicitLabel = normalizeSidebarHoverCardText(projectLabel);
  if (explicitLabel) return explicitLabel;
  if (item.projectless) return CODEX_SIDEBAR_THREAD_HOVER_CARD_FALLBACK_PROJECT_LABEL;
  return basenameFromWorkspacePath(item.cwd) ?? CODEX_SIDEBAR_THREAD_HOVER_CARD_FALLBACK_PROJECT_LABEL;
}

function resolveSidebarThreadHoverCardTimeLabel(item: CodexSidebarThreadItem) {
  if (!Number.isFinite(item.updatedAt) || item.updatedAt <= 0) return null;
  return formatElapsedSince(item.updatedAt, Date.now());
}

function CodexSidebarThreadHoverCardMetadataRow({
  icon,
  label,
}: {
  icon: ReactNode;
  label: string | null;
}) {
  if (!label) return null;

  return (
    <div className="flex h-5 min-w-0 items-center gap-1.5 text-sm leading-5">
      <span className="flex h-5 w-4 shrink-0 items-center justify-center text-token-description-foreground">
        {icon}
      </span>
      <span className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap leading-5 text-token-foreground">
        {label}
      </span>
    </div>
  );
}

function CodexSidebarThreadHoverCard({
  item,
  projectLabel,
  branchName,
  onRenameFromTitleClick,
}: {
  item: CodexSidebarThreadItem;
  projectLabel?: string | null;
  branchName?: string | null;
  onRenameFromTitleClick?: (item: CodexSidebarThreadItem, event: MouseEvent<HTMLElement>) => void;
}) {
  const resolvedProjectLabel = resolveSidebarThreadHoverCardProjectLabel(item, projectLabel);
  const resolvedBranchName = normalizeSidebarHoverCardText(branchName);
  const timeLabel = resolveSidebarThreadHoverCardTimeLabel(item);

  return (
    <div
      className="flex w-fit max-w-[min(20rem,calc(100vw-16px))] min-w-56 flex-col gap-1 px-row-x py-1.5 text-token-foreground"
      data-app-action-sidebar-thread-hover-card=""
    >
      <div className="flex w-full min-w-0 items-center gap-3 pb-0.5">
        {onRenameFromTitleClick ? (
          <button
            type="button"
            className="w-0 min-w-0 flex-1 cursor-interaction truncate rounded-md text-left text-base leading-6 font-medium text-token-foreground hover:bg-token-list-hover-background focus-visible:bg-token-list-hover-background focus-visible:outline-none"
            aria-label="Chat title"
            onPointerDown={stopCodexSidebarRowActionPropagation}
            onMouseDown={stopCodexSidebarRowActionPropagation}
            onKeyDown={stopCodexSidebarRowActionPropagation}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRenameFromTitleClick(item, event);
            }}
          >
            {item.title}
          </button>
        ) : (
          <div className="w-0 min-w-0 flex-1 truncate text-base leading-6 font-medium text-token-foreground">
            {item.title}
          </div>
        )}
        {timeLabel ? (
          <div className="flex shrink-0 items-center gap-1 text-xs leading-5 text-token-description-foreground">
            {timeLabel}
          </div>
        ) : null}
      </div>
      <CodexSidebarThreadHoverCardMetadataRow
        icon={<CodexProjectFolderIcon className="icon-xs" />}
        label={resolvedProjectLabel}
      />
      {resolvedBranchName ? (
        <div className="flex min-w-0 flex-col gap-1">
          <CodexSidebarThreadHoverCardMetadataRow
            icon={<BranchStatusIcon className="icon-xs" />}
            label={resolvedBranchName}
          />
        </div>
      ) : null}
    </div>
  );
}

export function CodexSidebarThreadRow({
  item,
  active,
  contextMenuOpen = false,
  archivePending = false,
  hoverCardProjectLabel,
  hoverCardBranchName,
  hoverCardOpen,
  onHoverCardOpenChange,
  onSelect,
  onPreview,
  onArchive,
  onOpenContextMenu,
  onRenameFromTitleDoubleClick,
  onTogglePinned,
}: {
  item: CodexSidebarThreadItem;
  active: boolean;
  contextMenuOpen?: boolean;
  archivePending?: boolean;
  hoverCardProjectLabel?: string | null;
  hoverCardBranchName?: string | null;
  hoverCardOpen?: boolean;
  onHoverCardOpenChange?: (open: boolean) => void;
  onSelect: () => void;
  onPreview?: () => void;
  onArchive?: (item: CodexSidebarThreadItem) => void | Promise<void>;
  onOpenContextMenu?: (item: CodexSidebarThreadItem, event: MouseEvent<HTMLElement>) => void;
  onRenameFromTitleDoubleClick?: (item: CodexSidebarThreadItem, event: MouseEvent<HTMLElement>) => void;
  onTogglePinned?: (item: CodexSidebarThreadItem) => void | Promise<void>;
}) {
  const canOpenContextMenu = !item.disabled && Boolean(onOpenContextMenu);
  const showArchiveAction = !item.disabled && Boolean(onArchive);
  const showPinSlot = !item.disabled && Boolean(onTogglePinned);
  const pinButtonLabel = item.pinned ? "Unpin chat" : "Pin chat";
  const title = item.title;
  const archiveDisabled = item.disabled || archivePending;
  const hasElapsedMeta = Number.isFinite(item.updatedAt) && item.updatedAt > 0;
  const running = item.statusType === "active";
  const showRestingPinnedButton = showPinSlot && item.pinned;
  const showRailPinSlot = showPinSlot && !showRestingPinnedButton;
  const showActionRail = showRailPinSlot || showArchiveAction;
  const [internalHoverCardOpen, setInternalHoverCardOpen] = useState(false);
  const [lazyBranchName, setLazyBranchName] = useState<string | null>(null);
  const [elapsedNowMs, setElapsedNowMs] = useState(() => Date.now());
  const resolvedHoverCardOpen = hoverCardOpen ?? internalHoverCardOpen;
  const normalizedHoverCardCwd = item.cwd?.trim() ?? "";
  const resolvedHoverCardBranchName = hoverCardBranchName ?? lazyBranchName;

  useEffect(() => {
    if (hoverCardBranchName !== undefined) {
      setLazyBranchName(null);
      return;
    }

    setLazyBranchName(null);
    if (!resolvedHoverCardOpen || !normalizedHoverCardCwd) return;

    let cancelled = false;
    void invoke("git:branch:state", normalizedHoverCardCwd)
      .then((state) => {
        if (cancelled) return;
        const branch = typeof (state as { currentBranch?: unknown }).currentBranch === "string"
          ? (state as { currentBranch: string }).currentBranch
          : null;
        setLazyBranchName(normalizeSidebarHoverCardText(branch));
      })
      .catch(() => {
        if (!cancelled) setLazyBranchName(null);
      });

    return () => {
      cancelled = true;
    };
  }, [hoverCardBranchName, normalizedHoverCardCwd, resolvedHoverCardOpen]);

  useEffect(() => {
    if (!hasElapsedMeta) return;

    const intervalId = window.setInterval(() => {
      setElapsedNowMs(Date.now());
    }, CODEX_SIDEBAR_THREAD_ELAPSED_REFRESH_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasElapsedMeta, item.updatedAt]);

  const handleHoverCardOpenChange = (nextOpen: boolean) => {
    if (hoverCardOpen === undefined) setInternalHoverCardOpen(nextOpen);
    onHoverCardOpenChange?.(nextOpen);
  };
  const elapsedLabel = hasElapsedMeta ? formatElapsedSince(item.updatedAt, elapsedNowMs) : null;
  const elapsedTitle = hasElapsedMeta ? `Updated ${new Date(item.updatedAt).toLocaleString()}` : undefined;
  const handleTogglePinnedClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void onTogglePinned?.(item);
  };

  const row = (
    <div
        data-app-action-sidebar-thread-active={String(active)}
        data-app-action-sidebar-thread-host-id={item.hostId}
        data-app-action-sidebar-thread-id={item.threadId}
        data-app-action-sidebar-thread-kind={item.kind}
        data-app-action-sidebar-thread-pinned={String(item.pinned)}
        data-app-action-sidebar-thread-running={String(running)}
        data-app-action-sidebar-thread-unread={String(item.unread)}
        data-app-action-sidebar-thread-row=""
        data-app-action-sidebar-thread-title={title}
        className={cn(
          CODEX_SIDEBAR_THREAD_ROW_CLASS,
          active && "bg-token-list-hover-background",
          contextMenuOpen && "bg-token-list-hover-background",
        )}
        role="button"
        tabIndex={0}
        aria-current={active ? "page" : undefined}
        aria-disabled={item.disabled || undefined}
        onPointerEnter={() => {
          if (!item.disabled) onPreview?.();
        }}
        onFocus={() => {
          if (!item.disabled) onPreview?.();
        }}
        onClick={onSelect}
        onContextMenu={(event) => {
          if (!canOpenContextMenu) return;
          event.preventDefault();
          onOpenContextMenu?.(item, event);
        }}
        onDoubleClick={(event) => {
          onRenameFromTitleDoubleClick?.(item, event);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onSelect();
        }}
      >
        <div className="contents">
          <div className="flex h-full w-full items-center px-row-x text-sm leading-4">
            <div className="w-4 shrink-0">
              <div className="relative flex items-center justify-center">
                {item.unread || item.needsAttention ? (
                  <span
                    className="size-1.5 rounded-full bg-token-charts-blue"
                    aria-label={item.needsAttention ? "Needs attention" : "Unread"}
                  />
                ) : null}
              </div>
            </div>
            <div
              className="ml-1.5 flex min-w-0 flex-1 items-center pl-0.5"
              data-app-action-sidebar-thread-main=""
            >
              <div
                className="flex min-w-0 flex-1 self-stretch items-center gap-2 text-base leading-5 text-token-foreground"
                data-thread-title-trigger="true"
              >
                <span
                  className="min-w-0 flex-1 truncate select-none"
                  data-thread-title="true"
                  draggable={false}
                >
                  {title}
                </span>
              </div>
              {running || elapsedLabel || showRestingPinnedButton ? (
                <div
                  className={cn(
                    "ml-[3px] flex items-center justify-end gap-1 group-focus-visible:min-w-12 group-focus-visible:justify-start group-has-[:focus-visible]:min-w-12 group-has-[:focus-visible]:justify-start group-hover:min-w-12 group-hover:justify-start",
                    running ? "min-w-4" : "min-w-[26px]",
                    contextMenuOpen && "min-w-12 justify-start",
                  )}
                  data-app-action-sidebar-thread-elapsed-slot=""
                >
                  {elapsedLabel && !running ? (
                    <span
                      className={cn(
                        "truncate text-right text-sm leading-4 tabular-nums text-token-description-foreground group-has-[:focus-visible]:hidden group-hover:hidden empty:hidden",
                        contextMenuOpen && "hidden",
                      )}
                      title={elapsedTitle}
                      data-app-action-sidebar-thread-elapsed=""
                    >
                      {elapsedLabel}
                    </span>
                  ) : null}
                  {showRestingPinnedButton ? (
                    <button
                      type="button"
                      aria-label={pinButtonLabel}
                      className={CODEX_SIDEBAR_THREAD_PIN_BUTTON_CLASS}
                      data-state={contextMenuOpen ? "open" : "closed"}
                      data-app-action-sidebar-thread-resting-pin=""
                      data-app-action-sidebar-thread-pin-session=""
                      data-app-action-sidebar-thread-pin-slot=""
                      onPointerDown={stopCodexSidebarRowActionPropagation}
                      onMouseDown={stopCodexSidebarRowActionPropagation}
                      onKeyDown={stopCodexSidebarRowActionPropagation}
                      onClick={handleTogglePinnedClick}
                    >
                      <CodexSessionPinFilledIcon />
                    </button>
                  ) : null}
                  {running ? (
                    <span
                      className={cn(
                        "relative -mr-1 flex size-5 shrink-0 items-center justify-center text-token-foreground/70",
                        showActionRail && "group-has-[:focus-visible]:hidden group-hover:hidden",
                        contextMenuOpen && "hidden",
                      )}
                      data-app-action-sidebar-thread-running-indicator=""
                    >
                      <CodexSpinnerIcon className="icon-xs shrink-0" animationDurationMs={2_000} />
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          {showActionRail ? (
            <div
              className={cn(
                CODEX_SIDEBAR_THREAD_ACTION_RAIL_CLASS,
                contextMenuOpen && "opacity-100",
              )}
              data-state={contextMenuOpen ? "open" : "closed"}
              data-app-action-sidebar-thread-action-rail=""
            >
              {showRailPinSlot ? (
                <div
                  className="flex h-5 w-5 shrink-0 items-center justify-center"
                  data-app-action-sidebar-thread-pin-slot=""
                >
                  {item.unread ? (
                    <span aria-hidden="true" className="block h-5 w-5" />
                  ) : (
                    <button
                      type="button"
                      aria-label={pinButtonLabel}
                      className={cn(
                        CODEX_SIDEBAR_THREAD_PIN_BUTTON_CLASS,
                        !item.pinned && "opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 data-[state=open]:opacity-100",
                      )}
                      data-state={contextMenuOpen ? "open" : "closed"}
                      data-app-action-sidebar-thread-pin-session=""
                      onPointerDown={stopCodexSidebarRowActionPropagation}
                      onMouseDown={stopCodexSidebarRowActionPropagation}
                      onKeyDown={stopCodexSidebarRowActionPropagation}
                      onClick={handleTogglePinnedClick}
                    >
                      {item.pinned ? <CodexSessionPinFilledIcon /> : <CodexSessionPinIcon />}
                    </button>
                  )}
                </div>
              ) : null}
              {showArchiveAction ? (
                <button
                  type="button"
                  aria-label="Archive chat"
                  disabled={archiveDisabled}
                  className={cn(
                    CODEX_SIDEBAR_PROJECT_ACTIONS_BUTTON_CLASS,
                    CODEX_SIDEBAR_THREAD_ARCHIVE_BUTTON_CLASS,
                  )}
                  data-app-action-sidebar-thread-archive=""
                  onPointerDown={stopCodexSidebarRowActionPropagation}
                  onMouseDown={stopCodexSidebarRowActionPropagation}
                  onKeyDown={stopCodexSidebarRowActionPropagation}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void onArchive?.(item);
                  }}
                >
                  <CodexArchiveIcon />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
    </div>
  );

  return (
    <div className="after:block after:h-px after:content-[''] last:after:hidden" role="listitem">
      <NodexTooltip
        tooltipContent={(
          <CodexSidebarThreadHoverCard
            item={item}
            projectLabel={hoverCardProjectLabel}
            branchName={resolvedHoverCardBranchName}
            onRenameFromTitleClick={onRenameFromTitleDoubleClick}
          />
        )}
        surface="rich"
        side="right"
        align="start"
        sideOffset={2}
        delayDuration={CODEX_SIDEBAR_THREAD_HOVER_CARD_DELAY_MS}
        interactive
        disabled={item.disabled}
        open={hoverCardOpen}
        onOpenChange={handleHoverCardOpenChange}
      >
        {row}
      </NodexTooltip>
    </div>
  );
}

export function CodexThreadRow({
  session,
  active,
  contextMenuOpen = false,
  hoverCardProjectLabel,
  hoverCardBranchName,
  hoverCardOpen,
  onHoverCardOpenChange,
  onSelect,
  onOpenContextMenu,
  onRenameFromTitleDoubleClick,
  onTogglePinned,
}: {
  session: ProjectSession;
  active: boolean;
  contextMenuOpen?: boolean;
  hoverCardProjectLabel?: string | null;
  hoverCardBranchName?: string | null;
  hoverCardOpen?: boolean;
  onHoverCardOpenChange?: (open: boolean) => void;
  onSelect: () => void;
  onOpenContextMenu?: (session: ProjectSession, event: MouseEvent<HTMLElement>) => void;
  onRenameFromTitleDoubleClick?: (session: ProjectSession, event: MouseEvent<HTMLElement>) => void;
  onTogglePinned?: (session: ProjectSession) => void | Promise<void>;
}) {
  const threadId = session.thread?.threadId ?? session.id;
  const item: CodexSidebarThreadItem = {
    key: `local:${threadId}`,
    kind: "local",
    hostId: "local",
    threadId,
    sessionId: session.id,
    projectId: session.projectId,
    title: session.displayTitle,
    preview: session.thread?.threadPreview ?? "",
    cwd: session.thread?.cwd ?? null,
    updatedAt: session.thread?.updatedAt ?? Date.parse(session.updatedAt),
    createdAt: session.thread?.createdAt ?? Date.parse(session.createdAt),
    pinned: session.pinned,
    pinnedOrder: session.pinnedOrder,
    unread: session.unread,
    archived: session.archived || session.thread?.archived === true,
    statusType: (session.thread?.statusType ?? "notLoaded") as CodexSidebarThreadItem["statusType"],
    statusActiveFlags: (session.thread?.statusActiveFlags ?? []) as CodexSidebarThreadItem["statusActiveFlags"],
    projectless: session.projectId === null,
    disabled: false,
  };

  return (
    <CodexSidebarThreadRow
      item={item}
      active={active}
      contextMenuOpen={contextMenuOpen}
      hoverCardProjectLabel={hoverCardProjectLabel}
      hoverCardBranchName={hoverCardBranchName}
      hoverCardOpen={hoverCardOpen}
      onHoverCardOpenChange={onHoverCardOpenChange}
      onSelect={onSelect}
      onOpenContextMenu={onOpenContextMenu
        ? (_item, event) => onOpenContextMenu(session, event)
        : undefined}
      onRenameFromTitleDoubleClick={onRenameFromTitleDoubleClick
        ? (_item, event) => onRenameFromTitleDoubleClick(session, event)
        : undefined}
      onTogglePinned={onTogglePinned ? () => onTogglePinned(session) : undefined}
    />
  );
}

type CodexSidebarActionButtonProps = Omit<ComponentPropsWithoutRef<"button">, "children"> & {
  label: string;
  children: ReactNode;
};

export const CodexSidebarActionButton = forwardRef<HTMLButtonElement, CodexSidebarActionButtonProps>(
function CodexSidebarActionButton({
  label,
  title,
  children,
  onClick,
  onPointerDown,
  onMouseDown,
  onKeyDown,
  className,
  ...buttonProps
}, ref) {
  return (
    <NodexTooltip delayOpen tooltipContent={title ?? label} side="right">
      <button
        {...buttonProps}
        ref={ref}
        type="button"
        className={cn(CODEX_SIDEBAR_SECTION_ACTION_BUTTON_CLASS, className)}
        title={title}
        aria-label={label}
        onPointerDown={(event) => {
          stopCodexSidebarRowActionPropagation(event);
          onPointerDown?.(event);
        }}
        onMouseDown={(event) => {
          stopCodexSidebarRowActionPropagation(event);
          onMouseDown?.(event);
        }}
        onKeyDown={(event) => {
          stopCodexSidebarRowActionPropagation(event);
          onKeyDown?.(event);
        }}
        onClick={(event) => {
          event.stopPropagation();
          onClick?.(event);
        }}
      >
        {children}
      </button>
    </NodexTooltip>
  );
});

export function resolveCodexNewChatShortcutLabel() {
  return isMacPlatform() ? "⌘N" : "Ctrl+N";
}

export function resolveCodexCommandPaletteShortcutLabel() {
  return isMacPlatform() ? "⌘K" : "Ctrl+K";
}

export function resolveCodexPageSearchShortcutLabel() {
  return isMacPlatform() ? "⌘P" : "Ctrl+P";
}
