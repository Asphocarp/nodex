import { motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CodeBracketsIcon, CodexPanelRightVisibleIcon } from "@/components/shared/icons";
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
  ProtocolMcpServerStatus,
} from "../../../../../lib/types";
import type { ThreadMcpAppSidePanelInput, ThreadStageActions } from "../../../thread-stage-types";
import { useMcpResource, useMcpServerStatuses } from "../../../../../lib/use-mcp-queries";
import { cn } from "../../../../../lib/utils";
import { CODEX_THREAD_ACCORDION_TRANSITION } from "../thread-motion";
import { useMeasuredElementHeight } from "../use-measured-element-height";
import { CopyMessageActionButton } from "../thread-message-actions";
import { CodexShimmerText } from "../codex-shimmer-text";
import { AutomaticApprovalReviewRows, AutomaticApprovalReviewShield } from "../automatic-approval-review-surface";
import { ThreadActivityHeader, ThreadActivityShell, ToolErrorDetail } from "./tool-primitives";
import {
  asRecord,
} from "./tool-call-utils";
import { ToolActivityIcon, resolveMcpSourceIcon } from "./tool-call-icons";
import { formatMcpServerName, resolveMcpToolDisplayName } from "./mcp-tool-call-labels";
import { McpCapabilityViewFrame } from "./mcp-capability-view-frame";
import {
  isMcpAppHtmlTooLarge,
  resolveMcpAppFrameHeight,
  resolveMcpAppResourceUri,
  resolveMcpAppResourceScopeUri,
  resolveMcpExpandedSuccessDisplay,
  resolveMcpRenderableResource,
  shouldHideDuplicateMcpTextContent,
  shouldShowMcpStructuredContent,
  stringifyMcpValue,
  type McpRenderableResource,
} from "./mcp-tool-call-resource-utils";

const electronToolIconSizeClassName = `electron:[&>svg]:${"icon-sm"}`;
const EMPTY_MCP_SERVER_STATUSES: readonly ProtocolMcpServerStatus[] = [];

interface McpToolCallProps {
  automaticApprovalReviews?: CodexTranscriptEntry[];
  item: CodexTranscriptEntry;
  rawDialogOpen?: boolean;
  onRawDialogOpenChange?: (open: boolean) => void;
  onOpenMcpAppSidePanel?: ThreadStageActions["onOpenMcpAppSidePanel"];
}

