import { useEffect, useState, type ReactNode } from "react";
import { Check, Circle, CircleX, LoaderCircle } from "lucide-react";
import type { CodexDynamicToolCallView } from "../../../../../lib/types";
import { cn } from "../../../../../lib/utils";
import { CodexShimmerText } from "../codex-shimmer-text";
import type { ToolComponentProps } from "./get-tool-component";
import { ThreadActivityDisclosure } from "./tool-primitives";
import { ToolActivityIcon, semanticToolIcon } from "./tool-call-icons";
import {
  type CodexAppHandoffStatus,
  type CodexAppHandoffStep,
  getDynamicToolRegistryEntry,
  parseChromeTabContextTabId,
  parseCodexAppCreateThreadResult,
  resolveCodexAppHandoffRenderState,
  resolveDynamicToolFallbackLabel,
  resolveDynamicToolRegistryLabel,
  type DynamicToolRegistryEntry,
} from "./dynamic-tool-call-utils";

function openCodexAppCreatedThreadResult(
  result: ReturnType<typeof parseCodexAppCreateThreadResult>,
  onOpenThread?: ToolComponentProps["onOpenThread"],
) {
  if (!result) return;
  if (typeof result.threadId === "string") {
    void onOpenThread?.(result.threadId);
    return;
  }
  window.location.hash = `#/worktrees/pending/${encodeURIComponent(result.pendingWorktreeId)}`;
}

function CodexAppCreatedThreadCard({
  call,
  onOpenThread,
}: {
  call: CodexDynamicToolCallView;
  onOpenThread?: ToolComponentProps["onOpenThread"];
}) {
  const result = parseCodexAppCreateThreadResult(call);
  if (!result) return null;

  const isPendingWorktree = "pendingWorktreeId" in result;
  const ariaLabel = isPendingWorktree ? "Open worktree setup" : "Open chat";
  const title = isPendingWorktree ? "Worktree chat queued" : "Chat created";
  const action = isPendingWorktree ? "Open setup" : "Open chat";

  return (
    <div className="my-1">
      <button
        type="button"
        aria-label={ariaLabel}
        className="w-full cursor-interaction text-left hover:bg-token-list-hover-background/30 focus-visible:ring-1 focus-visible:ring-token-focus-border focus-visible:outline-none focus-visible:ring-inset"
        onClick={() => openCodexAppCreatedThreadResult(result, onOpenThread)}
      >
        <div className="flex min-w-0 items-center gap-2 px-1.5 py-1">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-token-bg-secondary text-token-text-secondary">
            <ToolActivityIcon descriptor={semanticToolIcon("plugin")} className="icon-sm" />
          </span>
          <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <span className="min-w-0 truncate text-size-chat text-token-conversation-summary-leading">
              {title}
            </span>
            <span className="shrink-0 text-size-chat text-token-conversation-summary-trailing">
              {action}
            </span>
          </span>
        </div>
      </button>
    </div>
  );
}

type DynamicToolCallRenderVariant = "row" | "summary" | "summary-text";

type HandoffProgressStepStatus = "done" | "failed" | "pending" | "running";

function getThreadNavigationTarget(call: CodexDynamicToolCallView): string | null {
  if (call.tool !== "read_thread" && call.tool !== "send_message_to_thread") return null;
  if (typeof call.arguments !== "object" || call.arguments === null || Array.isArray(call.arguments)) return null;
  const threadId = (call.arguments as Record<string, unknown>).threadId;
  return typeof threadId === "string" && threadId.trim().length > 0 ? threadId.trim() : null;
}

