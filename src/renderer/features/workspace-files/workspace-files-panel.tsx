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
import { invoke } from "@/lib/api";
import type {
  Project,
  ProjectSession,
  WorkspaceFileDirectoryEntry,
  WorkspaceFileMetadata,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  getWorkspaceFileDomTabId,
  getWorkspaceFileName,
  isGeneratedWorkspaceEntry,
  resolveWorkspaceFilePreviewKind,
  shouldIncludeWorkspaceTreeEntry,
  type WorkspaceFilePreviewKind,
} from "./workspace-file-model";
import type { WorkspaceFilesTab, WorkspaceFilePreviewState, WorkspaceFileTreeNode } from "./workspace-file-types";

const TREE_DEFAULT_WIDTH = 250;
const TREE_MIN_WIDTH = 190;
const TREE_MAX_RATIO = 0.6;
const MAX_TEXT_PREVIEW_BYTES = 1_500_000;

type DirectoryLoadState = "idle" | "loading" | "loaded" | "error";

interface WorkspaceFilesPanelProps {
  tab: WorkspaceFilesTab;
  activeSession: ProjectSession;
  project: Project | null;
  onOpenFileTab: (input: { path: string; title: string; panelId: WorkspaceFilesTab["panelId"] }) => Promise<void>;
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

function resolveWorkspaceRoot(tab: WorkspaceFilesTab, project: Project | null): string {
  const configuredRoot = tab.config.workspaceRoot?.trim();
  if (configuredRoot) return configuredRoot;
  return project?.workspacePath?.trim() ?? "";
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function sortTreeRows(rows: WorkspaceFileDirectoryEntry[]): WorkspaceFileDirectoryEntry[] {
  return [...rows].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
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
      if (entry.isDirectory && input.expandedPaths.has(entry.path)) {
        visit(entry.path, level + 1);
      }
    }
  };

  if (input.rootPath) visit(input.rootPath, 0);
  return rows;
}

function buildDataUrl(dataBase64: string, mimeType: string | null): string {
  return `data:${mimeType || "application/octet-stream"};base64,${dataBase64}`;
}