export function buildMcpAppSidePanelInput(input: {
  threadId: string;
  payload: CodexMcpToolCallView;
  resource: McpRenderableResource;
}): ThreadMcpAppSidePanelInput {
  const server = input.payload.invocation.server;
  const tool = input.payload.invocation.tool;
  const title = `${formatMcpServerName(tool)} - ${formatMcpServerName(server)}`;

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

function formatAnnotations(annotations: unknown): string | null {
  const candidate = asRecord(annotations);
  if (!candidate) return null;

  const parts: string[] = [];
  const audience = candidate.audience;
  if (Array.isArray(audience) && audience.length > 0) {
    parts.push(`audience=${audience.join(", ")}`);
  }
  if (candidate.priority != null) {
    parts.push(`priority=${String(candidate.priority)}`);
  }
  if (candidate.lastModified != null) {
    parts.push(`lastModified=${String(candidate.lastModified)}`);
  }

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
    <pre className="[&_*]:text-token-non-assistant-body-descendant bg-token-input-background text-token-description-foreground/80 max-h-48 overflow-auto whitespace-pre-wrap rounded-md px-3 py-2 text-size-chat">
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
        preClassName="[&_*]:text-token-non-assistant-body-descendant text-token-description-foreground/80 m-0 whitespace-pre-wrap break-words font-sans text-size-chat leading-relaxed extension:leading-normal"
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
          className="max-h-48 w-max max-w-full gap-0.5 rounded-md object-contain"
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
        <audio className="w-full gap-0.5" controls src={`data:${block.mimeType};base64,${block.data}`} preload="metadata" />
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

function McpAppLoadingPlaceholder({ resource }: { resource: McpRenderableResource | null }) {
  return (
    <div
      role="status"
      aria-label="Loading MCP app"
      data-mcp-app-loading="true"
      className="loading-shimmer-pure-text w-full overflow-hidden rounded-lg border border-token-border-light bg-token-input-background"
      style={{ height: resolveMcpAppFrameHeight(resource?.metadata) }}
    />
  );
}

function McpAppTooLargeError() {
  return (
    <ToolErrorDetail
      error="Failed to load MCP app: HTML exceeds the maximum supported size."
      showLabel={false}
      className="w-full"
    />
  );
}

function McpResultBody({
  payload,
  threadId,
  rawOutput,
  resourceUri,
  hasResourceScope,
  resource,
  resourceLoading,
  resourceError,
  rawDialogOpen,
  onRawDialogOpenChange,
  onOpenMcpAppSidePanel,
}: {
  payload: CodexMcpToolCallView;
  threadId: string;
  rawOutput: string;
  resourceUri: string | null;
  hasResourceScope: boolean;
  resource: McpRenderableResource | null;
  resourceLoading: boolean;
  resourceError: string | null;
  rawDialogOpen: boolean;
  onRawDialogOpenChange: (open: boolean) => void;
  onOpenMcpAppSidePanel?: ThreadStageActions["onOpenMcpAppSidePanel"];
}) {
  const result = payload.result;
  const successResult = result?.type === "success" ? result : null;
  const errorText = result?.type === "error" ? result.error : null;
  const structuredContentJson = successResult?.structuredContent != null
    ? stringifyMcpValue(successResult.structuredContent, 2)
    : null;
  const shouldRenderMcpApp = Boolean(resourceUri) && (!payload.completed || successResult !== null);
  const hasMcpAppBranch = shouldRenderMcpApp && (resourceLoading || Boolean(resourceError) || resource !== null);
  const isMcpAppLoading = shouldRenderMcpApp && resourceLoading && resource === null && !resourceError;
  const mcpAppError = shouldRenderMcpApp && resourceError && resource === null
    ? `Failed to load MCP app: ${resourceError}`
    : null;
  const { displayContent, displayStructuredContentJson } = successResult
    ? resolveMcpExpandedSuccessDisplay({
        content: successResult.content.filter((block) => !shouldHideDuplicateMcpTextContent(block, resource)),
        structuredContentJson,
        isExpanded: true,
      })
    : {
        displayContent: [],
        displayStructuredContentJson: null,
      };
  const shouldShowStructuredContent = shouldShowMcpStructuredContent({
    structuredContentJson: displayStructuredContentJson,
    hasMcpAppBranch,
    hasResourceScope,
  });
  const shouldShowRawDialog = !isMcpAppLoading;

  const appBody = isMcpAppLoading ? (
    <McpAppLoadingPlaceholder resource={resource} />
  ) : mcpAppError ? (
    <ToolErrorDetail error={mcpAppError} showLabel={false} />
  ) : resource && isMcpAppHtmlTooLarge(resource) ? (
    <McpAppTooLargeError />
  ) : resource ? (
    <McpCapabilityViewFrame resource={resource} />
  ) : null;

  return (
    <>
      {hasMcpAppBranch ? appBody : null}
      {!hasMcpAppBranch && displayContent.length > 0 ? (
        <div className="[&_*]:text-token-foreground/50 flex flex-col gap-0.5">
          {displayContent.map((block, index) => (
            <McpContentBlock key={index} block={block} />
          ))}
        </div>
      ) : !hasMcpAppBranch && errorText ? (
        <ToolErrorDetail error={errorText} showLabel={false} />
      ) : !hasMcpAppBranch && !displayStructuredContentJson ? (
        <p className="text-token-description-foreground/80">Tool returned no content</p>
      ) : null}
      {shouldShowStructuredContent && displayStructuredContentJson ? (
        <McpCodePanel
          title="json"
          content={displayStructuredContentJson}
          preClassName="font-vscode-editor text-size-chat text-token-description-foreground/80"
        />
      ) : null}
      {shouldShowRawDialog ? (
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
      ) : null}
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
  automaticApprovalReviews = [],
  item,
  rawDialogOpen,
  onRawDialogOpenChange,
  onOpenMcpAppSidePanel,
}: McpToolCallProps) {
  const bodyId = useId();
  const payload = item.mcpToolCall ?? null;
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRawDialogOpen, setIsRawDialogOpen] = useControllableBoolean(rawDialogOpen, onRawDialogOpenChange);
  const { elementHeightPx, elementRef } = useMeasuredElementHeight();
  const hasSuccessfulResult = payload?.result?.type === "success";
  const { data: statusData } = useMcpServerStatuses(item.threadId, {
    enabled: Boolean(payload && hasSuccessfulResult),
  });
  const serverStatuses = Array.isArray(statusData) ? statusData : EMPTY_MCP_SERVER_STATUSES;

  const resourceUri = useMemo(
    () => payload ? resolveMcpAppResourceUri({ payload, serverStatuses }) : null,
    [payload, serverStatuses],
  );
  const resourceScopeUri = useMemo(
    () => payload ? resolveMcpAppResourceScopeUri({ payload, serverStatuses }) : null,
    [payload, serverStatuses],
  );
  const resourceParams = useMemo(() => (
    payload && resourceUri
      ? {
        threadId: item.threadId,
        server: payload.invocation.server,
        uri: resourceUri,
      }
      : null
  ), [item.threadId, payload, resourceUri]);
  const {
    data: resourceResponse = null,
    error: resourceQueryError,
    isLoading: resourceLoading,
  } = useMcpResource(resourceParams);
  const resourceError = resourceQueryError
    ? resourceQueryError instanceof Error ? resourceQueryError.message : String(resourceQueryError)
    : null;
  const renderableResource = useMemo(
    () => resourceUri ? resolveMcpRenderableResource(resourceUri, resourceResponse) : null,
    [resourceResponse, resourceUri],
  );
  const isMcpAppReviewCardMode = Boolean(
    resourceUri
    && (!payload?.completed || hasSuccessfulResult)
    && (resourceLoading || resourceError || renderableResource),
  );
  const rawOutput = payload
    ? stringifyMcpValue({
        callId: payload.callId,
        invocation: payload.invocation,
        durationMs: payload.durationMs,
        result: payload.result,
      }, 2)
    : "";
  const summary = payload ? resolveMcpToolDisplayName(payload) : "";
  const hasApprovalReviews = automaticApprovalReviews.length > 0;

  if (!payload) return null;

  const canExpand = payload.completed || payload.result !== null;
  const isBodyExpanded = canExpand && isExpanded;
  const header = (
    <ThreadActivityHeader
      accessory={hasApprovalReviews ? <AutomaticApprovalReviewShield /> : null}
      disclosure={canExpand
        ? {
            expanded: isBodyExpanded,
            onToggle: () => {
              setIsExpanded((current) => !current);
            },
          }
        : undefined}
    >
      <ToolActivityIcon descriptor={resolveMcpSourceIcon(item)} />
      <CodexShimmerText
        active={!payload.completed}
        className="text-token-conversation-summary-leading group-hover/activity-header:text-token-foreground text-size-chat min-w-0 shrink truncate"
      >
        {summary}
      </CodexShimmerText>
    </ThreadActivityHeader>
  );
  const body = canExpand ? (
    <motion.div
      initial={false}
      animate={{
        height: isBodyExpanded ? elementHeightPx : 0,
        opacity: isBodyExpanded ? 1 : 0,
      }}
      transition={CODEX_THREAD_ACCORDION_TRANSITION}
      className={cn(isBodyExpanded ? "overflow-visible" : "overflow-hidden")}
      data-thread-find-skip={isBodyExpanded ? undefined : true}
      style={{
        pointerEvents: isBodyExpanded ? "auto" : "none",
      }}
    >
      <div ref={isBodyExpanded ? elementRef : null} className="flex flex-col gap-0.5 pt-1">
        {isBodyExpanded ? (
          <>
            {hasApprovalReviews ? (
              <AutomaticApprovalReviewRows
                className={isMcpAppReviewCardMode ? "px-4" : undefined}
                isExpandable={!isMcpAppReviewCardMode}
                items={automaticApprovalReviews}
              />
            ) : null}
            <div id={bodyId}>
              <McpResultBody
                payload={payload}
                threadId={item.threadId}
                rawOutput={rawOutput}
                resourceUri={resourceUri}
                hasResourceScope={resourceScopeUri !== null}
                resource={renderableResource}
                resourceLoading={resourceLoading}
                resourceError={resourceError}
                rawDialogOpen={isRawDialogOpen}
                onRawDialogOpenChange={setIsRawDialogOpen}
                onOpenMcpAppSidePanel={onOpenMcpAppSidePanel}
              />
            </div>
          </>
        ) : null}
      </div>
    </motion.div>
  ) : null;

  return (
    <ThreadActivityShell
      body={body}
      className="group"
      header={header}
    />
  );
}
