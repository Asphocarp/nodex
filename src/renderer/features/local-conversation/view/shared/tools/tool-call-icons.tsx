import {
  CodexSettingsGeneralIcon,
} from "@/components/shared/icons";
import {
  cloneElement,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import type {
  CodexCommandAction,
  CodexConversationItem,
  CodexMcpServerElicitationRequest,
  CodexTranscriptEntry,
} from "../../../../../lib/types";
import { useTheme } from "../../../../../lib/use-theme";
import { cn } from "../../../../../lib/utils";
import type { ThreadBlockModel } from "../../../thread-stage-types";
import { extractCommandActions } from "./command-actions";
import {
  CodexCheckCircleIcon,
  CodexConnectorFallbackIcon,
  CodexEditFilesIcon,
  CodexFoldersIcon,
  CodexGlobeIcon,
  CodexHooksIcon,
  CodexPluginCubeIcon,
  CodexSearchIcon,
  CodexSkillIcon,
  CodexTerminalIcon,
  CodexXCircleIcon,
  withCodexIconClass,
} from "./codex-tool-icons";

export type ToolActivityIconId =
  | "approved"
  | "browser-use"
  | "code-searching"
  | "computer-use"
  | "connector"
  | "denied"
  | "edit-files"
  | "hooks"
  | "list-files"
  | "plugin"
  | "run-command"
  | "settings"
  | "skill"
  | "web-search";

export type ToolActivityIconDescriptor =
  | {
      kind: "semantic";
      icon: ToolActivityIconId;
    }
  | {
      kind: "favicon";
      hostname: string;
      src: string;
      fallbackIcon: ToolActivityIconId;
    }
  | {
      kind: "logo";
      alt: string;
      logoUrl: string | null;
      logoDarkUrl?: string | null;
      fallbackIcon: ToolActivityIconId;
    };

export type ToolActivityFaviconDescriptor = Extract<ToolActivityIconDescriptor, { kind: "favicon" }>;

const ACTIVITY_ICON_CLASS_NAME = "icon-xs shrink-0 text-token-input-placeholder-foreground";
const SOURCE_ICON_CLASS_NAME = "icon-xs shrink-0 rounded-2xs bg-token-main-surface-primary object-contain text-token-text-secondary";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function getString(record: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = record?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickFirstString(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function SemanticToolIcon({
  icon,
  className,
}: {
  icon: ToolActivityIconId;
  className?: string;
}) {
  const iconClassName = withCodexIconClass(ACTIVITY_ICON_CLASS_NAME, className);
  switch (icon) {
    case "approved":
      return <CodexCheckCircleIcon aria-hidden className={iconClassName} />;
    case "browser-use":
    case "connector":
    case "computer-use":
      return <CodexConnectorFallbackIcon aria-hidden className={iconClassName} />;
    case "code-searching":
      return <CodexSearchIcon aria-hidden className={iconClassName} />;
    case "denied":
      return <CodexXCircleIcon aria-hidden className={iconClassName} />;
    case "edit-files":
      return <CodexEditFilesIcon aria-hidden className={iconClassName} />;
    case "hooks":
      return <CodexHooksIcon aria-hidden className={iconClassName} />;
    case "list-files":
      return <CodexFoldersIcon aria-hidden className={iconClassName} />;
    case "plugin":
      return <CodexPluginCubeIcon aria-hidden className={iconClassName} />;
    case "settings":
      return <CodexSettingsGeneralIcon className={iconClassName} />;
    case "skill":
      return <CodexSkillIcon aria-hidden className={iconClassName} />;
    case "web-search":
      return <CodexGlobeIcon aria-hidden className={iconClassName} />;
    case "run-command":
      return <CodexTerminalIcon aria-hidden className={iconClassName} />;
  }
}

function LogoImageWithFallback({
  alt,
  className,
  fallback,
  src,
}: {
  alt: string;
  className: string;
  fallback: ReactNode;
  src: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed) return fallback;

  return (
    <img
      alt={alt}
      className={className}
      src={src}
      onError={() => {
        setFailed(true);
      }}
    />
  );
}

function FaviconImageWithFallback({
  className,
  fallback,
  showFallbackWhileLoading = true,
  src,
}: {
  className: string;
  fallback: ReactNode;
  showFallbackWhileLoading?: boolean;
  src: string;
}) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const hasFailed = failedSrc === src;
  const hasLoaded = loadedSrc === src;
  const fallbackNode = hasFailed || (showFallbackWhileLoading && !hasLoaded) ? fallback : null;

  return (
    <span className={cn("relative flex shrink-0 items-center justify-center", className)}>
      {fallbackNode}
      {hasFailed ? null : (
        <img
          alt=""
          className={cn("absolute h-full w-full rounded-2xs object-contain", hasLoaded ? "opacity-100" : "opacity-0")}
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          src={src}
          onError={() => {
            setFailedSrc(src);
          }}
          onLoad={() => {
            setLoadedSrc(src);
          }}
        />
      )}
    </span>
  );
}

export function selectConnectorLogoUrl({
  isDarkTheme,
  logoDarkUrl,
  logoUrl,
}: {
  isDarkTheme: boolean;
  logoDarkUrl?: string | null;
  logoUrl?: string | null;
}): string | null {
  const lightLogo = logoUrl?.trim() || null;
  const darkLogo = logoDarkUrl?.trim() || null;
  return isDarkTheme ? darkLogo ?? lightLogo : lightLogo ?? darkLogo;
}

export function ConnectorLogo({
  alt,
  className,
  fallback,
  logoDarkUrl,
  logoUrl,
}: {
  alt: string;
  className?: string;
  fallback: ReactElement<{ className?: string }>;
  logoDarkUrl?: string | null;
  logoUrl?: string | null;
}) {
  const { resolved } = useTheme();
  const mergedClassName = cn("rounded-2xs", className);
  const src = selectConnectorLogoUrl({
    isDarkTheme: resolved === "dark",
    logoDarkUrl,
    logoUrl,
  });
  const fallbackElement = cloneElement(fallback, {
    className: cn(mergedClassName, fallback.props.className),
  });

  if (!src) return fallbackElement;

  return (
    <LogoImageWithFallback
      alt={alt}
      className={mergedClassName}
      src={src}
      fallback={fallbackElement}
    />
  );
}

export function ToolActivityIcon({
  className,
  descriptor,
  showFallbackWhileLoading,
}: {
  className?: string;
  descriptor: ToolActivityIconDescriptor;
  showFallbackWhileLoading?: boolean;
}) {
  if (descriptor.kind === "semantic") {
    return (
      <span data-tool-activity-icon={descriptor.icon} className="inline-flex shrink-0">
        <SemanticToolIcon icon={descriptor.icon} className={className} />
      </span>
    );
  }

  if (descriptor.kind === "favicon") {
    const fallback = <SemanticToolIcon icon={descriptor.fallbackIcon} className={className} />;
    return (
      <span data-tool-activity-icon="favicon" data-tool-source-icon={descriptor.hostname} className="inline-flex shrink-0">
        <FaviconImageWithFallback
          className={withCodexIconClass("icon-xs shrink-0", className)}
          src={descriptor.src}
          fallback={fallback}
          showFallbackWhileLoading={showFallbackWhileLoading}
        />
      </span>
    );
  }

  return (
    <span data-tool-activity-icon="logo" data-tool-source-icon={descriptor.alt} className="inline-flex shrink-0">
      <ConnectorLogo
        alt={descriptor.alt}
        className={withCodexIconClass(SOURCE_ICON_CLASS_NAME, className)}
        logoUrl={descriptor.logoUrl}
        logoDarkUrl={descriptor.logoDarkUrl}
        fallback={<SemanticToolIcon icon={descriptor.fallbackIcon} className={className} />}
      />
    </span>
  );
}

export function semanticToolIcon(icon: ToolActivityIconId): ToolActivityIconDescriptor {
  return { kind: "semantic", icon };
}

function trimUrlPunctuation(value: string): string {
  return value.trim().replace(/^[("'`]+|[)"'`,.;!?]+$/gu, "");
}

function parseHttpUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const candidate = trimUrlPunctuation(value);
    const url = new URL(/^[a-z][a-z\d+\-.]*:\/\//iu.test(candidate) ? candidate : `https://${candidate}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

export function normalizeFaviconHostname(hostname: string): string {
  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;
  const penultimate = parts.at(-2);
  if (parts.at(-1)?.length === 2 && penultimate && penultimate.length <= 3 && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

export function buildGoogleFaviconUrl(hostname: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(normalizeFaviconHostname(hostname))}&sz=32`;
}

function extractSiteSearchTarget(query: string): URL | null {
  const siteMatch = /\bsite:([^\s]+)/iu.exec(query);
  const urlMatch = /\bhttps?:\/\/[^\s"'<>]+/iu.exec(query);
  return parseHttpUrl(siteMatch ? siteMatch[1] : urlMatch?.[0]);
}

function extractWebActionUrl(action: unknown): URL | null {
  const candidate = asRecord(action);
  if (!candidate) return null;
  const type = getString(candidate, "type");
  if (type === "openPage" || type === "findInPage") return parseHttpUrl(getString(candidate, "url"));
  return null;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

export function resolveWebFaviconDescriptor(action: unknown, fallbackQuery?: string | null): ToolActivityIconDescriptor | null {
  const actionUrl = extractWebActionUrl(action);
  if (actionUrl) {
    const hostname = normalizeFaviconHostname(actionUrl.hostname);
    return {
      kind: "favicon",
      hostname,
      src: buildGoogleFaviconUrl(hostname),
      fallbackIcon: "web-search",
    };
  }

  const actionRecord = asRecord(action);
  const queryCandidates = actionRecord && getString(actionRecord, "type") === "search"
    ? [
        getString(actionRecord, "query"),
        ...getStringArray(actionRecord.queries),
        fallbackQuery,
      ]
    : [fallbackQuery];

  for (const query of queryCandidates) {
    if (!query) continue;
    const queryUrl = extractSiteSearchTarget(query);
    if (!queryUrl) continue;
    const hostname = normalizeFaviconHostname(queryUrl.hostname);
    return {
      kind: "favicon",
      hostname,
      src: buildGoogleFaviconUrl(hostname),
      fallbackIcon: "web-search",
    };
  }

  return null;
}

export function resolveExplorationActionIcon(action: CodexCommandAction): ToolActivityIconId {
  if (action.type === "search") return "code-searching";
  if (action.type === "listFiles") return "list-files";
  if (action.type === "read" && /(^|[/\\])(?:SKILL\.md|skills?)(?:$|[/\\])/iu.test(action.path || action.name || "")) {
    return "skill";
  }
  return "run-command";
}

export function resolveExplorationEntriesIcon(entries: readonly CodexConversationItem[]): ToolActivityIconDescriptor {
  const actions = entries.flatMap((entry) => extractCommandActions(entry));
  if (actions.some((action) => resolveExplorationActionIcon(action) === "skill")) return semanticToolIcon("skill");
  if (actions.some((action) => action.type === "search")) return semanticToolIcon("code-searching");
  if (actions.some((action) => action.type === "listFiles")) return semanticToolIcon("list-files");
  return semanticToolIcon("run-command");
}

function extractAction(item: CodexTranscriptEntry): unknown {
  const rawItem = asRecord(item.rawItem);
  if (Object.prototype.hasOwnProperty.call(rawItem ?? {}, "action")) return rawItem?.action;
  return item.toolCall?.result;
}

function extractFallbackQuery(item: CodexTranscriptEntry): string | null {
  const args = asRecord(item.toolCall?.args);
  return getString(args, "query") ?? getString(asRecord(item.rawItem), "query");
}

export function resolveWebSearchIcon(item: CodexTranscriptEntry): ToolActivityIconDescriptor {
  return resolveWebSearchFavicon(item) ?? semanticToolIcon("web-search");
}

export function resolveWebSearchFavicon(item: CodexTranscriptEntry): ToolActivityFaviconDescriptor | null {
  const descriptor = resolveWebFaviconDescriptor(extractAction(item), extractFallbackQuery(item));
  if (descriptor?.kind !== "favicon") return null;
  return descriptor;
}

function extractLogoMetadata(value: unknown): { logoUrl: string | null; logoDarkUrl: string | null; nativeIconPath: string | null } {
  const record = asRecord(value);
  if (!record) return { logoUrl: null, logoDarkUrl: null, nativeIconPath: null };

  const nestedSources = [
    record,
    asRecord(record.source),
    asRecord(record.server),
    asRecord(record.app),
    asRecord(record.connector),
    asRecord(record.plugin),
    asRecord(record.meta),
    asRecord(record.metadata),
  ].filter((entry): entry is Record<string, unknown> => Boolean(entry));

  for (const candidate of nestedSources) {
    const logoUrl = pickFirstString(candidate.logoUrl, candidate.logo_url, candidate.logoPath, candidate.logo_path);
    const logoDarkUrl = pickFirstString(candidate.logoDarkUrl, candidate.logoUrlDark, candidate.logo_url_dark, candidate.logoDarkURL);
    const nativeIconPath = pickFirstString(candidate.nativeAppIconPath, candidate.appIconPath, candidate.iconPath);
    if (logoUrl || logoDarkUrl || nativeIconPath) {
      return { logoUrl, logoDarkUrl, nativeIconPath };
    }
  }

  return { logoUrl: null, logoDarkUrl: null, nativeIconPath: null };
}

export function resolveMcpSourceIcon(item: CodexTranscriptEntry): ToolActivityIconDescriptor {
  const server = item.mcpToolCall?.invocation.server ?? item.toolCall?.server ?? "MCP";
  const normalizedServer = server.trim().toLowerCase();
  const rawLogoMetadata = extractLogoMetadata(item.rawItem);
  const toolLogoMetadata = extractLogoMetadata(item.toolCall);
  const logoMetadata = {
    logoUrl: rawLogoMetadata.logoUrl ?? toolLogoMetadata.logoUrl,
    logoDarkUrl: rawLogoMetadata.logoDarkUrl ?? toolLogoMetadata.logoDarkUrl,
    nativeIconPath: rawLogoMetadata.nativeIconPath ?? toolLogoMetadata.nativeIconPath,
  };
  const alt = `${server} logo`;

  if (logoMetadata.nativeIconPath) {
    return {
      kind: "logo",
      alt,
      logoUrl: logoMetadata.nativeIconPath,
      logoDarkUrl: null,
      fallbackIcon: normalizedServer.includes("computer") ? "computer-use" : "connector",
    };
  }

  if (logoMetadata.logoUrl || logoMetadata.logoDarkUrl) {
    return {
      kind: "logo",
      alt,
      logoUrl: logoMetadata.logoUrl,
      logoDarkUrl: logoMetadata.logoDarkUrl,
      fallbackIcon: normalizedServer.includes("plugin") ? "plugin" : "connector",
    };
  }

  if (normalizedServer === "browser-use" || normalizedServer.includes("browser-use")) return semanticToolIcon("browser-use");
  if (normalizedServer.includes("computer-use") || normalizedServer.includes("computer use")) return semanticToolIcon("computer-use");
  if (normalizedServer.includes("plugin")) return semanticToolIcon("plugin");
  return semanticToolIcon("connector");
}

export function resolveMcpElicitationIcon(request: CodexMcpServerElicitationRequest): ToolActivityIconDescriptor {
  const metaLogo = extractLogoMetadata(request.meta);
  const normalizedServer = request.serverName.trim().toLowerCase();
  if (metaLogo.logoUrl || metaLogo.logoDarkUrl || metaLogo.nativeIconPath) {
    return {
      kind: "logo",
      alt: `${request.serverName} logo`,
      logoUrl: metaLogo.nativeIconPath ?? metaLogo.logoUrl,
      logoDarkUrl: metaLogo.logoDarkUrl,
      fallbackIcon: request.kind === "toolSuggestion" ? "plugin" : "connector",
    };
  }
  if (normalizedServer.includes("browser-use")) return semanticToolIcon("browser-use");
  if (normalizedServer.includes("computer-use") || normalizedServer.includes("computer use")) {
    return semanticToolIcon("computer-use");
  }
  return semanticToolIcon(request.kind === "toolSuggestion" ? "plugin" : "connector");
}

export function resolveApprovalIcon(status: string | undefined): ToolActivityIconDescriptor | null {
  if (status === "approved") return semanticToolIcon("approved");
  if (status === "denied" || status === "aborted" || status === "declined" || status === "failed") {
    return semanticToolIcon("denied");
  }
  return null;
}

function resolveTranscriptEntryIcon(block: Extract<ThreadBlockModel, { type: "collapsedToolActivity" }>["entries"][number]): ToolActivityIconDescriptor | null {
  if (block.type === "explorationGroup") return resolveExplorationEntriesIcon(block.entries);
  if (block.type === "webSearchGroup") {
    const activeEntry = [...block.entries].reverse().find((entry) => entry.status === "inProgress") ?? block.entries.at(-1);
    return activeEntry ? resolveWebSearchIcon(activeEntry.entry) : semanticToolIcon("web-search");
  }
  if (block.type === "webSearch") return resolveWebSearchIcon(block.entry);
  if (block.type === "fileChange") return semanticToolIcon("edit-files");
  if (block.type === "exec") return semanticToolIcon("run-command");
  if (block.type === "automaticApprovalReview") return resolveApprovalIcon(block.entry.status);
  if (block.type === "hook") return semanticToolIcon("hooks");
  if (block.type === "mcpToolCall") return resolveMcpSourceIcon(block.entry);
  return null;
}

export function resolveCollapsedToolActivityIcon(
  entries: Extract<ThreadBlockModel, { type: "collapsedToolActivity" }>["entries"],
): ToolActivityIconDescriptor | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const activeEntry = entries[index];
    if (!activeEntry || activeEntry.status !== "inProgress") continue;
    const activeIcon = resolveTranscriptEntryIcon(activeEntry);
    if (activeIcon) return activeIcon;
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;
    const explicitIcon = resolveTranscriptEntryIcon(entry);
    if (explicitIcon) return explicitIcon;
  }

  const priority: Array<(entry: (typeof entries)[number]) => ToolActivityIconDescriptor | null> = [
    (entry) => {
      if (entry.type !== "webSearchGroup") return null;
      const activeEntry = [...entry.entries].reverse().find((item) => item.status === "inProgress") ?? entry.entries.at(-1);
      return activeEntry ? resolveWebSearchIcon(activeEntry.entry) : semanticToolIcon("web-search");
    },
    (entry) => (entry.type === "webSearch" ? resolveWebSearchIcon(entry.entry) : null),
    (entry) => (entry.type === "explorationGroup" ? resolveExplorationEntriesIcon(entry.entries) : null),
    (entry) => (entry.type === "fileChange" ? semanticToolIcon("edit-files") : null),
    (entry) => (entry.type === "exec" ? semanticToolIcon("run-command") : null),
    (entry) => (entry.type === "automaticApprovalReview" ? resolveApprovalIcon(entry.entry.status) : null),
    (entry) => (entry.type === "hook" ? semanticToolIcon("hooks") : null),
    (entry) => (entry.type === "mcpToolCall" ? resolveMcpSourceIcon(entry.entry) : null),
  ];

  for (const resolve of priority) {
    for (const entry of entries) {
      const descriptor = resolve(entry);
      if (descriptor) return descriptor;
    }
  }

  return null;
}

export const toolCallIconTestHelpers = {
  buildGoogleFaviconUrl,
  normalizeFaviconHostname,
  resolveApprovalIcon,
  resolveExplorationActionIcon,
  resolveWebFaviconDescriptor,
  selectConnectorLogoUrl,
};
