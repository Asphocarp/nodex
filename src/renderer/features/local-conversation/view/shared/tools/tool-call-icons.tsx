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
  CodexMcpServerElicitationRequest,
  CodexTranscriptEntry,
  ProtocolAppInfo,
} from "../../../../../lib/types";
import { resolveCodexMcpVisualSource } from "../../../../../../shared/codex-mcp-tool-call";
import { useTheme } from "../../../../../lib/use-theme";
import { cn } from "../../../../../lib/utils";
import type { ThreadBlockModel } from "../../../thread-stage-types";
import {
  CodexAutomaticApprovalReviewIcon,
  CodexActivityListFilesIcon,
  CodexActivitySearchIcon,
  CodexBrowserUseIcon,
  CodexCheckCircleIcon,
  CodexComputerUseIcon,
  CodexConnectorFallbackIcon,
  CodexEditFilesIcon,
  CodexGlobeIcon,
  CodexHooksIcon,
  CodexPluginCubeIcon,
  CodexReadFilesIcon,
  CodexSkillIcon,
  CodexTerminalIcon,
  CodexXCircleIcon,
  withCodexIconClass,
} from "./codex-tool-icons";

export type ToolActivityIconId =
  | "approved"
  | "automatic-review"
  | "browser-use"
  | "code-searching"
  | "computer-use"
  | "connector"
  | "denied"
  | "edit-files"
  | "hooks"
  | "list-files"
  | "node-repl"
  | "plugin"
  | "read-files"
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
      kind: "logo";
      alt: string;
      logoUrl: string | null;
      logoDarkUrl?: string | null;
      fallbackIcon: ToolActivityIconId;
    };

const ACTIVITY_ICON_CLASS_NAME = "icon-xs shrink-0 text-token-conversation-body";
const SOURCE_ICON_CLASS_NAME = "icon-xs shrink-0 rounded-2xs bg-token-main-surface-primary object-contain text-token-text-secondary";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
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
    case "automatic-review":
      return <CodexAutomaticApprovalReviewIcon aria-hidden className={iconClassName} />;
    case "browser-use":
      return <CodexBrowserUseIcon aria-hidden className={iconClassName} />;
    case "computer-use":
      return <CodexComputerUseIcon aria-hidden className={iconClassName} />;
    case "connector":
      return <CodexConnectorFallbackIcon aria-hidden className={iconClassName} />;
    case "code-searching":
      return <CodexActivitySearchIcon aria-hidden className={iconClassName} />;
    case "denied":
      return <CodexXCircleIcon aria-hidden className={iconClassName} />;
    case "edit-files":
      return <CodexEditFilesIcon aria-hidden className={iconClassName} />;
    case "hooks":
      return <CodexHooksIcon aria-hidden className={iconClassName} />;
    case "list-files":
      return <CodexActivityListFilesIcon aria-hidden className={iconClassName} />;
    case "node-repl":
      return <CodexTerminalIcon aria-hidden className={iconClassName} />;
    case "plugin":
      return <CodexPluginCubeIcon aria-hidden className={iconClassName} />;
    case "read-files":
      return <CodexReadFilesIcon aria-hidden className={iconClassName} />;
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
}: {
  className?: string;
  descriptor: ToolActivityIconDescriptor;
}) {
  if (descriptor.kind === "semantic") {
    return (
      <span data-tool-activity-icon={descriptor.icon} className="inline-flex shrink-0">
        <SemanticToolIcon icon={descriptor.icon} className={className} />
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

export function resolveExplorationActionIcon(action: CodexCommandAction): ToolActivityIconId {
  if (action.type === "search") return "code-searching";
  if (action.type === "listFiles") return "list-files";
  if (action.type === "read" && /(^|[/\\])(?:SKILL\.md|skills?)(?:$|[/\\])/iu.test(action.path || action.name || "")) {
    return "skill";
  }
  if (action.type === "read") return "read-files";
  return "run-command";
}

export function resolveWebSearchIcon(): ToolActivityIconDescriptor {
  return semanticToolIcon("web-search");
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

export function resolveMcpSourceIcon(
  item: CodexTranscriptEntry,
  resolvedApps: readonly ProtocolAppInfo[] = [],
): ToolActivityIconDescriptor {
  const payload = item.mcpToolCall;
  if (!payload) return semanticToolIcon("connector");
  const source = resolveCodexMcpVisualSource({
    functionName: payload.functionName,
    invocation: payload.invocation,
    resolvedApps,
    source: payload.source,
  });
  if (!source) return semanticToolIcon("connector");

  const fallbackIcon: ToolActivityIconId = source.key === "browser-use"
    ? "browser-use"
    : source.key === "computer-use" || source.key.startsWith("native-app:")
      ? "computer-use"
      : source.key === "server:node_repl"
        ? "node-repl"
        : "connector";
  if (source.logoUrl || source.logoUrlDark) {
    return {
      kind: "logo",
      alt: `${source.name} logo`,
      logoUrl: source.logoUrl,
      logoDarkUrl: source.logoUrlDark,
      fallbackIcon,
    };
  }
  return semanticToolIcon(fallbackIcon);
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

function resolveTranscriptEntryIcon(
  block: Extract<ThreadBlockModel, { type: "agentActivityGroup" }>["entries"][number],
  resolvedApps: readonly ProtocolAppInfo[],
): ToolActivityIconDescriptor | null {
  if (block.type === "webSearch") return resolveWebSearchIcon();
  if (block.type === "fileChange") return semanticToolIcon("edit-files");
  if (block.type === "exec") return semanticToolIcon("run-command");
  if (block.type === "automaticApprovalReview") return semanticToolIcon("automatic-review");
  if (block.type === "hook") return semanticToolIcon("hooks");
  if (block.type === "mcpToolCall") return resolveMcpSourceIcon(block.entry, resolvedApps);
  return null;
}

export function resolveAgentActivityGroupIcon(
  entries: Extract<ThreadBlockModel, { type: "agentActivityGroup" }>["entries"],
  resolvedApps: readonly ProtocolAppInfo[] = [],
): ToolActivityIconDescriptor | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const activeEntry = entries[index];
    if (!activeEntry || activeEntry.status !== "inProgress") continue;
    const activeIcon = resolveTranscriptEntryIcon(activeEntry, resolvedApps);
    if (activeIcon) return activeIcon;
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;
    const explicitIcon = resolveTranscriptEntryIcon(entry, resolvedApps);
    if (explicitIcon) return explicitIcon;
  }

  const priority: Array<(entry: (typeof entries)[number]) => ToolActivityIconDescriptor | null> = [
    (entry) => (entry.type === "webSearch" ? resolveWebSearchIcon() : null),
    (entry) => (entry.type === "fileChange" ? semanticToolIcon("edit-files") : null),
    (entry) => (entry.type === "exec" ? semanticToolIcon("run-command") : null),
    (entry) => (entry.type === "automaticApprovalReview" ? semanticToolIcon("automatic-review") : null),
    (entry) => (entry.type === "hook" ? semanticToolIcon("hooks") : null),
    (entry) => (entry.type === "mcpToolCall" ? resolveMcpSourceIcon(entry.entry, resolvedApps) : null),
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
  resolveApprovalIcon,
  resolveExplorationActionIcon,
  selectConnectorLogoUrl,
};
