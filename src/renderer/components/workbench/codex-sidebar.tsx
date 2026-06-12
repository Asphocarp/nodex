import type {
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  ReactNode,
} from "react";
import { useState } from "react";
import { FolderOpen, Settings } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
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
import { NodexTooltip } from "@/components/ui/tooltip";
import { invoke } from "@/lib/api";
import { CODEX_SIDEBAR_PROJECT_FOLDER_TRANSITION } from "@/lib/codex-panel-motion";
import type { Project, ProjectSession } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_NEW_CHAT_ROW_CLASS,
  SIDEBAR_PROJECT_NEW_CHAT_BUTTON_CLASS,
  SidebarProjectNewChatButton,
} from "./sidebar-new-chat-controls";

type SidebarRowActionEvent =
  | MouseEvent<HTMLElement>
  | PointerEvent<HTMLElement>
  | KeyboardEvent<HTMLElement>;

export const CODEX_SIDEBAR_PROJECT_ROW_CLASS = "text-token-foreground group/folder-row flex h-token-nav-row items-center justify-between overflow-x-hidden rounded-lg text-sm hover:bg-token-list-hover-background focus-visible:outline focus-visible:outline-offset-2 electron:opacity-75";
export const CODEX_SIDEBAR_SECTION_ACTIONS_CLASS = "flex items-center gap-1 pointer-events-none opacity-0 group-focus-within/projects-section-header:pointer-events-auto group-focus-within/projects-section-header:opacity-100 group-hover/projects-section-header:pointer-events-auto group-hover/projects-section-header:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100";
export const CODEX_SIDEBAR_SECTION_ACTION_BUTTON_CLASS = "border-token-border no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-full electron:rounded-md text-token-foreground enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border-transparent electron:p-1 electron:[&>svg]:icon-sm flex items-center justify-center p-0.5 h-6 w-6 rounded-md !p-1 text-token-foreground opacity-75 hover:opacity-100";
export const CODEX_SIDEBAR_PROJECT_ACTIONS_BUTTON_CLASS = SIDEBAR_PROJECT_NEW_CHAT_BUTTON_CLASS;
export const CODEX_SIDEBAR_THREAD_ROW_CLASS = "group relative h-token-nav-row cursor-interaction rounded-lg px-row-x py-row-y text-sm hover:bg-token-list-hover-background focus-visible:outline-offset-[-2px]";

export function stopCodexSidebarRowActionPropagation(event: SidebarRowActionEvent) {
  event.stopPropagation();
}

function isMacPlatform() {
  return typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");
}

function normalizeWorkspacePath(project: Project) {
  return project.workspacePath?.trim() ?? "";
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
                      "icon-2xs shrink-0 opacity-0 transition-transform group-hover/section-toggle:opacity-100 group-focus-visible/section-toggle:opacity-100",
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
  onRenameProject,
  onManageProject,
}: {
  project: Project;
  onRenameProject: (
    oldId: string,
    newId: string,
    name?: string,
    icon?: string,
    workspacePath?: string | null,
  ) => Promise<Project | null>;
  onManageProject: () => void;
}) {
  const [open, setOpen] = useState(false);
  const workspacePath = normalizeWorkspacePath(project);

  const chooseProjectFolder = async () => {
    const pickedPath = (await invoke("pty:pick-cwd")) as string | null;
    if (!pickedPath) return;
    await onRenameProject(project.id, project.id, project.name, undefined, pickedPath);
  };

  const openProjectFolder = async () => {
    if (!workspacePath) return;
    await invoke("shell:open-file-link", { path: workspacePath }, "fileManager");
  };

  return (
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
        contentWidth="sm"
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
        {workspacePath ? (
          <NodexDropdownItem
            leftSlot={<FolderOpen className="icon-sm" />}
            subText={workspacePath}
            onSelect={() => {
              void openProjectFolder();
            }}
          >
            Open in Finder
          </NodexDropdownItem>
        ) : null}
        {workspacePath ? <NodexDropdownSeparator /> : null}
        <NodexDropdownItem
          leftSlot={<CodexFolderIcon className="icon-sm" />}
          onSelect={() => {
            void chooseProjectFolder();
          }}
        >
          Choose project folder...
        </NodexDropdownItem>
        <NodexDropdownSeparator />
        <NodexDropdownItem
          leftSlot={<Settings className="icon-sm" />}
          onSelect={onManageProject}
        >
          Manage project...
        </NodexDropdownItem>
      </NodexDropdownMenu>
    </div>
  );
}

