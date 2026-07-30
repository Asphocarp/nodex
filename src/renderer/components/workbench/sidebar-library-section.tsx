import {
  BookOpen,
  ChevronRight,
  Database,
  FileText,
  LayoutList,
  Plus,
  Shapes,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

import type {
  LibraryNavigationNode,
  LibraryNavigationParent,
  LibraryReadValue,
  LibraryRouteTarget,
} from "../../../shared/library-module";
import {
  findLibraryTreeTypeaheadTarget,
  resolveLibraryTreeKeyboardAction,
  updateLibraryTreeTypeaheadBuffer,
} from "../../lib/library-tree-navigation";
import {
  useInfiniteLibraryChildren,
  useLibraryChildren,
  useLibraryNavigationInvalidation,
  useLibraryPath,
} from "../../lib/use-library-navigation";
import { cn } from "../../lib/utils";
import {
  CodexSidebarActionButton,
  CodexSidebarSection,
} from "./codex-sidebar";
import { LibraryNewMenu } from "../library/library-new-menu";
import {
  LibraryResourceActions,
  type LibraryProjectOption,
  type LibraryResourceTarget,
} from "../library/library-resource-actions";
import {
  useSidebarLibraryResourceDnd,
  useSidebarLibraryRootDropTarget,
} from "./sidebar-library-dnd";
import type { LibraryWriteParent } from "../../../shared/library-module";

const nodeKey = (node: LibraryNavigationNode): string => {
  if (node.kind === "page") return `page:${node.pageId}`;
  if (node.kind === "database") return `database:${node.databaseId}`;
  if (node.kind === "canvas") return `canvas:${node.canvasId}`;
  return `view:${node.viewId}`;
};

const nodeTarget = (node: LibraryNavigationNode): LibraryRouteTarget => {
  if (node.kind === "page") return { kind: "page", pageId: node.pageId };
  if (node.kind === "database") {
    return { kind: "database", databaseId: node.databaseId };
  }
  if (node.kind === "canvas") {
    return { kind: "canvas", canvasId: node.canvasId };
  }
  return { kind: "view", viewId: node.viewId };
};

const targetKey = (target: LibraryRouteTarget | null): string | null => {
  if (!target) return null;
  if (target.kind === "page") return `page:${target.pageId}`;
  if (target.kind === "database") return `database:${target.databaseId}`;
  if (target.kind === "canvas") return `canvas:${target.canvasId}`;
  return `view:${target.viewId}`;
};

const nodeExpandable = (node: LibraryNavigationNode): boolean =>
  node.kind === "page"
    ? node.hasChildren
    : node.kind === "database" && node.hasMultipleViews;

const childParent = (node: LibraryNavigationNode): LibraryNavigationParent | null => {
  if (node.kind === "page") return { kind: "page", pageId: node.pageId };
  if (node.kind === "database") {
    return { kind: "database", databaseId: node.databaseId };
  }
  return null;
};

const nodeIcon = (node: LibraryNavigationNode) => {
  if (node.kind === "page") return <FileText className="icon-xs" />;
  if (node.kind === "database") return <Database className="icon-xs" />;
  if (node.kind === "canvas") return <Shapes className="icon-xs" />;
  return <LayoutList className="icon-xs" />;
};

interface LibraryTreeContext {
  readonly activeKey: string | null;
  readonly expandedKeys: ReadonlySet<string>;
  readonly focusedKey: string | null;
  readonly treeRef: RefObject<HTMLDivElement | null>;
  readonly activePath: readonly LibraryNavigationNode[];
  readonly readTypeaheadQuery: (key: string) => string;
  readonly dataSource: SidebarLibraryDataSource;
  readonly onExpandedChange: (key: string, expanded: boolean) => void;
  readonly onFocusedKeyChange: (key: string) => void;
  readonly onOpen: (target: LibraryRouteTarget) => void;
  readonly projects: readonly LibraryProjectOption[];
  readonly onOpenInProject?: (
    projectId: string,
    target: LibraryResourceTarget,
    title: string,
  ) => void | Promise<void>;
  readonly mutationsEnabled: boolean;
}

type LibraryChildrenValue = Extract<
  LibraryReadValue,
  { readonly kind: "children" }
>;
type LibraryPathValue = Extract<LibraryReadValue, { readonly kind: "path" }>;

interface LibraryQueryState<Value> {
  readonly data?: Value;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly refetch: () => Promise<unknown>;
}

interface LibraryInfiniteChildrenState {
  readonly data?: { readonly pages: readonly LibraryChildrenValue[] };
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly hasNextPage: boolean;
  readonly refetch: () => Promise<unknown>;
  readonly fetchNextPage: () => Promise<unknown>;
}

export interface SidebarLibraryDataSource {
  readonly useInvalidation: () => void;
  readonly usePath: (
    target: LibraryRouteTarget,
    enabled: boolean,
  ) => LibraryQueryState<LibraryPathValue>;
  readonly useChildren: (
    parent: LibraryNavigationParent,
    input: Readonly<{
      limit?: number;
      forceIncludeTarget?: LibraryRouteTarget;
    }>,
  ) => LibraryQueryState<LibraryChildrenValue>;
  readonly useInfiniteChildren: (
    parent: LibraryNavigationParent,
    input: Readonly<{
      limit?: number;
      forceIncludeTarget?: LibraryRouteTarget;
    }>,
    enabled: boolean,
  ) => LibraryInfiniteChildrenState;
}

const DEFAULT_LIBRARY_DATA_SOURCE: SidebarLibraryDataSource = {
  useInvalidation: useLibraryNavigationInvalidation,
  usePath: useLibraryPath,
  useChildren: useLibraryChildren,
  useInfiniteChildren: useInfiniteLibraryChildren,
};

const focusTreeItem = (
  tree: HTMLDivElement | null,
  key: string,
): void => {
  const escaped = typeof CSS !== "undefined" && CSS.escape
    ? CSS.escape(key)
    : key.replaceAll('"', '\\"');
  tree?.querySelector<HTMLElement>(`[role="treeitem"][data-library-key="${escaped}"]`)
    ?.focus();
};

function LibraryTreeItem({
  node,
  depth,
  index,
  siblingCount,
  parentKey,
  firstRoot,
  context,
  ownerParent,
}: {
  node: LibraryNavigationNode;
  depth: number;
  index: number;
  siblingCount: number;
  parentKey: string | null;
  firstRoot: boolean;
  context: LibraryTreeContext;
  ownerParent: LibraryWriteParent;
}) {
  const key = nodeKey(node);
  const expandable = nodeExpandable(node);
  const expanded = expandable && context.expandedKeys.has(key);
  const parent = expanded ? childParent(node) : null;
  const pathIndex = context.activePath.findIndex(
    (candidate) => nodeKey(candidate) === key,
  );
  const forcedChild = pathIndex >= 0
    ? context.activePath[pathIndex + 1]
    : undefined;
  const childQuery = context.dataSource.useInfiniteChildren(
    parent ?? { kind: "library" },
    {
      limit: node.kind === "page" ? 50 : 100,
      ...(forcedChild ? { forceIncludeTarget: nodeTarget(forcedChild) } : {}),
    },
    parent !== null,
  );
  const children = parent && childQuery.data
    ? [...childQuery.data.pages
        .flatMap((page) => page.items)
        .reduce((items, child) => {
          const childKey = nodeKey(child);
          if (!items.has(childKey)) items.set(childKey, child);
          return items;
        }, new Map<string, LibraryNavigationNode>())
        .values()]
    : [];
  const totalChildren = childQuery.data?.pages[0]?.total ?? children.length;
  const label = node.title || "Untitled";
  const resourceTarget = node.kind === "view" || node.kind === "canvas"
    ? null
    : nodeTarget(node) as LibraryResourceTarget;
  const ownPageParent: LibraryWriteParent | undefined = node.kind === "page"
    ? {
        kind: "page",
        pageId: node.pageId,
        expectedDocumentGeneration: node.documentGeneration,
        expectedDocumentHeadSeq: node.documentHeadSeq,
      }
    : undefined;
  const dnd = useSidebarLibraryResourceDnd({
    resource: resourceTarget
      ? {
          target: resourceTarget,
          title: label,
          expectedLocationRevision: node.kind === "page"
            ? node.parentRevision
            : node.kind === "database"
              ? node.locationRevision
              : 0,
          dragOverlay: (
            <div className="flex h-token-nav-row items-center gap-2 px-2 text-sm text-token-text-primary">
              {nodeIcon(node)}
              <span className="max-w-56 truncate">{label}</span>
            </div>
          ),
        }
      : null,
    disabledKey: key,
    ownerParent,
    ...(ownPageParent ? { nestParent: ownPageParent } : {}),
    ...(node.kind === "page"
      ? {
          before: {
            blockId: node.pageId,
            expectedLocationRevision: node.parentRevision,
          },
        }
      : node.kind === "database"
        ? {
            before: {
              blockId: node.databaseId,
              expectedLocationRevision: node.locationRevision,
            },
          }
        : {}),
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const treeItems = [
      ...(context.treeRef.current?.querySelectorAll<HTMLElement>("[role=treeitem]") ?? []),
    ];
    const visibleKeys = treeItems.flatMap((item) =>
      item.dataset.libraryKey ? [item.dataset.libraryKey] : []);
    const action = resolveLibraryTreeKeyboardAction({
      key: event.key,
      currentKey: key,
      visibleKeys,
      parentKey,
      expandable,
      expanded,
    });
    if (action.kind !== "none") {
      event.preventDefault();
      if (action.kind === "open") context.onOpen(nodeTarget(node));
      if (action.kind === "expand") context.onExpandedChange(key, true);
      if (action.kind === "collapse") context.onExpandedChange(key, false);
      if (action.kind === "focus") {
        context.onFocusedKeyChange(action.key);
        focusTreeItem(context.treeRef.current, action.key);
      }
      return;
    }
    if (event.key.length !== 1 || /\s/u.test(event.key)) return;
    const labels = treeItems.flatMap((item) =>
      item.dataset.libraryKey && item.dataset.libraryLabel
        ? [{ key: item.dataset.libraryKey, label: item.dataset.libraryLabel }]
        : []);
    const match = findLibraryTreeTypeaheadTarget({
      labels,
      currentKey: key,
      query: context.readTypeaheadQuery(event.key),
    });
    if (!match) return;
    event.preventDefault();
    context.onFocusedKeyChange(match);
    focusTreeItem(context.treeRef.current, match);
  };

  return (
    <div role="none">
      <div
        ref={dnd.setNodeRef}
        {...dnd.attributes}
        {...dnd.listeners}
        role="treeitem"
        aria-label={label}
        aria-current={context.activeKey === key ? "page" : undefined}
        aria-expanded={expandable ? expanded : undefined}
        aria-level={depth}
        aria-posinset={index + 1}
        aria-setsize={siblingCount}
        data-library-key={key}
        data-library-label={label}
        tabIndex={context.focusedKey === key || (!context.focusedKey && firstRoot) ? 0 : -1}
        className={cn(
          "group flex h-token-nav-row cursor-interaction items-center rounded-lg text-sm text-token-foreground outline-none",
          "hover:bg-token-list-hover-background focus-visible:ring-2 focus-visible:ring-token-border",
          context.activeKey === key && "bg-token-list-hover-background text-token-text-primary",
          dnd.isOver && "ring-1 ring-token-border",
          dnd.isDragging && "opacity-40",
        )}
        style={{ paddingInlineStart: `${Math.max(0, depth - 1) * 14}px` }}
        onFocus={() => context.onFocusedKeyChange(key)}
        onKeyDown={handleKeyDown}
        onDoubleClick={() => {
          if (expandable) context.onExpandedChange(key, !expanded);
        }}
        onClick={() => context.onOpen(nodeTarget(node))}
      >
        <button
          type="button"
          aria-label={expandable ? `${expanded ? "Collapse" : "Expand"} ${label}` : undefined}
          tabIndex={-1}
          className={cn(
            "flex h-6 w-5 shrink-0 items-center justify-center rounded text-token-text-secondary",
            expandable ? "hover:text-token-text-primary" : "pointer-events-none opacity-0",
          )}
          onClick={(event) => {
            event.stopPropagation();
            if (expandable) context.onExpandedChange(key, !expanded);
          }}
        >
          <ChevronRight
            aria-hidden
            className={cn("icon-2xs transition-transform", expanded && "rotate-90")}
          />
        </button>
        <span className="mr-1.5 flex shrink-0 text-token-text-secondary">
          {nodeIcon(node)}
        </span>
        <span className="min-w-0 flex-1 truncate pr-2">{label}</span>
        {node.kind !== "view" && node.kind !== "canvas" && context.mutationsEnabled ? (
          <span
            className="mr-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100"
            onClick={(event) => event.stopPropagation()}
          >
            <LibraryResourceActions
              target={nodeTarget(node) as LibraryResourceTarget}
              title={label}
              expectedLocationRevision={node.kind === "page"
                ? node.parentRevision
                : node.locationRevision}
              expectedMetadataRevision={node.metadataRevision}
              projects={context.projects}
              onOpenInProject={context.onOpenInProject}
            />
          </span>
        ) : null}
      </div>
      {expanded ? (
        <div role="group">
          {childQuery.isPending ? (
            <div className="h-token-nav-row px-6 text-xs leading-[var(--height-token-nav-row)] text-token-description-foreground">
              Loading…
            </div>
          ) : childQuery.isError ? (
            <button
              type="button"
              className="h-token-nav-row px-6 text-left text-xs text-token-description-foreground hover:text-token-text-primary"
              onClick={() => void childQuery.refetch()}
            >
              Retry loading
            </button>
          ) : children.map((child, childIndex) => (
            <LibraryTreeItem
              key={nodeKey(child)}
              node={child}
              depth={depth + 1}
              index={childIndex}
              siblingCount={totalChildren}
              parentKey={key}
              firstRoot={false}
              context={context}
              ownerParent={ownPageParent ?? ownerParent}
            />
          ))}
          {childQuery.hasNextPage ? (
            <button
              type="button"
              className="h-token-nav-row px-6 text-left text-xs text-token-description-foreground hover:text-token-text-primary"
              onClick={() => void childQuery.fetchNextPage()}
            >
              Load more
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SidebarLibrarySection({
  collapsed,
  activeTarget,
  onToggle,
  onOpenLibrary,
  onOpenTarget,
  projects = [],
  onOpenInProject,
  dataSource = DEFAULT_LIBRARY_DATA_SOURCE,
  mutationsEnabled = dataSource === DEFAULT_LIBRARY_DATA_SOURCE,
}: {
  collapsed: boolean;
  activeTarget: LibraryRouteTarget | null;
  onToggle: () => void;
  onOpenLibrary: () => void;
  onOpenTarget: (target: LibraryRouteTarget) => void;
  projects?: readonly LibraryProjectOption[];
  onOpenInProject?: (
    projectId: string,
    target: LibraryResourceTarget,
    title: string,
  ) => void | Promise<void>;
  mutationsEnabled?: boolean;
  dataSource?: SidebarLibraryDataSource;
}) {
  dataSource.useInvalidation();
  const pathQuery = dataSource.usePath(
    activeTarget ?? { kind: "page", pageId: "disabled-library-path" },
    activeTarget !== null,
  );
  const activePath = useMemo(
    () => (pathQuery.data?.nodes ?? []).filter((node, index, nodes) => {
      if (node.kind !== "view") return true;
      const database = nodes[index - 1];
      return database?.kind === "database" && database.hasMultipleViews;
    }),
    [pathQuery.data?.nodes],
  );
  const forcedRoot = activePath[0];
  const rootQuery = dataSource.useChildren({ kind: "library" }, {
    limit: 10,
    ...(forcedRoot
      ? { forceIncludeTarget: nodeTarget(forcedRoot) }
      : activeTarget
        ? { forceIncludeTarget: activeTarget }
        : {}),
  });
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef({ buffer: "", lastTypedAt: 0 });
  const activeKey = activePath.length > 0
    ? nodeKey(activePath[activePath.length - 1]!)
    : targetKey(activeTarget);
  const rootItems = rootQuery.data?.items ?? [];
  const rootDropTarget = useSidebarLibraryRootDropTarget();

  useEffect(() => {
    if (!activeKey) return;
    setFocusedKey(activeKey);
  }, [activeKey]);

  useEffect(() => {
    if (activePath.length < 2) return;
    setExpandedKeys((current) => {
      const next = new Set(current);
      for (const node of activePath.slice(0, -1)) {
        if (nodeExpandable(node)) next.add(nodeKey(node));
      }
      return next;
    });
  }, [activePath]);

  const context: LibraryTreeContext = {
    activeKey,
    expandedKeys,
    focusedKey,
    treeRef,
    activePath,
    readTypeaheadQuery: (key) => {
      const next = updateLibraryTreeTypeaheadBuffer({
        ...typeaheadRef.current,
        key,
        now: Date.now(),
      });
      typeaheadRef.current = next;
      return next.buffer;
    },
    dataSource,
    onExpandedChange: (key, expanded) => {
      setExpandedKeys((current) => {
        const next = new Set(current);
        if (expanded) next.add(key);
        else next.delete(key);
        return next;
      });
    },
    onFocusedKeyChange: setFocusedKey,
    onOpen: onOpenTarget,
    projects,
    onOpenInProject,
    mutationsEnabled,
  };

  return (
    <CodexSidebarSection
      heading="Library"
      collapsed={collapsed}
      onToggle={onToggle}
      actions={(
        <>
          <CodexSidebarActionButton label="Open Library" onClick={onOpenLibrary}>
            <BookOpen className="icon-sm" />
          </CodexSidebarActionButton>
          {mutationsEnabled ? (
            <LibraryNewMenu
              onCreated={onOpenTarget}
              triggerButton={(
                <CodexSidebarActionButton label="New Library item">
                  <Plus className="icon-sm" />
                </CodexSidebarActionButton>
              )}
            />
          ) : null}
        </>
      )}
    >
      <div ref={rootDropTarget.setNodeRef} className={cn(
        rootDropTarget.isOver && "rounded-lg ring-1 ring-token-border",
      )}>
      {rootQuery.isPending ? (
        <div className="h-token-nav-row px-2 text-sm leading-[var(--height-token-nav-row)] text-token-description-foreground">
          Loading Library…
        </div>
      ) : rootQuery.isError ? (
        <button
          type="button"
          className="h-token-nav-row rounded-lg px-2 text-left text-sm text-token-description-foreground hover:bg-token-list-hover-background"
          onClick={() => void rootQuery.refetch()}
        >
          Retry Library
        </button>
      ) : rootItems.length === 0 ? (
        <div className="h-token-nav-row px-2 text-sm leading-[var(--height-token-nav-row)] text-token-description-foreground">
          No Pages or Databases
        </div>
      ) : (
        <div ref={treeRef} role="tree" aria-label="Library content">
          {rootItems.map((node, index) => (
            <LibraryTreeItem
              key={nodeKey(node)}
              node={node}
              depth={1}
              index={index}
              siblingCount={rootQuery.data?.total ?? rootItems.length}
              parentKey={null}
              firstRoot={index === 0}
              context={context}
              ownerParent={{ kind: "library" }}
            />
          ))}
        </div>
      )}
      <button
        type="button"
        className="flex h-token-nav-row w-full items-center rounded-lg px-2 text-left text-sm text-token-description-foreground hover:bg-token-list-hover-background hover:text-token-text-primary focus-visible:outline focus-visible:outline-2"
        onClick={onOpenLibrary}
      >
        More
      </button>
      </div>
    </CodexSidebarSection>
  );
}
