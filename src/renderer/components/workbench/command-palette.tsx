import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  NodexDialog as Dialog,
  NodexDialogContent as DialogContent,
  NodexDialogTitle as DialogTitle,
} from "@/components/ui/dialog";
import type {
  CommandMenuMode,
  CommandPalettePage,
  CommandPaletteCommand,
  CommandPaletteThread,
} from "@/lib/command-palette";
import { getBoardProjectStore } from "@/lib/board-store";
import type { Project } from "@/lib/types";
import { useCommandPalettePageSearchIndex } from "@/lib/use-command-palette-page-search-index";
import { useCommandPaletteThreadItems } from "@/lib/command-palette-chat-search";
import { useCommandPaletteThreadSearchIndex } from "@/lib/use-command-palette-thread-search-index";
import { readPropertyOptionRegistry } from "@/lib/database-property-options-runtime";
import type { RecentPageSession } from "@/lib/use-workbench-profile-preferences";
import type { DataSourcePropertyRecordV2 } from "../../../shared/database-module-v2";
import {
  buildCommandPaletteCommands,
  executeCommandPaletteShellCommand,
  isCommandPaletteShellCommandId,
  type CommandPaletteShellCommandContext,
  type CommandPaletteShellCommandHandlers,
} from "@/lib/command-palette-commands";
import { CommandPaletteSurface } from "./command-palette-surface";

interface CommandPaletteProps {
  open: boolean;
  openTriggerTick: number;
  initialMode?: CommandMenuMode;
  initialQuery?: string;
  projects: Project[];
  activeProjectId: string | null;
  recentPageSessions: RecentPageSession[];
  commandContext: Omit<CommandPaletteShellCommandContext, "isMac" | "showMockCommands">;
  commandHandlers: CommandPaletteShellCommandHandlers;
  onOpenChange: (open: boolean) => void;
  onOpenPage: (projectId: string, pageId: string, titleSnapshot?: string) => void;
  onOpenThread: (threadId: string) => void;
}

type PaletteItem = CommandPaletteCommand | CommandPalettePage | CommandPaletteThread;

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");
}

interface CommandPaletteTagRegistryRequest {
  readonly key: string;
  readonly projectId: string;
  readonly property: DataSourcePropertyRecordV2;
}

type CommandPalettePageCandidate = Omit<CommandPalettePage, "tagLabels"> & {
  readonly tagRegistryKey: string | null;
};

const UNKNOWN_OPTION_LABEL = "Unknown option";
const MAX_TAG_REGISTRY_CACHE_ENTRIES = 64;

const commandPaletteTagRegistryKey = (
  projectId: string,
  property: DataSourcePropertyRecordV2,
): string => JSON.stringify([
  projectId,
  property.dataSourceId,
  property.propertyId,
  property.revision,
  property.optionCount,
]);

const resolveCommandPaletteTagLabels = (
  optionIds: readonly string[],
  labels: ReadonlyMap<string, string> | undefined,
): string[] => {
  if (!labels) return [];
  return [...new Set(optionIds.map((optionId) =>
    labels.get(optionId) ?? UNKNOWN_OPTION_LABEL
  ))];
};

