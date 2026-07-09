import type { NativeContextMenuItem } from "../../../shared/native-context-menu";
import type { ProjectSession } from "@/lib/types";

export const SESSION_CONTEXT_MENU_ACTION_IDS = {
  togglePin: "session.togglePin",
  rename: "session.rename",
  archive: "archive-thread",
  markUnread: "session.markUnread",
  reveal: "session.reveal",
  copyWorkingDirectory: "session.copyWorkingDirectory",
  copySessionId: "session.copySessionId",
  copyDeeplink: "session.copyDeeplink",
  forkLocal: "session.forkLocal",
  forkNewWorktree: "session.forkNewWorktree",
  openInNewWindow: "session.openInNewWindow",
} as const;

export type SessionContextMenuActionId =
  typeof SESSION_CONTEXT_MENU_ACTION_IDS[keyof typeof SESSION_CONTEXT_MENU_ACTION_IDS];

export interface SessionContextMenuInput {
  session: ProjectSession;
  projectWorkspacePath?: string | null;
  platform?: NodeJS.Platform | "browser";
  isGitRepository?: boolean;
}

export function resolveSessionRevealPath(input: {
  session: ProjectSession;
  projectWorkspacePath?: string | null;
}): string | null {
  return input.session.thread?.cwd?.trim()
    || input.projectWorkspacePath?.trim()
    || null;
}

export function resolveRevealInFileManagerLabel(platform: NodeJS.Platform | "browser" | undefined): string {
  if (platform === "darwin") return "Reveal in Finder";
  if (platform === "win32") return "Reveal in File Explorer";
  return "Reveal in File Manager";
}

export function canForkSessionLocally(session: ProjectSession): boolean {
  return Boolean(session.thread?.threadId && session.thread.cwd);
}

export function buildSessionContextMenuItems(input: SessionContextMenuInput): NativeContextMenuItem[] {
  const { session } = input;
  const revealPath = resolveSessionRevealPath(input);
  const forkLocalEnabled = canForkSessionLocally(session);
  const forkNewWorktreeEnabled = forkLocalEnabled && input.isGitRepository === true;

  return [
    {
      id: SESSION_CONTEXT_MENU_ACTION_IDS.togglePin,
      label: session.pinned ? "Unpin" : "Pin",
      enabled: true,
      iconKey: session.pinned ? "unpin" : "pin",
    },
    {
      id: SESSION_CONTEXT_MENU_ACTION_IDS.rename,
      label: "Rename",
      enabled: true,
      iconKey: "rename",
    },
    {
      id: SESSION_CONTEXT_MENU_ACTION_IDS.archive,
      label: "Archive",
      enabled: true,
      iconKey: "archive",
    },
    { type: "separator" },
    {
      id: SESSION_CONTEXT_MENU_ACTION_IDS.markUnread,
      label: session.unread ? "Mark as read" : "Mark as unread",
      enabled: true,
      iconKey: "unread",
    },
    {
      id: SESSION_CONTEXT_MENU_ACTION_IDS.reveal,
      label: resolveRevealInFileManagerLabel(input.platform),
      enabled: Boolean(revealPath),
      iconKey: "folder",
    },
    {
      id: "session.copy",
      type: "submenu",
      label: "Copy",
      iconKey: "copy",
      submenu: [
        {
          id: SESSION_CONTEXT_MENU_ACTION_IDS.copyWorkingDirectory,
          label: "Copy working directory",
          enabled: Boolean(session.thread?.cwd),
        },
        {
          id: SESSION_CONTEXT_MENU_ACTION_IDS.copySessionId,
          label: "Copy session ID",
          enabled: true,
        },
        {
          id: SESSION_CONTEXT_MENU_ACTION_IDS.copyDeeplink,
          label: "Copy deeplink",
          enabled: true,
        },
      ],
    },
    {
      id: "session.fork",
      type: "submenu",
      label: "Fork",
      iconKey: "fork",
      submenu: [
        {
          id: SESSION_CONTEXT_MENU_ACTION_IDS.forkLocal,
          label: "Fork into local",
          enabled: forkLocalEnabled,
        },
        {
          id: SESSION_CONTEXT_MENU_ACTION_IDS.forkNewWorktree,
          label: "Fork into new worktree",
          enabled: forkNewWorktreeEnabled,
        },
      ],
    },
    { type: "separator" },
    {
      id: SESSION_CONTEXT_MENU_ACTION_IDS.openInNewWindow,
      label: "Open in new window",
      enabled: true,
      iconKey: "window",
    },
  ];
}
