import type {
  ComponentPropsWithoutRef,
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  ReactNode,
} from "react";
import { forwardRef, useEffect, useMemo, useState } from "react";
import { FolderOpen, FolderPlus, Pencil, Smile, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS, type Transform } from "@dnd-kit/utilities";
import {
  CodexFolderIcon,
  CodexProjectActionsIcon,
  CodexProjectHoverIcon,
  CodexSessionPinFilledIcon,
  CodexSessionPinIcon,
  ChevronDownIcon,
} from "@/components/shared/icons";
import {
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownSeparator,
} from "@/components/ui/dropdown";
import { NodexButton } from "@/components/ui/button";
import {
  NodexDialog,
  NodexDialogContent,
  NodexDialogFooter,
  NodexDialogHeader,
  NodexDialogTitle,
} from "@/components/ui/dialog";
import { NodexTooltip } from "@/components/ui/tooltip";
import { invoke } from "@/lib/api";
import { CODEX_SIDEBAR_PROJECT_FOLDER_TRANSITION } from "@/lib/codex-panel-motion";
import type { Project, ProjectPinnedInput, ProjectSession, ProjectUpdateInput } from "@/lib/types";
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
} from "./sidebar-project-group-dnd";

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
  onClick,
}: {
  label: string;
  icon: ReactNode;
  shortcutLabel?: ReactNode;
  onClick: () => void;
}) {
  return (
    <div className="shrink-0 px-row-x">
      <div className="flex flex-col gap-px">
        <button
          type="button"
          className={SIDEBAR_NEW_CHAT_ROW_CLASS}
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
      </div>
    </div>
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

export function CodexProjectActionsMenu({
  project,
  onUpdateProject,
  onDeleteProject,
  onSetProjectPinned,
}: {
  project: Project;
  onUpdateProject: (projectId: string, updates: ProjectUpdateInput) => Promise<Project | null>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  onSetProjectPinned?: (projectId: string, input: ProjectPinnedInput) => Promise<Project | null>;
}) {
  const [open, setOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [draftName, setDraftName] = useState(project.name);
  const [draftIcon, setDraftIcon] = useState(project.icon ?? "");
  const [draftSources, setDraftSources] = useState<string[]>(() => normalizeProjectSources(project));
  const primaryWorkspaceRoot = normalizePrimaryWorkspaceRoot(project);

  useEffect(() => {
    if (renameOpen) setDraftName(project.name);
  }, [project.name, renameOpen]);

  useEffect(() => {
    if (iconOpen) setDraftIcon(project.icon ?? "");
  }, [iconOpen, project.icon]);

  useEffect(() => {
    if (sourcesOpen) setDraftSources(normalizeProjectSources(project));
  }, [project, sourcesOpen]);

  const pickProjectSourceRoot = async () => {
    const pickedPath = (await invoke("projects:pick-source-root")) as string | null;
    if (!pickedPath) return;
    return pickedPath;
  };

  const addProjectSource = async () => {
    const pickedPath = await pickProjectSourceRoot();
    if (!pickedPath) return;
    const sources = [...normalizeProjectSources(project), pickedPath];
    await onUpdateProject(project.id, { sources });
  };

  const openProjectFolder = async () => {
    if (!primaryWorkspaceRoot) return;
    await invoke("shell:open-file-link", { path: primaryWorkspaceRoot }, "fileManager");
  };

  const submitRename = async () => {
    const nextName = draftName.trim();
    if (!nextName) return;
    const updated = await onUpdateProject(project.id, { name: nextName });
    if (!updated) return;
    setRenameOpen(false);
  };

  const submitIcon = async () => {
    const updated = await onUpdateProject(project.id, { icon: draftIcon.trim() || undefined });
    if (!updated) return;
    setIconOpen(false);
  };

  const submitSources = async () => {
    const sources = draftSources.map((source) => source.trim()).filter(Boolean);
    const updated = await onUpdateProject(project.id, { sources });
    if (!updated) return;
    setSourcesOpen(false);
  };

  const deleteProject = async () => {
    const confirmed = window.confirm(`Delete ${project.name}?`);
    if (!confirmed) return;
    await onDeleteProject(project.id);
  };

  return (
    <>
      <div
        className={open ? "opacity-100" : "opacity-0 group-hover/folder-row:opacity-100"}
        onPointerDown={stopCodexSidebarRowActionPropagation}
        onMouseDown={stopCodexSidebarRowActionPropagation}
        onKeyDown={stopCodexSidebarRowActionPropagation}
        onClick={stopCodexSidebarRowActionPropagation}
      >
        <NodexDropdownMenu
          open={open}
          onOpenChange={setOpen}
          side="bottom"
          align="end"
          contentWidth="menu"
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
          <NodexDropdownItem
            leftSlot={<Pencil className="icon-sm" />}
            onSelect={() => setRenameOpen(true)}
          >
            Rename
          </NodexDropdownItem>
          <NodexDropdownItem
            leftSlot={<Smile className="icon-sm" />}
            onSelect={() => setIconOpen(true)}
          >
            Choose icon
          </NodexDropdownItem>
          {onSetProjectPinned ? (
            <NodexDropdownItem
              leftSlot={project.pinned ? <CodexSessionPinFilledIcon className="icon-sm" /> : <CodexSessionPinIcon className="icon-sm" />}
              onSelect={() => {
                void onSetProjectPinned(project.id, { pinned: !project.pinned });
              }}
            >
              {project.pinned ? "Unpin project" : "Pin project"}
            </NodexDropdownItem>
          ) : null}
          <NodexDropdownSeparator />
          {primaryWorkspaceRoot ? (
            <NodexDropdownItem
              leftSlot={<FolderOpen className="icon-sm" />}
              subText={primaryWorkspaceRoot}
              onSelect={() => {
                void openProjectFolder();
              }}
            >
              Open in Finder
            </NodexDropdownItem>
          ) : null}
          <NodexDropdownItem
            leftSlot={<FolderPlus className="icon-sm" />}
            onSelect={() => {
              void addProjectSource();
            }}
          >
            Add source folder
          </NodexDropdownItem>
          <NodexDropdownItem
            leftSlot={<CodexFolderIcon className="icon-sm" />}
            onSelect={() => setSourcesOpen(true)}
          >
            Edit sources
          </NodexDropdownItem>
          <NodexDropdownSeparator />
          <NodexDropdownItem
            leftSlot={<Trash2 className="icon-sm text-(--red-text)" />}
            className="text-(--red-text)"
            onSelect={() => {
              void deleteProject();
            }}
          >
            Delete project
          </NodexDropdownItem>
        </NodexDropdownMenu>
      </div>

      <NodexDialog open={renameOpen} onOpenChange={setRenameOpen}>
        <NodexDialogContent className="max-w-sm">
          <NodexDialogHeader>
            <NodexDialogTitle>Rename project</NodexDialogTitle>
          </NodexDialogHeader>
          <input
            autoFocus
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            className="h-9 rounded-lg border border-token-border bg-token-main-surface-secondary px-3 text-sm outline-none focus:border-token-focus"
          />
          <NodexDialogFooter>
            <NodexButton variant="outline" onClick={() => setRenameOpen(false)}>Cancel</NodexButton>
            <NodexButton onClick={() => void submitRename()}>Save</NodexButton>
          </NodexDialogFooter>
        </NodexDialogContent>
      </NodexDialog>

      <NodexDialog open={iconOpen} onOpenChange={setIconOpen}>
        <NodexDialogContent className="max-w-sm">
          <NodexDialogHeader>
            <NodexDialogTitle>Choose icon</NodexDialogTitle>
          </NodexDialogHeader>
          <input
            autoFocus
            value={draftIcon}
            onChange={(event) => setDraftIcon(event.target.value)}
            placeholder="Emoji or short label"
            className="h-9 rounded-lg border border-token-border bg-token-main-surface-secondary px-3 text-sm outline-none focus:border-token-focus"
          />
          <NodexDialogFooter>
            <NodexButton variant="outline" onClick={() => setIconOpen(false)}>Cancel</NodexButton>
            <NodexButton onClick={() => void submitIcon()}>Save</NodexButton>
          </NodexDialogFooter>
        </NodexDialogContent>
      </NodexDialog>

      <NodexDialog open={sourcesOpen} onOpenChange={setSourcesOpen}>
        <NodexDialogContent className="max-w-lg">
          <NodexDialogHeader>
            <NodexDialogTitle>Edit sources</NodexDialogTitle>
          </NodexDialogHeader>
          <div className="grid gap-2">
            {draftSources.length === 0 ? (
              <div className="rounded-lg border border-token-border bg-token-main-surface-secondary p-3 text-sm text-token-description-foreground">
                No source folders.
              </div>
            ) : (
              draftSources.map((source, index) => (
                <div key={`${source}:${index}`} className="flex items-center gap-2">
                  <input
                    value={source}
                    onChange={(event) => {
                      const next = [...draftSources];
                      next[index] = event.target.value;
                      setDraftSources(next);
                    }}
                    className="h-8 min-w-0 flex-1 rounded-lg border border-token-border bg-token-main-surface-secondary px-2 text-sm outline-none focus:border-token-focus"
                  />
                  <NodexButton
                    variant="ghost"
                    size="sm"
                    onClick={() => setDraftSources(draftSources.filter((_, candidateIndex) => candidateIndex !== index))}
                  >
                    Remove
                  </NodexButton>
                </div>
              ))
            )}
            <NodexButton
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={async () => {
                const picked = await pickProjectSourceRoot();
                if (!picked) return;
                setDraftSources([...draftSources, picked]);
              }}
            >
              <FolderPlus className="size-4" />
              Add folder
            </NodexButton>
          </div>
          <NodexDialogFooter>
            <NodexButton variant="outline" onClick={() => setSourcesOpen(false)}>Cancel</NodexButton>
            <NodexButton onClick={() => void submitSources()}>Save</NodexButton>
          </NodexDialogFooter>
        </NodexDialogContent>
      </NodexDialog>
    </>
  );
}

export function CodexProjectRow({
  project,
  active,
  expanded,
  animateChildren = true,
  groupDndController,
  allowProjectReorder = false,
  onActivate,
  onSelectProject,
  onStartNewChat,
  onUpdateProject,
  onDeleteProject,
  onSetProjectPinned,
  children,
}: {
  project: Project;
  active: boolean;
  expanded: boolean;
  animateChildren?: boolean;
  groupDndController?: SidebarGroupDndController;
  allowProjectReorder?: boolean;
  onActivate: () => void;
  onSelectProject?: () => void;
  onStartNewChat?: () => void;
  onUpdateProject: (projectId: string, updates: ProjectUpdateInput) => Promise<Project | null>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  onSetProjectPinned?: (projectId: string, input: ProjectPinnedInput) => Promise<Project | null>;
  children?: ReactNode;
}) {
  const sortableEnabled = allowProjectReorder && Boolean(groupDndController);
  const sortableId = getSidebarGroupDndId(project.id);
  const sortableData = useMemo<SidebarGroupDndPayload>(() => ({
    kind: "sidebar-group",
    controller: groupDndController ?? NOOP_SIDEBAR_GROUP_DND_CONTROLLER,
    projectId: project.id,
  }), [groupDndController, project.id]);
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
  const sortableStyle = sortableEnabled
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

  return (
    <div
      ref={setNodeRef}
      className={cn("group/cwd flex flex-col", isDragging && "opacity-50")}
      style={sortableStyle}
      role="listitem"
      aria-label={project.name}
    >
      <div
        {...(sortableEnabled ? attributes : {})}
        data-app-action-sidebar-project-collapsed={String(!expanded)}
        data-app-action-sidebar-project-id={project.id}
        data-app-action-sidebar-project-label={project.name}
        data-app-action-sidebar-project-row=""
        data-active={active ? "true" : undefined}
        className={cn(
          CODEX_SIDEBAR_PROJECT_ROW_CLASS,
          active && "bg-token-list-hover-background",
        )}
        role="button"
        tabIndex={0}
        aria-label={project.name}
        aria-expanded={expanded}
        onClick={(event) => {
          if (event.defaultPrevented) return;
          onActivate();
        }}
        onKeyDown={(event) => handleProjectRowKeyboard(event, onActivate)}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 pl-1">
          <span className="relative flex h-6 w-6 items-center justify-center">
            <CodexProjectHoverIcon className="absolute icon-xs shrink-0 opacity-0 group-hover/folder-row:opacity-100" />
            <CodexFolderIcon className="icon-xs shrink-0 group-hover/folder-row:opacity-0" />
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
            onUpdateProject={onUpdateProject}
            onDeleteProject={onDeleteProject}
            onSetProjectPinned={onSetProjectPinned}
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
  children,
}: {
  project: Project;
  children: ReactNode;
}) {
  return (
    <div
      data-app-action-sidebar-project-list-id={project.id}
      data-app-action-sidebar-project-show-all="false"
    >
      <div className="isolate flex flex-col [contain:layout]">
        <div className="flex flex-col" role="list" aria-label={`Automations in ${project.name}`}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function CodexThreadRow({
  session,
  active,
  contextMenuOpen = false,
  onSelect,
  onOpenContextMenu,
  onRenameFromTitleDoubleClick,
  onTogglePinned,
}: {
  session: ProjectSession;
  active: boolean;
  contextMenuOpen?: boolean;
  onSelect: () => void;
  onOpenContextMenu?: (session: ProjectSession, event: MouseEvent<HTMLElement>) => void;
  onRenameFromTitleDoubleClick?: (session: ProjectSession, event: MouseEvent<HTMLElement>) => void;
  onTogglePinned?: (session: ProjectSession) => void | Promise<void>;
}) {
  const showSessionActions = !session.isOverview && Boolean(onOpenContextMenu);
  const showPinSlot = !session.isOverview && Boolean(onTogglePinned);
  const pinButtonLabel = session.pinned ? "Unpin chat" : "Pin chat";

  return (
    <div className="after:block after:h-px after:content-[''] last:after:hidden" role="listitem">
      <div
        data-app-action-sidebar-thread-active={String(active)}
        data-app-action-sidebar-thread-host-id="local"
        data-app-action-sidebar-thread-id={session.thread?.threadId ?? session.id}
        data-app-action-sidebar-thread-kind="local"
        data-app-action-sidebar-thread-pinned={String(session.pinned)}
        data-app-action-sidebar-thread-unread={String(session.unread)}
        data-app-action-sidebar-thread-row=""
        data-app-action-sidebar-thread-title={session.title}
        className={cn(
          CODEX_SIDEBAR_THREAD_ROW_CLASS,
          active && "bg-token-list-hover-background",
          contextMenuOpen && "bg-token-list-hover-background",
        )}
        role="button"
        tabIndex={0}
        data-state={contextMenuOpen ? "open" : "closed"}
        aria-current={active ? "page" : undefined}
        onClick={onSelect}
        onContextMenu={(event) => {
          if (!showSessionActions) return;
          event.preventDefault();
          onOpenContextMenu?.(session, event);
        }}
        onDoubleClick={(event) => {
          onRenameFromTitleDoubleClick?.(session, event);
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
                {session.unread ? (
                  <span
                    className="size-1.5 rounded-full bg-token-charts-blue"
                    aria-label="Unread"
                  />
                ) : null}
              </div>
            </div>
            <div className="ml-1.5 flex min-w-0 flex-1 items-center gap-2 pl-0.5">
              <div
                className="flex min-w-0 flex-1 self-stretch items-center gap-2 text-base leading-5 text-token-foreground"
                data-thread-title-trigger="true"
              >
                <span
                  className="min-w-0 flex-1 truncate select-none"
                  data-thread-title="true"
                  draggable={false}
                >
                  {session.title}
                </span>
              </div>
            </div>
            {showPinSlot ? (
              <div
                className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center"
                data-app-action-sidebar-thread-pin-slot=""
              >
                {session.unread ? (
                  <span aria-hidden="true" className="block h-5 w-5" />
                ) : (
                  <button
                    type="button"
                    aria-label={pinButtonLabel}
                    className={cn(
                      "flex h-5 w-5 items-center justify-center leading-none text-token-foreground/50 hover:text-token-foreground",
                      !session.pinned && "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100",
                    )}
                    data-state={contextMenuOpen ? "open" : "closed"}
                    data-app-action-sidebar-thread-pin-session=""
                    onPointerDown={stopCodexSidebarRowActionPropagation}
                    onMouseDown={stopCodexSidebarRowActionPropagation}
                    onKeyDown={stopCodexSidebarRowActionPropagation}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void onTogglePinned?.(session);
                    }}
                  >
                    {session.pinned ? <CodexSessionPinFilledIcon /> : <CodexSessionPinIcon />}
                  </button>
                )}
              </div>
            ) : null}
            {session.isOverview ? (
              <div className="ml-[3px] flex min-w-[26px] items-center justify-end gap-1">
                <span className="shrink-0 text-xs text-token-description-foreground">
                  default
                </span>
              </div>
            ) : null}
            {showSessionActions ? (
              <button
                type="button"
                aria-label={`Session actions for ${session.title}`}
                className={cn(
                  CODEX_SIDEBAR_PROJECT_ACTIONS_BUTTON_CLASS,
                  "ml-1 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100",
                )}
                data-state={contextMenuOpen ? "open" : "closed"}
                data-app-action-sidebar-thread-actions-menu=""
                onPointerDown={stopCodexSidebarRowActionPropagation}
                onMouseDown={stopCodexSidebarRowActionPropagation}
                onKeyDown={stopCodexSidebarRowActionPropagation}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenContextMenu?.(session, event);
                }}
              >
                <CodexProjectActionsIcon />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
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
