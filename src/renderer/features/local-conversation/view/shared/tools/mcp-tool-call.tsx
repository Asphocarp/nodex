import { motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronRightIcon, CodeBracketsIcon, CodexPanelRightVisibleIcon } from "@/components/shared/icons";
import {
  NodexDialog as Dialog,
  NodexDialogContent as DialogContent,
  NodexDialogHeader as DialogHeader,
  NodexDialogTitle as DialogTitle,
} from "../../../../../components/ui/dialog";
import { NodexTooltip } from "../../../../../components/ui/tooltip";
import type {
  CodexMcpToolCallContentBlock,
  CodexMcpToolCallView,
  CodexTranscriptEntry,
  ProtocolMcpResourceReadResponse,
  ProtocolMcpServerStatus,
} from "../../../../../lib/types";
import type { ThreadMcpAppSidePanelInput, ThreadStageActions } from "../../../thread-stage-types";
import { invoke } from "../../../../../lib/api";
import { cn } from "../../../../../lib/utils";
import { CODEX_THREAD_ACCORDION_TRANSITION } from "../thread-motion";
import { useMeasuredElementHeight } from "../use-measured-element-height";
import { CopyMessageActionButton } from "../thread-message-actions";
import { CodexShimmerText } from "../codex-shimmer-text";
import { ToolErrorDetail } from "./tool-primitives";
import {
  asRecord,
  humanizeIdentifier,
} from "./tool-call-utils";
import { ToolActivityIcon, resolveMcpSourceIcon } from "./tool-call-icons";
import { McpCapabilityViewFrame } from "./mcp-capability-view-frame";
import {
  resolveMcpAppResourceUri,
  resolveMcpRenderableResource,
  shouldHideDuplicateMcpTextContent,
  type McpRenderableResource,
} from "./mcp-tool-call-resource-utils";

const electronToolIconSizeClassName = `electron:[&>svg]:${"icon-sm"}`;

interface McpToolCallProps {
  item: CodexTranscriptEntry;
  rawDialogOpen?: boolean;
  onRawDialogOpenChange?: (open: boolean) => void;
  onOpenMcpAppSidePanel?: ThreadStageActions["onOpenMcpAppSidePanel"];
}

function formatServerName(server: string): string {
  const humanized = humanizeIdentifier(server);
  return humanized.length > 0 ? humanized : "MCP";
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function resolveMcpToolCallLabel(payload: CodexMcpToolCallView): { leading: string; trailing: string } {
  const server = normalizeIdentifier(payload.invocation.server);
  const tool = normalizeIdentifier(payload.invocation.tool);
  const completed = payload.completed;
  const activeVerb = completed ? "Used" : "Using";

  if (server.includes("browser-use")) return { leading: activeVerb, trailing: "the browser" };
  if (server.includes("computer-use") || server.includes("computer")) {
    if (tool.includes("click")) return { leading: completed ? "Clicked" : "Clicking", trailing: "on screen" };
    if (tool.includes("drag")) return { leading: completed ? "Dragged" : "Dragging", trailing: "on screen" };
    if (tool.includes("key") || tool.includes("type")) return { leading: completed ? "Typed" : "Typing", trailing: "on screen" };
    if (tool.includes("scroll")) return { leading: completed ? "Scrolled" : "Scrolling", trailing: "on screen" };
    return { leading: activeVerb, trailing: "computer" };
  }
  if (server.includes("github")) return { leading: activeVerb, trailing: "GitHub" };
  if (server.includes("gmail")) return { leading: completed ? "Read" : "Reading", trailing: "Gmail" };
  if (server.includes("calendar")) return { leading: activeVerb, trailing: "Google Calendar" };
  if (server.includes("drive")) return { leading: activeVerb, trailing: "Google Drive" };
  if (server.includes("figma")) return { leading: activeVerb, trailing: "Figma" };

  return {
    leading: payload.completed ? "Called" : "Calling",
    trailing: `${humanizeIdentifier(payload.invocation.tool)} tool from ${formatServerName(payload.invocation.server)}`,
  };
}

function stringifyMcpValue(value: unknown, spacing = 2): string {
  try {
    return JSON.stringify(
      value,
      (_key, nestedValue) => (typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue),
      spacing,
    ) ?? "null";
  } catch {
    return "";
  }
}

export function buildMcpAppSidePanelInput(input: {
  threadId: string;
  payload: CodexMcpToolCallView;
  resource: McpRenderableResource;
}): ThreadMcpAppSidePanelInput {
  const server = input.payload.invocation.server;
  const tool = input.payload.invocation.tool;
  const title = `${humanizeIdentifier(tool)} - ${formatServerName(server)}`;

  return {
    mcpAppId: `${server}:${input.resource.uri}`,
    capabilityId: `mcp-capability:${input.threadId}:${server}:${tool}:${input.payload.callId}`,
    title,
    threadId: input.threadId,
    server,
    tool,
    resource: input.resource,
  };
}

function formatAnnotationValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(formatAnnotationValue).filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
}