function Breadcrumb({ workspaceRoot, selectedPath }: { workspaceRoot: string; selectedPath: string | null }) {
  const label = selectedPath ? selectedPath.replace(workspaceRoot, "").replace(/^\/+/, "") : "";
  const parts = label ? label.split("/") : [];
  return (
    <div className="flex min-w-0 items-center gap-1 text-sm text-token-text-secondary">
      <span className="shrink-0 truncate">{getWorkspaceFileName(workspaceRoot) || workspaceRoot}</span>
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
    <pre className="h-full overflow-auto whitespace-pre-wrap break-words bg-token-main-surface-primary px-6 py-4 font-mono text-[12px] leading-5 text-token-text-primary">
      {state.content}
    </pre>
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
  const Icon = entry.isDirectory ? FolderOpen : FileTreeFileIcon;
  return (
    <button
      type="button"
      role="treeitem"
      aria-selected={selected}
      aria-expanded={entry.isDirectory ? expanded : undefined}
      className={cn(
        "flex h-[28px] w-full items-center gap-1 rounded-md px-2 text-left text-[13px] text-token-text-secondary hover:bg-token-list-hover-background",
        selected && "bg-token-list-active-selection-background text-token-list-active-selection-foreground",
      )}
      style={{ paddingLeft: 8 + level * 14 }}
      onClick={() => {
        if (entry.isDirectory) {
          onToggle(entry);
          return;
        }
        onOpen(entry);
      }}
      onDoubleClick={() => {
        if (!entry.isDirectory) onOpen(entry);
      }}
    >
      <span className="flex icon-2xs shrink-0 items-center justify-center text-token-description-foreground">
        {entry.isDirectory ? (
          <FileTreeChevronIcon className={cn("icon-2xs transition-transform duration-150", expanded && "rotate-90")} />
        ) : null}
      </span>
      <Icon className={cn("icon-2xs shrink-0", entry.isDirectory ? "text-token-text-secondary" : "text-token-description-foreground")} />
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
  const [entriesByPath, setEntriesByPath] = useState<EntriesByPath>({});
  const [loadStateByPath, setLoadStateByPath] = useState<LoadStateByPath>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(workspaceRoot ? [workspaceRoot] : []));
  const [filterQuery, setFilterQuery] = useState("");
  const [treeWidth, setTreeWidth] = useState(TREE_DEFAULT_WIDTH);
  const [previewState, setPreviewState] = useState<WorkspaceFilePreviewState>(EMPTY_PREVIEW_STATE);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const previewKind = previewState.metadata
    ? resolveWorkspaceFilePreviewKind(previewState.path ?? "", previewState.metadata.mimeType)
    : null;

  const loadDirectory = useCallback(async (path: string) => {
    if (!workspaceRoot) return;
    setLoadStateByPath((current) => ({ ...current, [path]: "loading" }));
    try {
      const result = await invoke("workspace-directory-entries", {
        hostId,
        workspaceRoot,
        path,
        includeHidden: true,
        includeGenerated: false,
      });
      startTransition(() => {
        setEntriesByPath((current) => ({ ...current, [path]: result.entries }));
        setLoadStateByPath((current) => ({ ...current, [path]: "loaded" }));
      });
    } catch (error) {
      setLoadStateByPath((current) => ({ ...current, [path]: "error" }));
      toast.danger(error instanceof Error ? error.message : "Unable to load files");
    }
  }, [hostId, workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot) return;
    setExpandedPaths(new Set([workspaceRoot]));
    void loadDirectory(workspaceRoot);
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
        const metadata = await invoke("read-file-metadata", { hostId, workspaceRoot, path: selectedPath }) as WorkspaceFileMetadata;
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

        const kind = resolveWorkspaceFilePreviewKind(selectedPath, metadata.mimeType);
        if (kind === "image" || kind === "pdf") {
          const binary = await invoke("read-file-binary", { hostId, workspaceRoot, path: selectedPath });
          const dataUrl = buildDataUrl(binary.dataBase64, binary.mimeType);
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

        if (kind === "unsupported" || metadata.binary) {
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

        const text = await invoke("read-file", {
          hostId,
          workspaceRoot,
          path: selectedPath,
          maxBytes: MAX_TEXT_PREVIEW_BYTES,
        });
        if (!cancelled) {
          setPreviewState({
            status: "loaded",
            path: selectedPath,
            metadata,
            content: text.truncated ? `${text.content}\n\n[File truncated after ${formatBytes(MAX_TEXT_PREVIEW_BYTES)}]` : text.content,
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
  }, [hostId, selectedPath, workspaceRoot]);

  const rows = useMemo(() => buildVisibleTreeRows({
    rootPath: workspaceRoot,
    entriesByPath,
    expandedPaths,
    query: filterQuery,
  }), [entriesByPath, expandedPaths, filterQuery, workspaceRoot]);

  const openTreeEntry = useCallback(async (entry: WorkspaceFileDirectoryEntry) => {
    if (entry.isDirectory) {
      setExpandedPaths((current) => new Set([...current, entry.path]));
      await loadDirectory(entry.path);
      return;
    }
    await onOpenFileTab({
      path: entry.path,
      title: entry.name,
      panelId: tab.panelId,
    });
  }, [loadDirectory, onOpenFileTab, tab.panelId]);

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

  if (!workspaceRoot) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-token-main-surface-primary text-center text-sm text-token-text-secondary">
        <CodexSidePanelFilesIcon className="icon-md" />
        <div>This project does not have a workspace folder.</div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 bg-token-main-surface-primary"
      data-workspace-files-tab-id={getWorkspaceFileDomTabId(hostId, selectedPath ?? workspaceRoot)}
      data-workspace-files-session-id={activeSession.id}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-toolbar-pane shrink-0 items-center gap-2 border-b border-token-border px-3">
          <Breadcrumb workspaceRoot={workspaceRoot} selectedPath={selectedPath} />
          <div className="ml-auto flex items-center gap-1">
            <NodexTooltip tooltipContent="Refresh files" delayOpen>
              <button
                type="button"
                className="flex aspect-square h-token-button-composer items-center justify-center rounded-lg text-token-text-tertiary hover:bg-token-list-hover-background hover:text-token-text-primary"
                onClick={() => void loadDirectory(workspaceRoot)}
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

      <aside
        className="relative flex h-full min-h-0 shrink-0 flex-col border-l border-token-border bg-token-main-surface-primary"
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
              selectedPath={selectedPath}
              expanded={expandedPaths.has(node.entry.path)}
              loading={loadStateByPath[node.entry.path] === "loading"}
              onToggle={toggleTreeEntry}
              onOpen={openTreeEntry}
            />
          )) : (
            <div className="px-2 py-4 text-sm text-token-text-secondary">
              {loadStateByPath[workspaceRoot] === "loading" ? "Loading files..." : "No files found."}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