function DynamicToolRegistryLabelRow({
  active,
  className,
  icon,
  label,
  onClick,
  variant,
}: {
  active: boolean;
  className?: string;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  variant: DynamicToolCallRenderVariant;
}) {
  const isClickableRow = variant === "row" && onClick !== undefined;
  const content = (
    <>
      {variant === "summary-text" ? null : icon}
      <CodexShimmerText
        active={active}
        className={cn(
          variant !== "summary-text" && "min-w-0 truncate",
          isClickableRow && "group-hover:!text-token-foreground",
        )}
      >
        {label}
      </CodexShimmerText>
    </>
  );
  const rowClassName = cn(
    "text-size-chat min-w-0 items-center",
    variant === "summary-text" ? "inline" : "flex gap-2",
    variant === "row" && "my-1",
    variant === "row"
      ? "text-token-conversation-summary-leading"
      : "text-token-conversation-summary-trailing group-hover/activity-header:text-token-foreground",
    isClickableRow
      && "group cursor-interaction rounded-md text-left focus-visible:ring-1 focus-visible:ring-token-focus-border focus-visible:outline-none",
    className,
  );

  if (isClickableRow) {
    return (
      <button
        type="button"
        className={rowClassName}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={rowClassName}>
      {content}
    </span>
  );
}

function resolveHandoffProgressStepStatus(status: CodexAppHandoffStatus): HandoffProgressStepStatus {
  if (status === "running") return "running";
  if (status === "success" || status === "warning") return "done";
  if (status === "error") return "failed";
  return "pending";
}

function HandoffProgressStepIcon({ status }: { status: HandoffProgressStepStatus }) {
  const className = "icon-xs";
  const icon = (() => {
    switch (status) {
      case "done":
        return <Check className={className} />;
      case "failed":
        return <CircleX className={cn(className, "text-token-editor-error-foreground")} />;
      case "running":
        return <LoaderCircle className={cn(className, "animate-spin")} />;
      case "pending":
        return <Circle className={className} />;
    }
  })();

  return (
    <span
      aria-hidden="true"
      className="flex h-4 w-4 shrink-0 items-center justify-center text-token-text-secondary"
    >
      {icon}
    </span>
  );
}

function HandoffProgressStepRow({ step }: { step: CodexAppHandoffStep }) {
  const status = resolveHandoffProgressStepStatus(step.status);
  return (
    <div className="flex items-center gap-2">
      <HandoffProgressStepIcon status={status} />
      <div className="text-size-chat text-token-conversation-summary-leading">
        <span className="sr-only">
          {status === "running"
            ? "In progress: "
            : status === "done" ? "Completed: " : status === "failed" ? "Failed: " : "Pending: "}
        </span>
        {step.label}
      </div>
    </div>
  );
}

function CodexAppHandoffToolCall({
  call,
  variant = "row",
}: {
  call: CodexDynamicToolCallView;
  variant?: DynamicToolCallRenderVariant;
}) {
  if (!resolveDynamicToolRegistryLabel(call)) return null;
  const state = resolveCodexAppHandoffRenderState(call);
  const icon = (
    <ToolActivityIcon
      descriptor={semanticToolIcon("plugin")}
      className="icon-xs shrink-0 text-token-text-secondary"
    />
  );

  if (variant !== "row") {
    return (
      <DynamicToolRegistryLabelRow
        active={state.active}
        icon={variant === "summary-text" ? null : icon}
        label={state.label}
        variant={variant}
      />
    );
  }

  const steps = state.result?.steps ?? [];
  const canExpand = steps.length > 0;
  const summary = (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2 truncate text-token-conversation-summary-leading">
      {icon}
      <CodexShimmerText
        active={state.active}
        className="min-w-0 truncate"
      >
        {state.label}
      </CodexShimmerText>
    </span>
  );

  return (
    <ThreadActivityDisclosure
      bodyClassName="pt-1 pl-5"
      canExpand={canExpand}
      defaultExpanded={state.activityStatus === "running" && canExpand}
      shouldAnimateInitialCollapse={state.activityStatus === "running" && canExpand}
      summary={summary}
    >
      <div className="flex flex-col gap-1">
        {steps.map((step) => (
          <HandoffProgressStepRow key={step.id} step={step} />
        ))}
      </div>
    </ThreadActivityDisclosure>
  );
}

function CodexAppThreadToolCall({
  call,
  onOpenThread,
  variant = "row",
}: {
  call: CodexDynamicToolCallView;
  onOpenThread?: ToolComponentProps["onOpenThread"];
  variant?: DynamicToolCallRenderVariant;
}) {
  if (call.tool === "handoff_thread") {
    return <CodexAppHandoffToolCall call={call} variant={variant} />;
  }

  if (variant === "row" && call.tool === "create_thread" && call.completed && call.success === true) {
    const card = <CodexAppCreatedThreadCard call={call} onOpenThread={onOpenThread} />;
    if (card) return card;
  }

  const label = resolveDynamicToolRegistryLabel(call);
  if (!label) return null;
  const navigationThreadId = variant === "row" ? getThreadNavigationTarget(call) : null;
  const isNavigableRow = navigationThreadId !== null;
  const iconClassName = cn(
    "icon-xs shrink-0 text-token-text-secondary",
    isNavigableRow && "group-hover:!text-token-foreground",
  );

  return (
    <DynamicToolRegistryLabelRow
      active={!call.completed}
      icon={variant === "summary-text" ? null : (
        <ToolActivityIcon
          descriptor={semanticToolIcon("plugin")}
          className={iconClassName}
        />
      )}
      label={label}
      onClick={navigationThreadId && onOpenThread ? () => {
        void onOpenThread(navigationThreadId);
      } : undefined}
      variant={variant}
    />
  );
}

function SettingsToolCall({
  call,
  variant = "row",
}: {
  call: CodexDynamicToolCallView;
  variant?: DynamicToolCallRenderVariant;
}) {
  const label = resolveDynamicToolRegistryLabel(call);
  if (!label) return null;

  return (
    <DynamicToolRegistryLabelRow
      active={!call.completed}
      icon={variant === "summary-text" ? null : (
        <ToolActivityIcon
          descriptor={semanticToolIcon("settings")}
          className="icon-xs shrink-0 text-token-text-secondary"
        />
      )}
      label={label}
      variant={variant}
    />
  );
}

interface ChromeTabMetadata {
  faviconUrl: string | null;
  title: string | null;
}

type ChromeRuntimeApi = {
  getURL?: (path: string) => string;
};

type ChromeTabsApi = {
  get?: (tabId: number) => Promise<{
    favIconUrl?: string | null;
    pendingUrl?: string | null;
    title?: string | null;
    url?: string | null;
  }>;
};

type ChromeExtensionApi = {
  runtime?: ChromeRuntimeApi | null;
  tabs?: ChromeTabsApi | null;
};

function getChromeExtensionApi(): ChromeExtensionApi | null {
  const value = (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
  if (typeof value !== "object" || value === null) return null;
  return value as ChromeExtensionApi;
}

function resolveChromeFaviconUrl(
  tab: Awaited<ReturnType<NonNullable<ChromeTabsApi["get"]>>>,
  runtime: ChromeRuntimeApi | null | undefined,
): string | null {
  const favicon = tab.favIconUrl?.trim();
  if (!favicon) return null;
  const pageUrl = (tab.url ?? tab.pendingUrl ?? "").trim();
  if (!pageUrl || !runtime?.getURL) return favicon;

  try {
    const url = new URL(runtime.getURL("/_favicon/"));
    url.searchParams.set("pageUrl", pageUrl);
    url.searchParams.set("size", "32");
    return url.toString();
  } catch {
    return favicon;
  }
}

function useChromeTabMetadata(tabId: number | null, enabled: boolean): ChromeTabMetadata | null {
  const [metadata, setMetadata] = useState<ChromeTabMetadata | null>(null);

  useEffect(() => {
    if (!enabled || tabId === null) return;
    const chromeApi = getChromeExtensionApi();
    const getTab = chromeApi?.tabs?.get;
    if (!getTab) return;

    let cancelled = false;
    void getTab(tabId).then((tab) => {
      if (cancelled) return;
      const title = tab.title?.trim() || null;
      setMetadata({
        faviconUrl: resolveChromeFaviconUrl(tab, chromeApi.runtime),
        title,
      });
    }).catch(() => {
      if (!cancelled) setMetadata(null);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, tabId]);

  return metadata;
}

function ChromeTabContextToolCall({
  call,
  variant = "row",
}: {
  call: CodexDynamicToolCallView;
  variant?: DynamicToolCallRenderVariant;
}) {
  const tabId = parseChromeTabContextTabId(call);
  const metadata = useChromeTabMetadata(tabId, tabId !== null && !call.completed);
  if (tabId === null) return null;

  const baseLabel = resolveDynamicToolRegistryLabel(call);
  if (!baseLabel) return null;
  const label = metadata?.title
    ? call.completed ? `Read "${metadata.title}"` : `Reading "${metadata.title}"`
    : baseLabel;

  return (
    <DynamicToolRegistryLabelRow
      active={!call.completed}
      icon={variant !== "summary-text" && metadata?.faviconUrl ? (
        <img
          alt=""
          className="icon-xs shrink-0 text-token-input-placeholder-foreground"
          src={metadata.faviconUrl}
        />
      ) : null}
      label={label}
      variant={variant}
    />
  );
}

function renderRegisteredDynamicToolCall({
  call,
  entry,
  onOpenThread,
  variant,
}: {
  call: CodexDynamicToolCallView;
  entry: DynamicToolRegistryEntry;
  onOpenThread?: ToolComponentProps["onOpenThread"];
  variant: DynamicToolCallRenderVariant;
}) {
  switch (entry.rendererKind) {
    case "chromeTabContext":
      if (parseChromeTabContextTabId(call) === null) return null;
      return <ChromeTabContextToolCall call={call} variant={variant} />;
    case "codexAppThread":
      if (!resolveDynamicToolRegistryLabel(call)) return null;
      return <CodexAppThreadToolCall call={call} onOpenThread={onOpenThread} variant={variant} />;
    case "settings":
      if (!resolveDynamicToolRegistryLabel(call)) return null;
      return <SettingsToolCall call={call} variant={variant} />;
  }
}

function DynamicToolFallbackLabel({
  call,
  variant = "row",
}: {
  call: CodexDynamicToolCallView;
  variant?: DynamicToolCallRenderVariant;
}) {
  const isCodexApp = call.namespace === "codex_app";
  const showIcon = isCodexApp && variant !== "summary-text";
  const label = resolveDynamicToolFallbackLabel(call);
  const content = (
    <span
      className={cn(
        "text-size-chat text-token-conversation-summary-trailing",
        variant === "row"
          ? "group-hover:text-token-foreground"
          : "group-hover/activity-header:text-token-foreground",
        showIcon && "flex min-w-0 items-center gap-2",
      )}
    >
      {showIcon ? (
        <ToolActivityIcon
          descriptor={semanticToolIcon("plugin")}
          className="icon-xs shrink-0 text-token-text-secondary"
        />
      ) : null}
      <CodexShimmerText active={!call.completed} className={cn(showIcon && "min-w-0 truncate")}>
        {label}
      </CodexShimmerText>
    </span>
  );

  if (variant !== "row") return content;

  return (
    <div className="group">
      {content}
    </div>
  );
}

export function DynamicToolCallSummary({
  call,
  variant = "summary",
}: {
  call: CodexDynamicToolCallView;
  variant?: Exclude<DynamicToolCallRenderVariant, "row">;
}) {
  const entry = getDynamicToolRegistryEntry(call);
  if (entry) {
    const rendered = renderRegisteredDynamicToolCall({
      call,
      entry,
      variant,
    });
    if (rendered) return rendered;
  }

  return <DynamicToolFallbackLabel call={call} variant={variant} />;
}

export function DynamicToolCall({ item, onOpenThread }: ToolComponentProps) {
  const call = item.dynamicToolCall ?? null;

  if (!call) return null;

  const entry = getDynamicToolRegistryEntry(call);
  if (entry) {
    const rendered = renderRegisteredDynamicToolCall({
      call,
      entry,
      onOpenThread,
      variant: "row",
    });
    if (rendered) return rendered;
  }

  return <DynamicToolFallbackLabel call={call} />;
}
