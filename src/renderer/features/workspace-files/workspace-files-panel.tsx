import { useQueryClient } from "@tanstack/react-query";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ExternalLink, FileText, FolderOpen, RefreshCw } from "lucide-react";
import { MarkdownRenderer } from "@/features/local-conversation/view/shared/markdown/markdown-renderer";
import {
  CodexSidePanelFilesIcon,
  FileTreeChevronIcon,
  FileTreeFileIcon,
  SearchIcon,
} from "@/components/shared/icons";
import { NodexTooltip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import {
  LazyVirtualizedTextViewer,
  preloadVirtualizedTextViewer,
} from "@/components/ui/lazy-virtualized-text-viewer";
import { invoke } from "@/lib/api";
import {
  workspaceDirectoryQueryOptions,
  workspaceFileBinaryQueryOptions,
  workspaceFileMetadataQueryOptions,
  workspaceFileTextQueryOptions,
} from "@/lib/query-options";
import type {
  Project,
  ProjectSession,
  WorkspaceFileDirectoryEntry,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { classifyContentBudget } from "@/lib/content-budget";
import {
  getWorkspaceFileDomTabId,
  getWorkspaceFileName,
  getWorkspaceRelativePath,
  isGeneratedWorkspaceEntry,
  resolveWorkspaceFilePreviewKind,
  resolveWorkspaceTreeFilePath,
  shouldIncludeWorkspaceTreeEntry,
  type WorkspaceFilePreviewKind,
} from "./workspace-file-model";
import type { WorkspaceFilesTab, WorkspaceFilePreviewState, WorkspaceFileTreeNode } from "./workspace-file-types";

const TREE_DEFAULT_WIDTH = 250;
const TREE_MIN_WIDTH = 190;
const TREE_MAX_RATIO = 0.6;
export const WORKSPACE_TEXT_MAX_BYTES = 1_500_000;
const MAX_BINARY_PREVIEW_BYTES = 25_000_000;
const CONTENT_SAMPLE_BYTES = 8_192;
export const WORKSPACE_RICH_MARKDOWN_MAX_BYTES = 256 * 1024;
export const WORKSPACE_RICH_MARKDOWN_MAX_LINES = 5_000;

export function classifyWorkspaceMarkdownPreview(value: string) {
  return classifyContentBudget({
    value,
    maxBytes: WORKSPACE_RICH_MARKDOWN_MAX_BYTES,
    maxLines: WORKSPACE_RICH_MARKDOWN_MAX_LINES,
  });
}

type DirectoryLoadState = "idle" | "loading" | "loaded" | "error";

interface WorkspaceFilesPanelProps {
  tab: WorkspaceFilesTab;
  activeSession: ProjectSession;
  project: Project | null;
  onOpenFileTab: (input: { path: string; title: string; panelId: WorkspaceFilesTab["panelId"] }) => Promise<unknown>;
}

type EntriesByPath = Record<string, WorkspaceFileDirectoryEntry[]>;
type LoadStateByPath = Record<string, DirectoryLoadState>;

const EMPTY_PREVIEW_STATE: WorkspaceFilePreviewState = {
  status: "idle",
  path: null,
  metadata: null,
  content: "",
  binaryUrl: null,
  message: null,
};

function resolveWorkspaceRoot(tab: WorkspaceFilesTab, project: Project | null): string | null {
  const configuredRoot = tab.config.workspaceRoot?.trim();
  if (configuredRoot) return configuredRoot;
  return project?.primaryWorkspaceRoot?.trim() || project?.sources[0]?.root.trim() || null;
}

function sortTreeRows(rows: WorkspaceFileDirectoryEntry[]): WorkspaceFileDirectoryEntry[] {
  return [...rows].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  });
}

function buildVisibleTreeRows(input: {
  rootPath: string;
  entriesByPath: EntriesByPath;
  expandedPaths: ReadonlySet<string>;
  query: string;
}): WorkspaceFileTreeNode[] {
  const rows: WorkspaceFileTreeNode[] = [];
  const visit = (directoryPath: string, level: number) => {
    const entries = sortTreeRows(input.entriesByPath[directoryPath] ?? []);
    for (const entry of entries) {
      if (isGeneratedWorkspaceEntry(entry)) continue;
      if (!shouldIncludeWorkspaceTreeEntry(entry, input.query) && input.query.trim()) continue;
      rows.push({ entry, level });
      if (entry.type === "directory" && input.expandedPaths.has(entry.path)) {
        visit(entry.path, level + 1);
      }
    }
  };

  visit(input.rootPath, 0);
  return rows;
}