function useCommandPalettePages(
  open: boolean,
  projects: Project[],
  activeProjectId: string | null,
  recentPageSessions: RecentPageSession[],
): { pages: CommandPalettePage[]; loading: boolean } {
  const [version, setVersion] = useState(0);
  const [tagRegistries, setTagRegistries] = useState<ReadonlyMap<
    string,
    ReadonlyMap<string, string>
  >>(() => new Map());
  const tagRegistryLoadsRef = useRef(new Map<string, Promise<void>>());
  const stores = useMemo(
    () => projects.flatMap((project) => project.defaultDatabaseViewId
      ? [{
          project,
          store: getBoardProjectStore(project.id, project.defaultDatabaseViewId),
        }]
      : []),
    [projects],
  );
  const recentIndexByKey = useMemo(() => {
    const index = new Map<string, number>();
    recentPageSessions.forEach((session, order) => {
      index.set(`${session.projectId}:${session.pageId}`, order);
    });
    return index;
  }, [recentPageSessions]);

  useEffect(() => {
    if (!open || stores.length === 0) return;

    const unsubscribe = stores.map(({ store }) =>
      store.subscribe(() => {
        setVersion((value) => value + 1);
      }),
    );

    return () => {
      unsubscribe.forEach((stop) => stop());
    };
  }, [open, stores]);

  const source = useMemo(() => {
    void version;
    let loading = false;
    const pages: CommandPalettePageCandidate[] = [];
    const registryRequests = new Map<string, CommandPaletteTagRegistryRequest>();

    for (const { project, store } of stores) {
      const snapshot = store.getSnapshot();
      if (snapshot.loading && snapshot.pageIndex.size === 0) {
        loading = true;
      }
      const tagsProperty = snapshot.databaseView?.query.properties.find(
        (property) => property.lifecycle === "active" && property.propertyId === "tags",
      ) ?? null;
      const hasTagSelections = [...snapshot.pageIndex.values()].some(
        (page) => page.tags.length > 0,
      );
      const tagRegistryKey = tagsProperty && hasTagSelections
        ? commandPaletteTagRegistryKey(project.id, tagsProperty)
        : null;
      if (tagsProperty && tagRegistryKey) {
        registryRequests.set(tagRegistryKey, {
          key: tagRegistryKey,
          projectId: project.id,
          property: tagsProperty,
        });
      }

      for (const page of snapshot.pageIndex.values()) {
        pages.push({
          kind: "page",
          id: `${project.id}:${page.id}`,
          projectId: project.id,
          projectName: project.name,
          projectAppearance: project.appearance,
          columnName: page.columnName,
          page,
          tagRegistryKey,
          inActiveProject: project.id === activeProjectId,
          recentIndex: recentIndexByKey.get(`${project.id}:${page.id}`) ?? null,
          boardIndex: page.boardIndex,
        });
      }
    }

    return { pages, loading, registryRequests: [...registryRequests.values()] };
  }, [activeProjectId, recentIndexByKey, stores, version]);

  useEffect(() => {
    if (!open) return;

    for (const request of source.registryRequests) {
      if (tagRegistries.has(request.key) || tagRegistryLoadsRef.current.has(request.key)) {
        continue;
      }
      const load = readPropertyOptionRegistry(
        { kind: "project", projectId: request.projectId },
        request.property,
      )
        .then((options) => {
          setTagRegistries((current) => {
            const next = new Map(current);
            next.set(
              request.key,
              new Map(options.map((option) => [option.id, option.name] as const)),
            );
            while (next.size > MAX_TAG_REGISTRY_CACHE_ENTRIES) {
              const oldestKey = next.keys().next().value;
              if (oldestKey === undefined) break;
              next.delete(oldestKey);
            }
            return next;
          });
        })
        .catch((cause: unknown) => {
          console.error("Failed to resolve command palette tag labels", cause);
          setTagRegistries((current) => {
            if (current.has(request.key)) return current;
            return new Map(current).set(request.key, new Map());
          });
        })
        .finally(() => {
          if (tagRegistryLoadsRef.current.get(request.key) === load) {
            tagRegistryLoadsRef.current.delete(request.key);
          }
        });
      tagRegistryLoadsRef.current.set(request.key, load);
    }
  }, [open, source.registryRequests, tagRegistries]);

  return useMemo(() => ({
    loading: source.loading,
    pages: source.pages.map(({ tagRegistryKey, ...page }) => ({
      ...page,
      tagLabels: tagRegistryKey
        ? resolveCommandPaletteTagLabels(
            page.page.tags,
            tagRegistries.get(tagRegistryKey),
          )
        : [],
    })),
  }), [source.loading, source.pages, tagRegistries]);
}

export function CommandPalette({
  open,
  openTriggerTick,
  initialMode = "root",
  initialQuery,
  projects,
  activeProjectId,
  recentPageSessions,
  commandContext,
  commandHandlers,
  onOpenChange,
  onOpenPage,
  onOpenThread,
}: CommandPaletteProps) {
  const isMac = isMacPlatform();
  const { pages, loading } = useCommandPalettePages(open, projects, activeProjectId, recentPageSessions);
  const { threads, loading: threadsLoading } = useCommandPaletteThreadItems({
    enabled: open,
    activeProjectId,
    refreshKey: openTriggerTick,
  });
  const [mode, setMode] = useState<CommandMenuMode>(initialMode);
  const pageSearchIndex = useCommandPalettePageSearchIndex(pages);
  const threadSearchIndex = useCommandPaletteThreadSearchIndex(threads);
  const commands = useMemo(
    () => buildCommandPaletteCommands({
      ...commandContext,
      isMac,
      showMockCommands: import.meta.env.DEV,
    }),
    [commandContext, isMac],
  );

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
  }, [initialMode, open, openTriggerTick]);

  const handleChangeMode = useCallback((nextMode: CommandMenuMode) => {
    setMode(nextMode);
  }, []);

  const handleExecute = (item: PaletteItem) => {
    if (item.kind === "page") {
      onOpenPage(item.projectId, item.page.id, item.page.title);
      return;
    }

    if (item.kind === "thread") {
      onOpenThread(item.threadId);
      return;
    }

    if (item.id === "searchChats") {
      setMode("chats");
      return;
    }

    if (item.id === "searchPages") {
      setMode("pages");
      return;
    }

    if (item.id === "searchFiles") {
      setMode("files");
      return;
    }

    if (item.disabled) {
      return;
    }

    if (!isCommandPaletteShellCommandId(item.id)) return;
    executeCommandPaletteShellCommand(item.id, commandHandlers);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        unstyledContent
        showCloseButton={false}
        overlayClassName="bg-transparent"
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="command-menu-dialog global-command-menu-dialog w-[min(520px,92vw)] max-w-none border-none bg-transparent p-0 shadow-none"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <CommandPaletteSurface
          open={open}
          openTriggerTick={openTriggerTick}
          mode={mode}
          initialQuery={initialQuery}
          commands={commands}
          pages={pages}
          threads={threads}
          pageSearchIndex={pageSearchIndex}
          threadSearchIndex={threadSearchIndex}
          loading={loading || threadsLoading}
          pagesLoading={loading}
          chatsLoading={threadsLoading}
          onChangeMode={handleChangeMode}
          onRequestClose={() => onOpenChange(false)}
          onExecute={handleExecute}
        />
      </DialogContent>
    </Dialog>
  );
}
