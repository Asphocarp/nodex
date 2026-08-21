import { useId, useMemo, useState, type ReactNode } from "react";
import { CodeBracketsIcon } from "@/components/shared/icons";
import type { CodexDynamicToolCallView, CodexTranscriptEntry } from "../../../../../lib/types";
import { cn } from "../../../../../lib/utils";
import { buildTextPreview, INLINE_TEXT_PREVIEW_MAX_CHARS } from "../../../../../lib/text-preview";
import type {
  NodexDynamicToolCallPresentation,
  NodexMarkdownChangePreview,
} from "../../../projection/tool-metadata/nodex-dynamic-tool-call-presentation";
import {
  stringifyToolCallValue,
  ToolCallCodePanel,
  ToolCallRawDialog,
} from "./tool-call-inspection";

function parseDynamicToolTextContent(text: string): {
  content: string;
  format: "json" | "plaintext";
} {
  if (text.length > INLINE_TEXT_PREVIEW_MAX_CHARS) {
    return { content: text, format: "plaintext" };
  }

  try {
    return {
      content: stringifyToolCallValue(JSON.parse(text)),
      format: "json",
    };
  } catch {
    return { content: text, format: "plaintext" };
  }
}

function buildDynamicToolRawItem(
  item: CodexTranscriptEntry,
  call: CodexDynamicToolCallView,
): unknown {
  if (item.rawItem) return item.rawItem;

  return {
    type: "dynamicToolCall",
    id: call.callId,
    namespace: call.namespace,
    tool: call.tool,
    arguments: call.arguments,
    status: call.status ?? (call.completed ? "completed" : "inProgress"),
    contentItems: call.contentItems ?? null,
    success: call.success ?? null,
    durationMs: call.durationMs ?? null,
  };
}