function buildDataUrl(dataBase64: string, mimeType: string | undefined): string {
  return `data:${mimeType || "application/octet-stream"};base64,${dataBase64}`;
}

function Breadcrumb({
  cwd,
  workspaceRoot,
  selectedPath,
}: {
  cwd: string | null;
  workspaceRoot: string | null;
  selectedPath: string | null;
}) {
  const relativeToRoot = selectedPath && workspaceRoot
    ? getWorkspaceRelativePath(workspaceRoot, selectedPath)
    : null;
  const relativeToCwd = selectedPath && cwd ? getWorkspaceRelativePath(cwd, selectedPath) : null;
  const contextRoot = relativeToRoot !== null ? workspaceRoot : relativeToCwd !== null ? cwd : null;
  const label = relativeToRoot ?? relativeToCwd ?? selectedPath ?? "";
  const parts = label.replace(/\\/g, "/").split("/").filter(Boolean);
  const rootLabel = contextRoot
    ? getWorkspaceFileName(contextRoot) || contextRoot
    : parts.shift() ?? "Files";
  return (
    <div className="flex min-w-0 items-center gap-1 text-sm text-token-text-secondary">
      <span className="shrink-0 truncate">{rootLabel}</span>
      {parts.map((part, index) => (
        <span key={`${part}:${index}`} className="flex min-w-0 items-center gap-1">
          <span className="text-token-description-foreground">/</span>
          <span className={cn("truncate", index === parts.length - 1 && "text-token-text-primary")}>{part}</span>
        </span>
      ))}
    </div>
  );
}

function WorkspaceFilePreview({
  state,
  previewKind,
  onOpenExternal,
}: {
  state: WorkspaceFilePreviewState;
  previewKind: WorkspaceFilePreviewKind | null;
  onOpenExternal: () => void;
}) {
  if (state.status === "idle") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-token-text-secondary">
        Select a file to preview.
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-token-text-secondary">
        Loading file...
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-token-text-secondary">
        <FileText className="icon-md" />
        <div>{state.message ?? "Unable to read file."}</div>
      </div>
    );
  }

  if (state.status === "unsupported" || previewKind === "unsupported") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-token-text-secondary">
        <CodexSidePanelFilesIcon className="icon-md" />
        <div>{state.message ?? "Preview is not available for this file."}</div>
        <button
          type="button"
          className="border-token-border bg-token-foreground/5 hover:bg-token-foreground/10 flex h-token-button-composer items-center gap-1.5 rounded-lg border px-2 text-base leading-[18px] text-token-text-primary"
          onClick={onOpenExternal}
        >
          <ExternalLink className="icon-2xs" />
          Open
        </button>
      </div>
    );
  }

  if (previewKind === "markdown") {
    const richPreviewDecision = classifyWorkspaceMarkdownPreview(state.content);
    if (richPreviewDecision.kind === "tooLarge") {
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex h-9 shrink-0 items-center justify-between gap-2 px-3 text-xs text-token-description-foreground">
            <span className="truncate">Rich preview is unavailable for large Markdown files.</span>
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-1 text-token-foreground hover:bg-token-foreground/5"
              onClick={onOpenExternal}
            >
              Open
            </button>
          </div>
          <LazyVirtualizedTextViewer
            value={state.content}
            ariaLabel={`Markdown source for ${getWorkspaceFileName(state.path ?? "file")}`}
            sourceIdentity={state.path ?? undefined}
            lineNumbers
            className="min-h-0 flex-1"
          />
        </div>
      );
    }

    return (
      <div className="h-full overflow-auto px-6 py-4">
        <MarkdownRenderer content={state.content} className="max-w-3xl text-sm leading-6" />
      </div>
    );
  }

  if (previewKind === "image" && state.binaryUrl) {
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-token-main-surface-primary p-4">
        <img src={state.binaryUrl} alt="" className="max-h-full max-w-full object-contain" />
      </div>
    );
  }

  if (previewKind === "pdf" && state.binaryUrl) {
    return <iframe title="PDF preview" src={state.binaryUrl} className="h-full w-full border-0" />;
  }

  return (
    <LazyVirtualizedTextViewer
      value={state.content}
      ariaLabel={`Source preview for ${getWorkspaceFileName(state.path ?? "file")}`}
      sourceIdentity={state.path ?? undefined}
      lineNumbers
      className="h-full bg-token-main-surface-primary"
    />
  );
}