export function CodexProjectRow({
  project,
  active,
  expanded,
  animateChildren = true,
  onActivate,
  onStartNewChat,
  onRenameProject,
  onManageProject,
  children,
}: {
  project: Project;
  active: boolean;
  expanded: boolean;
  animateChildren?: boolean;
  onActivate: () => void;
  onStartNewChat?: () => void;
  onRenameProject: (
    oldId: string,
    newId: string,
    name?: string,
    icon?: string,
    workspacePath?: string | null,
  ) => Promise<Project | null>;
  onManageProject: () => void;
  children?: ReactNode;
}) {
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
    <div className="group/cwd flex flex-col" role="listitem" aria-label={project.name}>
      <div
        data-app-action-sidebar-project-collapsed={String(!expanded)}
        data-app-action-sidebar-project-id={project.id}
        data-app-action-sidebar-project-label={project.name}
        data-app-action-sidebar-project-row=""
        data-active={active ? "true" : undefined}
        className={CODEX_SIDEBAR_PROJECT_ROW_CLASS}
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
            <CodexProjectHoverIcon className="absolute opacity-0 group-hover/folder-row:opacity-100" />
            <CodexFolderIcon className="group-hover/folder-row:opacity-0" />
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap rounded-md py-1 pr-0 text-left text-base text-token-foreground">
            <span className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap">
              <span className="flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap">
                <span className="min-w-0 truncate pr-1">{project.name}</span>
              </span>
            </span>
          </div>
        </div>
        <div className="flex gap-1">
          <CodexProjectActionsMenu
            project={project}
            onRenameProject={onRenameProject}
            onManageProject={onManageProject}
          />
          {onStartNewChat ? (
            <SidebarProjectNewChatButton
              label={`Start new chat in ${project.name}`}
              onClick={onStartNewChat}
            />
          ) : null}
        </div>
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
      <div className="isolate flex flex-col [contain:layout] pb-2">
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
  onTogglePinned,
}: {
  session: ProjectSession;
  active: boolean;
  contextMenuOpen?: boolean;
  onSelect: () => void;
  onOpenContextMenu?: (session: ProjectSession, event: MouseEvent<HTMLElement>) => void;
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
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onSelect();
        }}
      >
        <div className="contents">
          <div className="flex h-full w-full items-center text-sm leading-4">
            <div className="w-4 shrink-0">
              <div className="relative flex items-center justify-center">
                {session.unread ? (
                  <span
                    className="size-1.5 rounded-full bg-token-foreground"
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

export function CodexSidebarActionButton({
  label,
  title,
  children,
  onClick,
}: {
  label: string;
  title?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <NodexTooltip delayOpen tooltipContent={title ?? label} side="right">
      <button
        type="button"
        className={CODEX_SIDEBAR_SECTION_ACTION_BUTTON_CLASS}
        title={title}
        aria-label={label}
        onPointerDown={stopCodexSidebarRowActionPropagation}
        onMouseDown={stopCodexSidebarRowActionPropagation}
        onKeyDown={stopCodexSidebarRowActionPropagation}
        onClick={(event) => {
          event.stopPropagation();
          onClick?.();
        }}
      >
        {children}
      </button>
    </NodexTooltip>
  );
}

export function resolveCodexNewChatShortcutLabel() {
  return isMacPlatform() ? "⌘N" : "Ctrl+N";
}