function formatAnnotations(annotations: unknown): string | null {
  const candidate = asRecord(annotations);
  if (!candidate) return null;

  const parts = Object.entries(candidate).reduce<string[]>((acc, [key, value]) => {
    const formatted = formatAnnotationValue(value);
    if (!formatted) return acc;
    acc.push(`${key}=${formatted}`);
    return acc;
  }, []);

  return parts.length > 0 ? parts.join("; ") : null;
}

function appendAnnotations(text: string, annotations: unknown): string {
  const formatted = formatAnnotations(annotations);
  if (!formatted) return text;
  return `${text}\nAnnotations: ${formatted}`;
}

function McpCodePanel({
  title,
  content,
  copyText,
  bodyClassName,
  preClassName,
  stickyHeaderClassName,
}: {
  title: string;
  content: string;
  copyText?: string;
  bodyClassName?: string;
  preClassName?: string;
  stickyHeaderClassName?: string;
}) {
  return (
    <div
      className="bg-token-text-code-block-background border-token-input-background relative overflow-clip rounded-lg border contain-inline-size dark"
      data-theme="dark"
    >
      <div
        className={cn(
          "sticky top-0 z-10 flex items-center justify-between py-1 ps-2 pe-2 font-sans text-sm text-token-description-foreground select-none",
          stickyHeaderClassName,
        )}
      >
        <div className="min-w-0 truncate">{title}</div>
        <div className="flex items-center">
          {copyText ? (
            <CopyMessageActionButton
              text={copyText}
              label="Copy"
              copiedLabel="Copied"
              tooltipLabel="Copy"
              copiedTooltipLabel="Copied"
              className="enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background"
            />
          ) : null}
        </div>
      </div>
      <div className={cn("text-size-chat max-h-48 overflow-y-auto p-2", bodyClassName)} dir="ltr">
        <pre className={cn("m-0 whitespace-pre-wrap break-words", preClassName)}>{content}</pre>
      </div>
    </div>
  );
}