function WorkspaceFileTreeRow({
  node,
  selectedPath,
  expanded,
  loading,
  onToggle,
  onOpen,
}: {
  node: WorkspaceFileTreeNode;
  selectedPath: string | null;
  expanded: boolean;
  loading: boolean;
  onToggle: (entry: WorkspaceFileDirectoryEntry) => void;
  onOpen: (entry: WorkspaceFileDirectoryEntry) => void;
}) {
  const { entry, level } = node;
  const selected = selectedPath === entry.path;
  const isDirectory = entry.type === "directory";
  const Icon = isDirectory ? FolderOpen : FileTreeFileIcon;
  return (
    <button
      type="button"
      role="treeitem"
      aria-selected={selected}
      aria-expanded={isDirectory ? expanded : undefined}
      className={cn(
        "flex h-[28px] w-full items-center gap-1 rounded-md px-2 text-left text-[13px] text-token-text-secondary hover:bg-token-list-hover-background",
        selected && "bg-token-list-active-selection-background text-token-list-active-selection-foreground",
      )}
      style={{ paddingLeft: 8 + level * 14 }}
      onClick={() => {
        if (isDirectory) {
          onToggle(entry);
          return;
        }
        onOpen(entry);
      }}
      onDoubleClick={() => {
        if (!isDirectory) onOpen(entry);
      }}
      onPointerEnter={() => {
        if (!isDirectory) preloadVirtualizedTextViewer();
      }}
      onFocus={() => {
        if (!isDirectory) preloadVirtualizedTextViewer();
      }}
    >
      <span className="flex icon-2xs shrink-0 items-center justify-center text-token-description-foreground">
        {isDirectory ? (
          <FileTreeChevronIcon className={cn("icon-2xs transition-transform duration-150", expanded && "rotate-90")} />
        ) : null}
      </span>
      <Icon className={cn("icon-2xs shrink-0", isDirectory ? "text-token-text-secondary" : "text-token-description-foreground")} />
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      {loading ? <span className="text-[11px] text-token-description-foreground">...</span> : null}
    </button>
  );
}

