import { motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronRightIcon, CodeBracketsIcon } from "@/components/shared/icons";
import {
  NodexDialog as Dialog,
  NodexDialogContent as DialogContent,
  NodexDialogHeader as DialogHeader,
  NodexDialogTitle as DialogTitle,
} from "../../../../../components/ui/dialog";
import { NodexTooltip } from "../../../../../components/ui/tooltip";
import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { cn } from "../../../../../lib/utils";
import { CODEX_MEASURED_TRANSITION, useMeasuredElementHeight } from "../use-measured-element-height";
import { CopyMessageActionButton } from "../thread-message-actions";
import { ToolErrorDetail } from "./tool-primitives";
import {
  asRecord,
  getNumber,
  getString,
  humanizeIdentifier,
} from "./tool-call-utils";

const electronToolIconSizeClassName = `electron:[&>svg]:${"icon-sm"}`;

interface McpToolCallProps {
  item: CodexTranscriptEntry;
  rawDialogOpen?: boolean;
  onRawDialogOpenChange?: (open: boolean) => void;
}

interface McpInvocation {
  server: string;
  tool: string;
  arguments?: unknown;
}

interface McpResultPayload {
  type?: string;
  content?: unknown[];
  structuredContent?: unknown;
  error?: string;
  raw?: unknown;
}

interface McpPayload {
  callId?: string;
  durationMs?: number;
  invocation: McpInvocation;
  result?: McpResultPayload;
  completed: boolean;
}