function McpEmbeddedResourceBlock({
  block,
}: {
  block: Extract<CodexMcpToolCallContentBlock, { type: "embedded_resource" }>;
}) {
  const resource = block.resource;
  const content = resource.text ?? resource.blob ?? "";
  const hasContent = content.length > 0;
  const annotations = formatAnnotations(resource.annotations);

  return (
    <div className="text-size-chat flex flex-col gap-0.5 text-token-description-foreground/80">
      <div className="flex gap-1">
        <span className="font-medium text-token-foreground">URI</span>
        <span className="break-all">{resource.uri}</span>
      </div>
      {resource.mimeType ? (
        <div className="flex gap-1">
          <span className="font-medium text-token-foreground">MIME type</span>
          <span className="break-all">{resource.mimeType}</span>
        </div>
      ) : null}
      {annotations ? (
        <div className="flex gap-1">
          <span className="font-medium text-token-foreground">Annotations</span>
          <span className="break-all">{annotations}</span>
        </div>
      ) : null}
      {hasContent ? (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-token-foreground">Content</span>
          <pre className="max-h-48 overflow-auto rounded-md bg-token-input-background px-3 py-2 whitespace-pre-wrap text-token-description-foreground/80">
            {content}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function McpUnknownBlock({ value }: { value: unknown }) {
  return (
    <pre className="bg-token-input-background text-token-description-foreground/80 max-h-48 overflow-auto whitespace-pre-wrap rounded-md px-3 py-2 text-size-chat">
      {stringifyMcpValue(value, 2)}
    </pre>
  );
}

function McpContentBlock({ block }: { block: CodexMcpToolCallContentBlock }) {
  if (block.type === "text") {
    return (
      <McpCodePanel
        title="plaintext"
        content={appendAnnotations(block.text, block.annotations)}
        preClassName="[&_*]:text-token-foreground/50 text-token-description-foreground/80 m-0 whitespace-pre-wrap break-words font-sans text-size-chat leading-relaxed extension:leading-normal"
      />
    );
  }

  if (block.type === "resource_link") {
    const name = block.title ?? block.name ?? block.uri;
    const annotations = formatAnnotations(block.annotations);

    return (
      <div className="text-size-chat flex flex-col gap-0.5">
        <div className="break-words text-token-description-foreground/80">Read {name}</div>
        {annotations ? (
          <div className="break-words whitespace-pre-wrap text-token-description-foreground/80">
            Annotations: {annotations}
          </div>
        ) : null}
      </div>
    );
  }

  if (block.type === "embedded_resource") {
    return <McpEmbeddedResourceBlock block={block} />;
  }

  if (block.type === "image") {
    const annotations = formatAnnotations(block.annotations);

    return (
      <div className="flex flex-col gap-0.5">
        <img
          className="max-h-48 w-max max-w-full rounded-md object-contain"
          src={`data:${block.mimeType};base64,${block.data}`}
          alt=""
        />
        {annotations ? (
          <p className="text-size-chat whitespace-pre-wrap text-token-description-foreground/80">
            Annotations: {annotations}
          </p>
        ) : null}
      </div>
    );
  }

  if (block.type === "audio") {
    const annotations = formatAnnotations(block.annotations);

    return (
      <div className="flex flex-col gap-0.5">
        <audio className="w-full" controls src={`data:${block.mimeType};base64,${block.data}`} preload="metadata" />
        {annotations ? (
          <p className="text-size-chat whitespace-pre-wrap text-token-description-foreground/80">
            Annotations: {annotations}
          </p>
        ) : null}
      </div>
    );
  }

  return <McpUnknownBlock value={block.raw} />;
}

function McpRawOutputDialog({
  open,
  onOpenChange,
  server,
  tool,
  rawOutput,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: string;
  tool: string;
  rawOutput: string;
}) {
  const dialogId = useId();
  const contentRef = useRef<HTMLDivElement | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <NodexTooltip
        tooltipContent="Show raw tool call output"
        side="top"
        delayDuration={0}
      >
        <button
          type="button"
          className={cn(
            "border-token-border user-select-none no-drag cursor-interaction flex items-center gap-1 border focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-full electron:rounded-md text-token-description-foreground enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border-transparent electron:p-1 justify-center p-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100",
            electronToolIconSizeClassName,
          )}
          aria-label="Show raw tool call output"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={dialogId}
          data-state={open ? "open" : "closed"}
          onClick={() => {
            onOpenChange(true);
          }}
        >
          <CodeBracketsIcon />
        </button>
      </NodexTooltip>
      <DialogContent
        id={dialogId}
        ref={contentRef}
        tabIndex={-1}
        showCloseButton={false}
        aria-describedby={undefined}
        className="codex-dialog fixed left-1/2 top-1/2 z-50 w-[520px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 gap-0 rounded-3xl border-none bg-token-dropdown-background/90 p-0 text-token-foreground shadow-lg ring-[0.5px] ring-token-border backdrop-blur-xl outline-none sm:max-w-[520px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        <div>
          <div className="flex flex-col gap-0 px-5 py-5 text-base leading-normal tracking-normal">
            <div className="flex w-full flex-col pt-3 first:pt-0">
              <div className="flex flex-col items-start gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1 self-stretch">
                  <DialogHeader className="gap-0 text-left">
                    <DialogTitle className="heading-dialog min-w-0 font-semibold">
                      Raw {server}.{tool} tool call output
                    </DialogTitle>
                  </DialogHeader>
                </div>
              </div>
            </div>
            <div className="flex w-full flex-col pt-3 first:pt-0">
              <McpCodePanel
                title="json"
                content={rawOutput}
                copyText={rawOutput}
                bodyClassName="max-h-128 overflow-auto p-2"
                stickyHeaderClassName="rounded-t-lg"
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function McpResultBody({
  payload,
  threadId,
  rawOutput,
  resource,
  resourceError,
  rawDialogOpen,
  onRawDialogOpenChange,
  onOpenMcpAppSidePanel,
}: {
  payload: CodexMcpToolCallView;
  threadId: string;
  rawOutput: string;
  resource: McpRenderableResource | null;
  resourceError: string | null;
  rawDialogOpen: boolean;
  onRawDialogOpenChange: (open: boolean) => void;
  onOpenMcpAppSidePanel?: ThreadStageActions["onOpenMcpAppSidePanel"];
}) {
  const result = payload.result;
  const successContent = result?.type === "success"
    ? result.content.filter((block) => !shouldHideDuplicateMcpTextContent(block, resource))
    : [];
  const errorText = result?.type === "error" ? result.error : null;
  const structuredContent = result?.type === "success" && result.structuredContent != null
    ? stringifyMcpValue(result.structuredContent, 2)
    : null;

  return (
    <>
      {resource ? (
        <McpCapabilityViewFrame resource={resource} />
      ) : null}
      {resourceError ? (
        <ToolErrorDetail error={resourceError} showLabel={false} />
      ) : null}
      {successContent.length > 0 ? (
        <div className="[&_*]:text-token-foreground/50 flex flex-col gap-0.5">
          {successContent.map((block, index) => (
            <McpContentBlock key={index} block={block} />
          ))}
        </div>
      ) : errorText ? (
        <ToolErrorDetail error={errorText} showLabel={false} />
      ) : resource ? null : (
        <p className="text-token-description-foreground/80">Tool returned no content</p>
      )}
      {structuredContent ? (
        <McpCodePanel
          title="json"
          content={structuredContent}
          preClassName="font-vscode-editor text-size-chat text-token-description-foreground/80"
        />
      ) : null}
      <div className="inline-flex w-fit items-center gap-1">
        {resource && onOpenMcpAppSidePanel ? (
          <NodexTooltip
            tooltipContent="Open app in side panel"
            side="top"
            delayDuration={0}
          >
            <button
              type="button"
              className={cn(
                "border-token-border user-select-none no-drag cursor-interaction flex items-center gap-1 border focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-full electron:rounded-md text-token-description-foreground enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border-transparent electron:p-1 justify-center p-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100",
                electronToolIconSizeClassName,
              )}
              aria-label="Open MCP app in side panel"
              onClick={() => {
                void onOpenMcpAppSidePanel(buildMcpAppSidePanelInput({ threadId, payload, resource }));
              }}
            >
              <CodexPanelRightVisibleIcon />
            </button>
          </NodexTooltip>
        ) : null}
        <McpRawOutputDialog
          open={rawDialogOpen}
          onOpenChange={onRawDialogOpenChange}
          server={payload.invocation.server}
          tool={payload.invocation.tool}
          rawOutput={rawOutput}
        />
      </div>
    </>
  );
}

function useControllableBoolean(
  value: boolean | undefined,
  onChange: ((nextValue: boolean) => void) | undefined,
): [boolean, (nextValue: boolean) => void] {
  const [internalValue, setInternalValue] = useState(Boolean(value));

  useEffect(() => {
    if (value === undefined) return;
    setInternalValue(value);
  }, [value]);

  const resolvedValue = value ?? internalValue;

  return [
    resolvedValue,
    (nextValue) => {
      if (value === undefined) {
        setInternalValue(nextValue);
      }
      onChange?.(nextValue);
    },
  ];
}

export function McpToolCall({
  item,
  rawDialogOpen,
  onRawDialogOpenChange,
  onOpenMcpAppSidePanel,
}: McpToolCallProps) {
  const bodyId = useId();
  const payload = item.mcpToolCall ?? null;
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRawDialogOpen, setIsRawDialogOpen] = useControllableBoolean(rawDialogOpen, onRawDialogOpenChange);
  const [serverStatuses, setServerStatuses] = useState<ProtocolMcpServerStatus[]>([]);
  const [resourceResponse, setResourceResponse] = useState<ProtocolMcpResourceReadResponse | null>(null);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const { elementHeightPx, elementRef } = useMeasuredElementHeight();

  const resourceUri = useMemo(
    () => payload ? resolveMcpAppResourceUri({ payload, serverStatuses }) : null,
    [payload, serverStatuses],
  );
  const renderableResource = useMemo(
    () => resourceUri ? resolveMcpRenderableResource(resourceUri, resourceResponse) : null,
    [resourceResponse, resourceUri],
  );
  const rawOutput = payload
    ? stringifyMcpValue({
        callId: payload.callId,
        pluginId: payload.pluginId,
        mcpAppResourceUri: payload.mcpAppResourceUri,
        invocation: payload.invocation,
        durationMs: payload.durationMs,
        result: payload.result,
      }, 2)
    : "";
  const summary = payload ? resolveMcpToolCallLabel(payload) : { leading: "", trailing: "" };

  useEffect(() => {
    if (!payload) return undefined;
    let disposed = false;
    void invoke("codex:mcp-server-statuses:list", item.threadId)
      .then((result) => {
        if (disposed) return;
        setServerStatuses(Array.isArray(result) ? result as ProtocolMcpServerStatus[] : []);
      })
      .catch(() => {
        if (!disposed) setServerStatuses([]);
      });
    return () => {
      disposed = true;
    };
  }, [item.threadId, payload]);

  useEffect(() => {
    setResourceResponse(null);
    setResourceError(null);
    if (!payload || !resourceUri) return undefined;

    let disposed = false;
    void invoke("codex:mcp-resource:read", {
      threadId: item.threadId,
      server: payload.invocation.server,
      uri: resourceUri,
    })
      .then((result) => {
        if (disposed) return;
        setResourceResponse(result as ProtocolMcpResourceReadResponse);
      })
      .catch((error) => {
        if (disposed) return;
        setResourceError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      disposed = true;
    };
  }, [item.threadId, payload, resourceUri]);

  if (!payload) return null;

  return (
    <div className="min-w-0 text-size-chat relative overflow-visible py-0">
      <div className="group flex flex-col">
        <button
          type="button"
          className={cn(
            "group/summary flex w-full items-center gap-1.5 text-left",
            payload.completed ? "cursor-interaction" : "cursor-default",
          )}
          aria-expanded={payload.completed ? isExpanded : false}
          aria-controls={bodyId}
          onClick={() => {
            if (!payload.completed) return;
            setIsExpanded(!isExpanded);
          }}
        >
          <ToolActivityIcon descriptor={resolveMcpSourceIcon(item)} />
          <CodexShimmerText
            active={!payload.completed}
            className="text-size-chat flex min-w-0 items-center gap-1"
          >
            <span className="text-token-description-foreground/90 group-hover:text-token-foreground flex-shrink-0">
              {summary.leading}
            </span>
            <span className="text-token-foreground/40 group-hover:text-token-foreground truncate">
              {summary.trailing}
            </span>
          </CodexShimmerText>
          {payload.completed ? (
            <ChevronRightIcon
              className={cn(
                "text-token-input-placeholder-foreground flex-shrink-0 transition-all duration-300 opacity-0 group-hover/summary:opacity-100",
                isExpanded && "opacity-100 rotate-90",
              )}
            />
          ) : null}
        </button>
        <motion.div
          initial={false}
          animate={{
            height: isExpanded ? elementHeightPx : 0,
            opacity: isExpanded ? 1 : 0,
          }}
          transition={CODEX_THREAD_ACCORDION_TRANSITION}
          className={cn(isExpanded ? "overflow-visible" : "overflow-hidden")}
          data-thread-find-skip={isExpanded ? undefined : true}
          style={{
            pointerEvents: isExpanded ? "auto" : "none",
          }}
        >
          <div ref={elementRef} className="flex flex-col gap-0.5 pt-1">
            <div id={bodyId}>
              <McpResultBody
                payload={payload}
                threadId={item.threadId}
                rawOutput={rawOutput}
                resource={renderableResource}
                resourceError={resourceError}
                rawDialogOpen={isRawDialogOpen}
                onRawDialogOpenChange={setIsRawDialogOpen}
                onOpenMcpAppSidePanel={onOpenMcpAppSidePanel}
              />
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
