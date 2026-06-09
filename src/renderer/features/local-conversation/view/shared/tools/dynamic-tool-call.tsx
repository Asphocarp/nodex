import { motion } from "motion/react";
import { useId, useState } from "react";
import { ChevronRightIcon } from "@/components/shared/icons";
import type { CodexDynamicToolCallView } from "../../../../../lib/types";
import { cn } from "../../../../../lib/utils";
import { CODEX_THREAD_ACCORDION_TRANSITION } from "../thread-motion";
import { useMeasuredElementHeight } from "../use-measured-element-height";
import { CodexShimmerText } from "../codex-shimmer-text";
import type { ToolComponentProps } from "./get-tool-component";
import { CodeBlock, JsonBlock, ToolErrorDetail } from "./tool-primitives";
import { ToolActivityIcon, semanticToolIcon } from "./tool-call-icons";
import {
  extractDynamicToolTextContent,
  isLikelyJsonText,
  resolveDynamicToolLabelFromName,
  resolveDynamicToolLeadingLabelFromName,
} from "./dynamic-tool-call-utils";

function parseJsonText(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function DynamicToolOutput({ call }: { call: CodexDynamicToolCallView }) {
  const textContent = extractDynamicToolTextContent(call);
  const imageItems = (call.contentItems ?? []).filter((item) => item.type === "inputImage");

  if (call.success === false) {
    return <ToolErrorDetail error="Dynamic tool call failed" showLabel={false} />;
  }

  if (textContent.length === 0 && imageItems.length === 0) {
    return <p className="text-token-description-foreground/80">Tool returned no content</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {textContent.map((text, index) => (
        isLikelyJsonText(text)
          ? <JsonBlock key={index} value={parseJsonText(text)} />
          : <CodeBlock key={index}>{text}</CodeBlock>
      ))}
      {imageItems.map((item, index) => (
        <img
          key={index}
          src={item.imageUrl}
          alt=""
          className="max-h-48 w-max max-w-full rounded-md object-contain"
        />
      ))}
    </div>
  );
}

export function DynamicToolCall({ item }: ToolComponentProps) {
  const bodyId = useId();
  const call = item.dynamicToolCall ?? null;
  const [isExpanded, setIsExpanded] = useState(false);
  const { elementHeightPx, elementRef } = useMeasuredElementHeight();

  if (!call) return null;

  const label = resolveDynamicToolLabelFromName(call.tool);
  const leadingLabel = resolveDynamicToolLeadingLabelFromName(call.tool, call.completed);
  const trailingLabel = label.startsWith(leadingLabel)
    ? label.slice(leadingLabel.length).replace(/^[:\s-]+/, "").trim()
    : label;
  const hasBody = call.completed || call.contentItems !== null || call.arguments !== null;

  return (
    <div className="min-w-0 text-size-chat relative overflow-visible py-0">
      <div className="group flex flex-col">
        <button
          type="button"
          className={cn(
            "group/summary flex w-full items-center gap-1.5 text-left",
            hasBody ? "cursor-interaction" : "cursor-default",
          )}
          aria-expanded={hasBody ? isExpanded : false}
          aria-controls={bodyId}
          onClick={() => {
            if (!hasBody) return;
            setIsExpanded((value) => !value);
          }}
        >
          <ToolActivityIcon descriptor={semanticToolIcon(call.namespace === "codex_app" ? "plugin" : "connector")} />
          <CodexShimmerText
            active={!call.completed}
            className="text-size-chat flex min-w-0 items-center gap-1"
          >
            <span className="text-token-description-foreground/90 group-hover:text-token-foreground flex-shrink-0">
              {leadingLabel}
            </span>
            {trailingLabel ? (
              <span className="text-token-foreground/40 group-hover:text-token-foreground truncate">
                {trailingLabel}
              </span>
            ) : null}
          </CodexShimmerText>
          {hasBody ? (
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
          <div ref={elementRef} className="-mx-2.5 mt-1 flex flex-col gap-1 text-token-conversation-body">
            <div id={bodyId} className="rounded-none border-0 px-2.5">
              <DynamicToolOutput call={call} />
              <details className="mt-1 text-token-description-foreground/80">
                <summary className="cursor-interaction select-none">Arguments</summary>
                <div className="mt-1">
                  <JsonBlock value={call.arguments} />
                </div>
              </details>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