function formatServerName(server: string): string {
  const humanized = humanizeIdentifier(server);
  if (humanized.length === 0) return "MCP";
  return `${humanized} MCP`;
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

function normalizeResult(
  rawResult: unknown,
  fallbackResult: unknown,
  fallbackError: string | undefined,
): McpResultPayload | undefined {
  const rawResultRecord = asRecord(rawResult);
  if (rawResultRecord) {
    return {
      type: getString(rawResultRecord, "type"),
      content: Array.isArray(rawResultRecord.content) ? rawResultRecord.content : undefined,
      structuredContent: rawResultRecord.structuredContent,
      error: getString(rawResultRecord, "error") ?? fallbackError,
      raw: rawResultRecord.raw,
    };
  }

  const fallbackResultRecord = asRecord(fallbackResult);
  if (fallbackResultRecord && (
    typeof fallbackResultRecord.type === "string"
    || Array.isArray(fallbackResultRecord.content)
    || Object.prototype.hasOwnProperty.call(fallbackResultRecord, "structuredContent")
    || Object.prototype.hasOwnProperty.call(fallbackResultRecord, "raw")
  )) {
    return {
      type: getString(fallbackResultRecord, "type"),
      content: Array.isArray(fallbackResultRecord.content) ? fallbackResultRecord.content : undefined,
      structuredContent: fallbackResultRecord.structuredContent,
      error: getString(fallbackResultRecord, "error") ?? fallbackError,
      raw: fallbackResultRecord.raw,
    };
  }

  if (fallbackError) {
    return {
      type: "error",
      error: fallbackError,
    };
  }

  if (typeof fallbackResult === "string" && fallbackResult.trim().length > 0) {
    return {
      type: "success",
      content: [{ type: "text", text: fallbackResult }],
    };
  }

  if (fallbackResult !== undefined) {
    return {
      type: "success",
      structuredContent: fallbackResult,
    };
  }

  return undefined;
}

function normalizePayload(item: CodexTranscriptEntry): McpPayload {
  const rawItem = asRecord(item.rawItem);
  const rawInvocation = asRecord(rawItem?.invocation);
  const tool = item.toolCall;
  const completed = item.status !== "inProgress";

  const server = getString(rawInvocation, "server") ?? tool?.server ?? "";
  const invokedTool = getString(rawInvocation, "tool") ?? tool?.toolName ?? "";
  const args = rawInvocation?.arguments ?? tool?.args;
  const result = normalizeResult(rawItem?.result, tool?.result, tool?.error);

  return {
    callId: getString(rawItem, "callId"),
    durationMs: getNumber(rawItem, "durationMs"),
    invocation: {
      server,
      tool: invokedTool,
      arguments: args,
    },
    result,
    completed,
  };
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

function McpEmbeddedResourceBlock({ block }: { block: Record<string, unknown> }) {
  const resource = asRecord(block.resource);
  const content = getString(resource, "text") ?? getString(resource, "blob") ?? "";
  const hasContent = content.length > 0;
  const annotations = formatAnnotations(resource?.annotations);

  return (
    <div className="text-size-chat flex flex-col gap-0.5 text-token-description-foreground/80">
      <div className="flex gap-1">
        <span className="font-medium text-token-foreground">URI</span>
        <span className="break-all">{getString(resource, "uri") ?? ""}</span>
      </div>
      {getString(resource, "mimeType") ? (
        <div className="flex gap-1">
          <span className="font-medium text-token-foreground">MIME type</span>
          <span className="break-all">{getString(resource, "mimeType")}</span>
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

function McpContentBlock({ block }: { block: unknown }) {
  const candidate = asRecord(block);
  if (!candidate) return <McpUnknownBlock value={block} />;

  const type = getString(candidate, "type");
  if (type === "text") {
    const text = getString(candidate, "text") ?? "";
    return (
      <McpCodePanel
        title="plaintext"
        content={appendAnnotations(text, candidate.annotations)}
        preClassName="[&_*]:text-token-foreground/50 text-token-description-foreground/80 m-0 whitespace-pre-wrap break-words font-sans text-size-chat leading-relaxed extension:leading-normal"
      />
    );
  }

  if (type === "resource_link") {
    const name = getString(candidate, "title") ?? getString(candidate, "name") ?? getString(candidate, "uri") ?? "";
    const annotations = formatAnnotations(candidate.annotations);

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

  if (type === "embedded_resource") {
    return <McpEmbeddedResourceBlock block={candidate} />;
  }

  if (type === "image") {
    const mimeType = getString(candidate, "mimeType") ?? "image/png";
    const data = getString(candidate, "data") ?? "";
    const annotations = formatAnnotations(candidate.annotations);

    return (
      <div className="flex flex-col gap-0.5">
        <img
          className="max-h-48 w-max max-w-full rounded-md object-contain"
          src={`data:${mimeType};base64,${data}`}
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

  if (type === "audio") {
    const mimeType = getString(candidate, "mimeType") ?? "audio/wav";
    const data = getString(candidate, "data") ?? "";
    const annotations = formatAnnotations(candidate.annotations);

    return (
      <div className="flex flex-col gap-0.5">
        <audio className="w-full" controls src={`data:${mimeType};base64,${data}`} preload="metadata" />
        {annotations ? (
          <p className="text-size-chat whitespace-pre-wrap text-token-description-foreground/80">
            Annotations: {annotations}
          </p>
        ) : null}
      </div>
    );
  }

  return <McpUnknownBlock value={candidate.raw ?? block} />;
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
  rawOutput,
  rawDialogOpen,
  onRawDialogOpenChange,
}: {
  payload: McpPayload;
  rawOutput: string;
  rawDialogOpen: boolean;
  onRawDialogOpenChange: (open: boolean) => void;
}) {
  const result = payload.result;
  const successContent = result?.type === "success" ? result.content ?? [] : [];
  const errorText = result?.type === "error" ? result.error : null;
  const structuredContent = result?.type === "success" && result.structuredContent != null
    ? stringifyMcpValue(result.structuredContent, 2)
    : null;

  return (
    <>
      {successContent.length > 0 ? (
        <div className="[&_*]:text-token-foreground/50 flex flex-col gap-0.5">
          {successContent.map((block, index) => (
            <McpContentBlock key={index} block={block} />
          ))}
        </div>
      ) : errorText ? (
        <ToolErrorDetail error={errorText} showLabel={false} />
      ) : (
        <p className="text-token-description-foreground/80">Tool returned no content</p>
      )}
      {structuredContent ? (
        <McpCodePanel
          title="json"
          content={structuredContent}
          preClassName="font-vscode-editor text-size-chat text-token-description-foreground/80"
        />
      ) : null}
      <div className="inline-flex w-fit">
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
}: McpToolCallProps) {
  const bodyId = useId();
  const payload = useMemo(() => normalizePayload(item), [item]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRawDialogOpen, setIsRawDialogOpen] = useControllableBoolean(rawDialogOpen, onRawDialogOpenChange);
  const { elementHeightPx, elementRef } = useMeasuredElementHeight();

  const toolName = humanizeIdentifier(payload.invocation.tool);
  const serverName = formatServerName(payload.invocation.server);
  const rawOutput = useMemo(() => stringifyMcpValue({
    callId: payload.callId,
    invocation: payload.invocation,
    durationMs: payload.durationMs,
    result: payload.result,
  }, 2), [payload]);

  const summaryVerb = payload.completed ? "Called" : "Calling";
  const summaryDetail = `${toolName} tool from ${serverName}`;

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
          <span className={cn("text-size-chat flex min-w-0 items-center gap-1", !payload.completed && "loading-shimmer-pure-text")}>
            <span className="text-token-description-foreground/90 group-hover:text-token-foreground flex-shrink-0">
              {summaryVerb}
            </span>
            <span className="text-token-foreground/40 group-hover:text-token-foreground truncate">
              {summaryDetail}
            </span>
          </span>
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
          transition={CODEX_MEASURED_TRANSITION}
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
                rawOutput={rawOutput}
                rawDialogOpen={isRawDialogOpen}
                onRawDialogOpenChange={setIsRawDialogOpen}
              />
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