export function WorkspaceFilesPanel({
  tab,
  activeSession,
  project,
  onOpenFileTab,
}: WorkspaceFilesPanelProps) {
  const workspaceRoot = resolveWorkspaceRoot(tab, project);
  const hostId = tab.config.hostId ?? "local";
  const selectedPath = tab.config.path ?? null;
  const cwd = tab.config.cwd?.trim() || activeSession.thread?.cwd?.trim() || null;
  const queryClient = useQueryClient();
  const [entriesByPath, setEntriesByPath] = useState<EntriesByPath>({});
  const [loadStateByPath, setLoadStateByPath] = useState<LoadStateByPath>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(workspaceRoot ? [""] : []));
  const [filterQuery, setFilterQuery] = useState("");
  const [treeWidth, setTreeWidth] = useState(TREE_DEFAULT_WIDTH);
  const [previewState, setPreviewState] = useState<WorkspaceFilePreviewState>(EMPTY_PREVIEW_STATE);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const previewKind = previewState.metadata
    ? resolveWorkspaceFilePreviewKind(previewState.path ?? "", null)
    : null;

  const loadDirectory = useCallback(async (directoryPath: string) => {
    if (!workspaceRoot) return;
    setLoadStateByPath((current) => ({ ...current, [directoryPath]: "loading" }));
    try {
      const result = await queryClient.fetchQuery(workspaceDirectoryQueryOptions({
        hostId,
        workspaceRoot,
        directoryPath,
        includeHidden: true,
      }));
      startTransition(() => {
        setEntriesByPath((current) => ({ ...current, [result.directoryPath]: result.entries }));
        setLoadStateByPath((current) => ({ ...current, [result.directoryPath]: "loaded" }));
      });
    } catch (error) {
      setLoadStateByPath((current) => ({ ...current, [directoryPath]: "error" }));
      toast.danger(error instanceof Error ? error.message : "Unable to load files");
    }
  }, [hostId, queryClient, workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot) return;
    setEntriesByPath({});
    setExpandedPaths(new Set([""]));
    void loadDirectory("");
  }, [loadDirectory, workspaceRoot]);

  useEffect(() => {
    if (!selectedPath) {
      setPreviewState(EMPTY_PREVIEW_STATE);
      return;
    }

    let cancelled = false;
    setPreviewState({
      ...EMPTY_PREVIEW_STATE,
      status: "loading",
      path: selectedPath,
    });

    const loadPreview = async () => {
      try {
        const metadata = await queryClient.fetchQuery(workspaceFileMetadataQueryOptions({
          hostId,
          path: selectedPath,
          contentSampleByteLimit: CONTENT_SAMPLE_BYTES,
          contentSampleMaxFileBytes: MAX_BINARY_PREVIEW_BYTES,
        }));
        if (!metadata.isFile) {
          if (!cancelled) {
            setPreviewState({
              status: "unsupported",
              path: selectedPath,
              metadata,
              content: "",
              binaryUrl: null,
              message: "Directories open from the file tree.",
            });
          }
          return;
        }

        const kind = resolveWorkspaceFilePreviewKind(selectedPath, null);
        if (kind === "image" || kind === "pdf") {
          if (metadata.sizeBytes !== null && metadata.sizeBytes > MAX_BINARY_PREVIEW_BYTES) {
            if (!cancelled) {
              setPreviewState({
                status: "unsupported",
                path: selectedPath,
                metadata,
                content: "",
                binaryUrl: null,
                message: `${getWorkspaceFileName(selectedPath)} is too large to preview.`,
              });
            }
            return;
          }
          const binary = await queryClient.fetchQuery(workspaceFileBinaryQueryOptions({
            hostId,
            path: selectedPath,
          }));
          if (!binary.contentsBase64) throw new Error("Unable to read binary file.");
          const dataUrl = buildDataUrl(binary.contentsBase64, binary.mimeType);
          if (!cancelled) {
            setPreviewState({
              status: "loaded",
              path: selectedPath,
              metadata,
              content: "",
              binaryUrl: dataUrl,
              message: null,
            });
          }
          return;
        }

        if (kind === "unsupported" || metadata.contentKind === "binary") {
          if (!cancelled) {
            setPreviewState({
              status: "unsupported",
              path: selectedPath,
              metadata,
              content: "",
              binaryUrl: null,
              message: `Preview is not available for ${getWorkspaceFileName(selectedPath)}.`,
            });
          }
          return;
        }

        if (metadata.sizeBytes !== null && metadata.sizeBytes > WORKSPACE_TEXT_MAX_BYTES) {
          if (!cancelled) {
            setPreviewState({
              status: "unsupported",
              path: selectedPath,
              metadata,
              content: "",
              binaryUrl: null,
              message: `${getWorkspaceFileName(selectedPath)} is too large to preview.`,
            });
          }
          return;
        }

        const text = await queryClient.fetchQuery(workspaceFileTextQueryOptions({
          hostId,
          path: selectedPath,
          maxBytes: WORKSPACE_TEXT_MAX_BYTES,
        }));
        if (!cancelled) {
          setPreviewState({
            status: "loaded",
            path: selectedPath,
            metadata,
            content: text.contents,
            binaryUrl: null,
            message: null,
          });
        }
      } catch (error) {
        if (cancelled) return;
        setPreviewState({
          status: "error",
          path: selectedPath,
          metadata: null,
          content: "",
          binaryUrl: null,
          message: error instanceof Error ? error.message : "Unable to load file.",
        });
      }
    };

    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [hostId, queryClient, selectedPath]);

  const rows = useMemo(() => buildVisibleTreeRows({
    rootPath: "",
    entriesByPath,
    expandedPaths,
    query: filterQuery,
  }), [entriesByPath, expandedPaths, filterQuery]);
  const selectedTreePath = selectedPath && workspaceRoot
    ? getWorkspaceRelativePath(workspaceRoot, selectedPath)
    : null;

  const openTreeEntry = useCallback(async (entry: WorkspaceFileDirectoryEntry) => {
    if (!workspaceRoot) return;
    if (entry.type === "directory") {
      setExpandedPaths((current) => new Set([...current, entry.path]));
      await loadDirectory(entry.path);
      return;
    }
    await onOpenFileTab({
      path: resolveWorkspaceTreeFilePath(workspaceRoot, entry.path),
      title: entry.name,
      panelId: tab.panelId,
    });
  }, [loadDirectory, onOpenFileTab, tab.panelId, workspaceRoot]);

  const toggleTreeEntry = useCallback((entry: WorkspaceFileDirectoryEntry) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(entry.path)) {
        next.delete(entry.path);
        return next;
      }
      next.add(entry.path);
      return next;
    });
    if (!entriesByPath[entry.path]) {
      void loadDirectory(entry.path);
    }
  }, [entriesByPath, loadDirectory]);

  const openExternal = useCallback(() => {
    if (!selectedPath) return;
    void invoke("open-file", { path: selectedPath }, "fileManager").catch(() => {
      toast.danger("Unable to open file");
    });
  }, [selectedPath]);

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = treeWidth;
    const rootWidth = rootRef.current?.getBoundingClientRect().width ?? 0;
    const maxWidth = rootWidth > 0 ? Math.max(TREE_MIN_WIDTH, rootWidth * TREE_MAX_RATIO) : 520;

    const onMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(maxWidth, Math.max(TREE_MIN_WIDTH, startWidth - (moveEvent.clientX - startX)));
      setTreeWidth(nextWidth);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp, { once: true });
  }, [treeWidth]);

  if (!workspaceRoot && !selectedPath) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-token-main-surface-primary text-center text-sm text-token-text-secondary">
        <CodexSidePanelFilesIcon className="icon-md" />
        <div>No file or workspace folder is available.</div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 bg-token-main-surface-primary"
      data-workspace-files-tab-id={getWorkspaceFileDomTabId(hostId, selectedPath ?? workspaceRoot ?? undefined)}
      data-workspace-files-session-id={activeSession.id}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-toolbar-pane shrink-0 items-center gap-2 border-b-[0.5px] border-token-border px-3">
          <Breadcrumb cwd={cwd} workspaceRoot={workspaceRoot} selectedPath={selectedPath} />
          <div className="ml-auto flex items-center gap-1">
            <NodexTooltip tooltipContent="Refresh files" delayOpen>
              <button
                type="button"
                className="flex aspect-square h-token-button-composer items-center justify-center rounded-lg text-token-text-tertiary hover:bg-token-list-hover-background hover:text-token-text-primary"
                onClick={() => void loadDirectory("")}
                disabled={!workspaceRoot}
              >
                <RefreshCw className="icon-2xs" />
              </button>
            </NodexTooltip>
            <NodexTooltip tooltipContent="Open in Finder" delayOpen>
              <button
                type="button"
                className="flex aspect-square h-token-button-composer items-center justify-center rounded-lg text-token-text-tertiary hover:bg-token-list-hover-background hover:text-token-text-primary"
                onClick={openExternal}
                disabled={!selectedPath}
              >
                <ExternalLink className="icon-2xs" />
              </button>
            </NodexTooltip>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <WorkspaceFilePreview state={previewState} previewKind={previewKind} onOpenExternal={openExternal} />
        </div>
      </div>

      {workspaceRoot ? <aside
        className="relative flex h-full min-h-0 shrink-0 flex-col border-l-[0.5px] border-token-border bg-token-main-surface-primary"
        style={{ width: treeWidth, maxWidth: "60%" } satisfies CSSProperties}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          className="absolute inset-y-0 left-0 z-10 w-4 -translate-x-2 cursor-col-resize"
          onPointerDown={startResize}
        >
          <div className="mx-auto h-full w-px bg-gradient-to-b from-transparent via-token-foreground/25 to-transparent" />
        </div>
        <div className="shrink-0 p-2">
          <label
            htmlFor="workspace-directory-tree-search"
            className="relative flex h-token-button-composer w-full items-center gap-1.5 rounded-lg border border-token-border bg-token-bg-fog px-2 text-base leading-[18px]"
          >
            <SearchIcon className="icon-2xs shrink-0 text-token-description-foreground" />
            <input
              id="workspace-directory-tree-search"
              value={filterQuery}
              onInput={(event) => setFilterQuery(event.currentTarget.value)}
              placeholder="Filter files..."
              className="min-w-0 flex-1 bg-transparent text-sm text-token-text-primary outline-none placeholder:text-token-description-foreground"
            />
          </label>
        </div>
        <div
          role="tree"
          aria-label="Workspace files"
          className="min-h-0 flex-1 overflow-auto px-1 pb-2"
          style={{
            "--trees-item-height": "28px",
            "--trees-density-override": "1",
          } as CSSProperties}
        >
          {rows.length > 0 ? rows.map((node) => (
            <WorkspaceFileTreeRow
              key={node.entry.path}
              node={node}
              selectedPath={selectedTreePath}
              expanded={expandedPaths.has(node.entry.path)}
              loading={loadStateByPath[node.entry.path] === "loading"}
              onToggle={toggleTreeEntry}
              onOpen={openTreeEntry}
            />
          )) : (
            <div className="px-2 py-4 text-sm text-token-text-secondary">
              {loadStateByPath[""] === "loading" ? "Loading files..." : "No files found."}
            </div>
          )}
        </div>
      </aside> : null}
    </div>
  );
}
