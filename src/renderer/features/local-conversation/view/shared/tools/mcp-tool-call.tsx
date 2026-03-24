import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../../../components/ui/dialog";
import { Tooltip } from "../../../../../components/ui/tooltip";
import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { cn } from "../../../../../lib/utils";
import { MeasuredExpand } from "../measured-expand";
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
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
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

function ChevronRightIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(
        "text-token-input-placeholder-foreground icon-2xs flex-shrink-0 transition-all duration-300 opacity-0 group-hover/summary:opacity-100",
        expanded && "opacity-100 rotate-90",
      )}
      aria-hidden="true"
    >
      <path
        d="M7.52925 3.7793C7.75652 3.55203 8.10803 3.52383 8.36616 3.69434L8.47065 3.7793L14.2207 9.5293C14.4804 9.789 14.4804 10.211 14.2207 10.4707L8.47065 16.2207C8.21095 16.4804 7.78895 16.4804 7.52925 16.2207C7.26955 15.961 7.26955 15.539 7.52925 15.2793L12.8085 10L7.52925 4.7207L7.44429 4.61621C7.27378 4.35808 7.30198 4.00657 7.52925 3.7793Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CodeBracketsIcon() {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 21 21"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="icon-xxs"
      aria-hidden="true"
    >
      <path
        d="M11.9025 5.3302C12.0658 5.06755 12.3961 4.94629 12.6975 5.05774C13.0419 5.1853 13.2176 5.56881 13.09 5.91321L9.75703 14.9132L9.69745 15.0333C9.53415 15.296 9.20387 15.4172 8.90253 15.3058C8.55813 15.1782 8.3824 14.7947 8.50995 14.4503L11.843 5.45032L11.9025 5.3302ZM5.21894 5.35853C5.3974 5.03773 5.8023 4.92241 6.12324 5.10071C6.44404 5.27917 6.55935 5.68407 6.38105 6.00501L4.05976 10.1818L6.38105 14.3585L6.43476 14.4825C6.52764 14.7774 6.4039 15.1067 6.12324 15.2628C5.84224 15.4189 5.49646 15.3503 5.29511 15.1154L5.21894 15.005L2.71894 10.505C2.60736 10.3042 2.60736 10.0594 2.71894 9.85853L5.21894 5.35853ZM15.4768 5.10071C15.7578 4.9446 16.1035 5.01323 16.3049 5.24817L16.381 5.35853L18.881 9.85853C18.9926 10.0594 18.9926 10.3042 18.881 10.505L16.381 15.005C16.2026 15.3258 15.7977 15.4411 15.4768 15.2628C15.156 15.0844 15.0406 14.6795 15.2189 14.3585L17.5393 10.1818L15.2189 6.00501L15.1652 5.88099C15.0723 5.58611 15.1961 5.25684 15.4768 5.10071Z"
        fill="currentColor"
      />
    </svg>
  );
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
      <Tooltip
        content="Show raw tool call output"
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
      </Tooltip>
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
  expanded,
  onExpandedChange,
  rawDialogOpen,
  onRawDialogOpenChange,
}: McpToolCallProps) {
  const bodyId = useId();
  const payload = useMemo(() => normalizePayload(item), [item]);
  const [isExpanded, setIsExpanded] = useControllableBoolean(expanded, onExpandedChange);
  const [isRawDialogOpen, setIsRawDialogOpen] = useControllableBoolean(rawDialogOpen, onRawDialogOpenChange);

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
          {payload.completed ? <ChevronRightIcon expanded={isExpanded} /> : null}
        </button>
        <MeasuredExpand open={isExpanded} className="overflow-hidden" innerClassName="flex flex-col gap-0.5 pt-1">
          <div id={bodyId}>
            <McpResultBody
              payload={payload}
              rawOutput={rawOutput}
              rawDialogOpen={isRawDialogOpen}
              onRawDialogOpenChange={setIsRawDialogOpen}
            />
          </div>
        </MeasuredExpand>
      </div>
    </div>
  );
}