function MarkdownChangePreview({
  change,
  compact,
}: {
  change: NodexMarkdownChangePreview;
  compact: boolean;
}) {
  const compactRemovedLines = change.lines.filter((line) => line.kind === "removed").slice(0, 2);
  const compactAddedLines = change.lines.filter((line) => line.kind === "added").slice(0, 2);
  const compactLines =
    compactRemovedLines.length > 0 && compactAddedLines.length > 0
      ? [...compactRemovedLines, ...compactAddedLines]
      : change.lines.filter((line) => line.kind !== "separator").slice(0, 4);
  const visibleLines = compact ? compactLines : change.lines;
  const renderedChangeLineCount = change.lines.filter((line) => line.kind !== "separator").length;
  const visibleChangeLineCount = visibleLines.filter((line) => line.kind !== "separator").length;
  const omittedLineCount =
    change.omittedLineCount + Math.max(0, renderedChangeLineCount - visibleChangeLineCount);
  const stats = [
    change.additions > 0 ? `+${change.additions}` : null,
    change.deletions > 0 ? `−${change.deletions}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" ");

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md bg-token-bg-secondary/40 ring-[0.5px] ring-token-border-light",
        compact && "mt-1.5",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b-[0.5px] border-token-border-light px-2 py-1 text-xs text-token-description-foreground">
        <span className="truncate font-medium">{change.label}</span>
        {stats ? <span className="shrink-0 font-vscode-editor">{stats}</span> : null}
      </div>
      <div className="max-h-64 overflow-auto py-0.5 font-vscode-editor text-xs" dir="ltr">
        {visibleLines.map((line, index) => {
          if (line.kind === "separator") {
            return (
              <div
                key={`${line.kind}-${index}`}
                className="px-2 py-0.5 text-token-description-foreground"
              >
                ··· {line.text} ···
              </div>
            );
          }

          const isAdded = line.kind === "added";
          return (
            <div
              key={`${line.kind}-${index}`}
              className={cn(
                "grid min-w-max grid-cols-[1.5rem_1fr] px-1.5 py-px",
                isAdded
                  ? "bg-[var(--diff-add-line-bg)] text-[color:var(--diff-add)]"
                  : "bg-[var(--diff-remove-line-bg)] text-[color:var(--diff-remove)]",
              )}
            >
              <span className="select-none">{isAdded ? "+" : "−"}</span>
              <span className="whitespace-pre-wrap break-words text-token-foreground/80">
                {line.text || " "}
              </span>
            </div>
          );
        })}
        {visibleLines.length === 0 ? (
          <div className="px-2 py-1 text-token-description-foreground">Empty change content</div>
        ) : null}
        {omittedLineCount > 0 ? (
          <div className="px-2 py-1 text-token-description-foreground">
            {omittedLineCount} more changed {omittedLineCount === 1 ? "line" : "lines"}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DynamicToolOutput({
  call,
  qualifiedName,
}: {
  call: CodexDynamicToolCallView;
  qualifiedName: string;
}) {
  if (!call.contentItems || call.contentItems.length === 0) {
    return (
      <p className="text-size-chat text-token-description-foreground/80">
        {call.completed ? "Tool returned no content" : "Waiting for tool output"}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {call.contentItems.map((contentItem, index) => {
        if (contentItem.type === "inputImage") {
          return (
            <img
              key={`${contentItem.type}-${index}`}
              className="max-h-64 w-max max-w-full rounded-lg object-contain"
              src={contentItem.imageUrl}
              alt={`${qualifiedName} tool output ${index + 1}`}
            />
          );
        }

        if (contentItem.type === "inputAudio") {
          return (
            <audio
              key={`${contentItem.type}-${index}`}
              className="w-full"
              controls
              src={contentItem.audioUrl}
            />
          );
        }

        return (
          <DynamicToolTextOutput
            key={`${contentItem.type}-${index}`}
            text={contentItem.text}
            titlePrefix={
              call.contentItems && call.contentItems.length > 1 ? `Output ${index + 1}` : "Output"
            }
          />
        );
      })}
    </div>
  );
}

function DynamicToolTextOutput({
  text,
  titlePrefix,
}: {
  readonly text: string;
  readonly titlePrefix: string;
}) {
  const parsed = useMemo(() => parseDynamicToolTextContent(text), [text]);

  return (
    <ToolCallCodePanel
      title={`${titlePrefix} · ${parsed.format}`}
      preview={buildTextPreview(parsed.content, INLINE_TEXT_PREVIEW_MAX_CHARS)}
      getCopyText={() => text}
      getFullText={() => parsed.content}
      preClassName={
        parsed.format === "json"
          ? "font-vscode-editor text-size-chat text-token-description-foreground/80"
          : "font-sans text-size-chat leading-relaxed text-token-description-foreground/80"
      }
    />
  );
}

function DynamicToolExpandedDetails({
  item,
  call,
  nodexPresentation,
  qualifiedName,
  bodyId,
}: {
  readonly item: CodexTranscriptEntry;
  readonly call: CodexDynamicToolCallView;
  readonly nodexPresentation: NodexDynamicToolCallPresentation | null;
  readonly qualifiedName: string;
  readonly bodyId: string;
}) {
  const [isRawDialogOpen, setIsRawDialogOpen] = useState(false);
  const argumentsValue = useMemo(() => stringifyToolCallValue(call.arguments), [call.arguments]);
  const statusDetails = [
    call.status ?? (call.completed ? "completed" : "inProgress"),
    call.durationMs === null || call.durationMs === undefined ? null : `${call.durationMs} ms`,
  ].filter((value): value is string => Boolean(value));

  return (
    <div
      id={bodyId}
      className="mt-1.5 ml-1 flex min-w-0 flex-col gap-1.5 border-l-[0.5px] border-token-border-light pl-3"
    >
      <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-token-description-foreground">
        <code className="min-w-0 truncate font-vscode-editor text-token-foreground/80">
          {qualifiedName}
        </code>
        <div className="flex shrink-0 items-center gap-2">
          <span>{statusDetails.join(" · ")}</span>
          <ToolCallRawDialog
            open={isRawDialogOpen}
            onOpenChange={setIsRawDialogOpen}
            title={`Raw ${qualifiedName} tool call`}
            getRawValue={() => buildDynamicToolRawItem(item, call)}
            triggerLabel={`Show raw ${qualifiedName} tool call`}
            triggerKind="text"
          />
        </div>
      </div>
      {nodexPresentation?.markdownChange ? (
        <MarkdownChangePreview change={nodexPresentation.markdownChange} compact={false} />
      ) : null}
      <ToolCallCodePanel
        title="Arguments"
        preview={buildTextPreview(argumentsValue, INLINE_TEXT_PREVIEW_MAX_CHARS)}
        getCopyText={() => argumentsValue}
        getFullText={() => argumentsValue}
        preClassName="font-vscode-editor text-size-chat text-token-description-foreground/80"
      />
      <DynamicToolOutput call={call} qualifiedName={qualifiedName} />
    </div>
  );
}

export function DynamicToolCallInspector({
  item,
  call,
  nodexPresentation,
  children,
}: {
  item: CodexTranscriptEntry;
  call: CodexDynamicToolCallView;
  nodexPresentation: NodexDynamicToolCallPresentation | null;
  children: ReactNode;
}) {
  const bodyId = useId();
  const [isExpanded, setIsExpanded] = useState(false);
  const qualifiedName = call.namespace ? `${call.namespace}.${call.tool}` : call.tool;

  return (
    <div className="group/dynamic-tool min-w-0">
      <div className="flex min-w-0 items-start gap-1.5">
        <div className="min-w-0 flex-1">
          {children}
          {!isExpanded && nodexPresentation?.markdownChange ? (
            <MarkdownChangePreview change={nodexPresentation.markdownChange} compact />
          ) : null}
        </div>
        <button
          type="button"
          aria-label={`${isExpanded ? "Hide" : "Show"} ${qualifiedName} tool call details`}
          aria-expanded={isExpanded}
          aria-controls={bodyId}
          className="no-drag cursor-interaction mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-token-description-foreground hover:bg-token-list-hover-background hover:text-token-foreground focus-visible:ring-1 focus-visible:ring-token-focus-border focus-visible:outline-none"
          onClick={() => {
            setIsExpanded((current) => !current);
          }}
        >
          <CodeBracketsIcon />
          <span>Details</span>
        </button>
      </div>
      {isExpanded ? (
        <DynamicToolExpandedDetails
          item={item}
          call={call}
          nodexPresentation={nodexPresentation}
          qualifiedName={qualifiedName}
          bodyId={bodyId}
        />
      ) : null}
    </div>
  );
}
