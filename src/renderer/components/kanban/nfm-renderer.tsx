import type { ReactNode } from "react";
import { Bot, FileCode2, FileText, Folder, Link2 } from "lucide-react";
import { Streamdown } from "streamdown";
import {
  InlineMarkdownCode,
  INLINE_MARKDOWN_HEADING_CLASS_NAME,
  MARKDOWN_CONTENT_CLASS_NAME,
} from "@/components/shared/inline-markdown-code";
import {
  groupOrderedListItems,
  resolveOrderedListMargin,
  resolveOrderedListPadding,
} from "@/lib/ordered-list-groups";
import { resolveOrderedListStarts } from "../../../shared/nfm/ordered-list";
import type {
  NfmBlock,
  NfmInlineContent,
  NfmColor,
  NfmNumberedListItem,
  NfmStyleSet,
  NfmTable,
} from "@/lib/nfm/types";
import { FileLinkAnchor } from "../shared/file-link-anchor";
import { parseNfm } from "@/lib/nfm/parser";
import { resolveAssetSourceToHttpUrl } from "@/lib/assets";
import { formatCodexModelLabel } from "@/lib/codex-thread-settings";
import { formatThreadMentionShortUuid } from "@/lib/nfm/thread-mention-display";
import { formatDateMentionPlainText } from "@/lib/nfm/date-mention";
import { cn } from "@/lib/utils";
import { streamdownCodePlugin } from "@/lib/streamdown";
import { DateMentionInlineVisual } from "./date-mention-inline-visual";
import { ThreadMentionInlineVisual } from "./thread-mention-inline-visual";

interface NfmRendererProps {
  content: string;
  className?: string;
  projectWorkspacePath?: string | null;
}

/** Read-only renderer for Notion-flavored Markdown. */
export function NfmRenderer({
  content,
  className,
  projectWorkspacePath,
}: NfmRendererProps) {
  if (!content.trim()) return null;
  const blocks = parseNfm(content);
  return (
    <div className={cn("nfm-render", MARKDOWN_CONTENT_CLASS_NAME, className)}>
      <BlockList blocks={blocks} projectWorkspacePath={projectWorkspacePath} />
    </div>
  );
}

function BlockList({
  blocks,
  projectWorkspacePath,
}: {
  blocks: NfmBlock[];
  projectWorkspacePath?: string | null;
}) {
  const children: ReactNode[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];

    if (block.type !== "numberedListItem") {
      children.push(
        <BlockComponent
          key={index}
          block={block}
          projectWorkspacePath={projectWorkspacePath}
        />,
      );
      continue;
    }

    const orderedBlocks: NfmNumberedListItem[] = [block];
    while (index + 1 < blocks.length && blocks[index + 1]?.type === "numberedListItem") {
      orderedBlocks.push(blocks[index + 1] as NfmNumberedListItem);
      index += 1;
    }

    const starts = resolveOrderedListStarts(orderedBlocks);
    const groups = groupOrderedListItems(
      orderedBlocks,
      (_orderedBlock, orderedIndex) => starts[orderedIndex] ?? 1,
    );

    groups.forEach((group, groupIndex) => {
      children.push(
        <ol
          key={`${index}-${group.start}-${groupIndex}`}
          start={group.start}
          className={cn(
            "list-decimal",
            resolveOrderedListMargin(groupIndex, groups.length),
            resolveOrderedListPadding(group.digits),
          )}
        >
          {group.items.map((orderedBlock, orderedItemIndex) => (
            <NumberedListItemContent
              key={`${group.start}-${orderedItemIndex}`}
              block={orderedBlock}
              projectWorkspacePath={projectWorkspacePath}
            />
          ))}
        </ol>,
      );
    });
  }

  return (
    <>
      {children}
    </>
  );
}

function BlockComponent({
  block,
  projectWorkspacePath,
}: {
  block: NfmBlock;
  projectWorkspacePath?: string | null;
}) {
  const colorClass = block.color ? nfmColorClass(block.color) : undefined;

  switch (block.type) {
    case "paragraph":
      return (
        <p className={cn("my-1 leading-relaxed", colorClass)}>
          <InlineList items={block.content} projectWorkspacePath={projectWorkspacePath} />
          <ChildBlocks children={block.children} projectWorkspacePath={projectWorkspacePath} />
        </p>
      );

    case "heading": {
      const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4";
      const sizes = {
        1: "text-[1.875em] font-bold mt-6 mb-2",
        2: "text-[1.5em] font-semibold mt-5 mb-2",
        3: "text-[1.25em] font-semibold mt-4 mb-1",
        4: "text-[1.1em] font-semibold mt-3 mb-1",
      };

      if (block.isToggleable) {
        return (
          <details className={cn("nfm-toggle my-1", colorClass)} open={block.isOpen || undefined}>
            <summary className={cn("nfm-toggle-summary", sizes[block.level], INLINE_MARKDOWN_HEADING_CLASS_NAME)}>
              <ToggleCaretIcon hasChildren={block.children.length > 0} />
              <span className="min-w-0">
                <InlineList items={block.content} projectWorkspacePath={projectWorkspacePath} />
              </span>
            </summary>
            {block.children.length > 0 && (
              <div className="mt-1 pl-4">
                <BlockList blocks={block.children} projectWorkspacePath={projectWorkspacePath} />
              </div>
            )}
          </details>
        );
      }

      return (
        <Tag className={cn(sizes[block.level], colorClass, INLINE_MARKDOWN_HEADING_CLASS_NAME)}>
          <InlineList items={block.content} projectWorkspacePath={projectWorkspacePath} />
          <ChildBlocks children={block.children} projectWorkspacePath={projectWorkspacePath} />
        </Tag>
      );
    }

    case "bulletListItem":
      return (
        <ul className="my-0.5 list-disc pl-6">
          <li className={colorClass}>
            <InlineList items={block.content} projectWorkspacePath={projectWorkspacePath} />
            <ChildBlocks children={block.children} projectWorkspacePath={projectWorkspacePath} />
          </li>
        </ul>
      );

    case "checkListItem":
      return (
        <div className={cn("my-0.5 flex items-start gap-2", colorClass)}>
          <span
            aria-checked={block.checked}
            role="checkbox"
            className={cn(
              "mt-0.75 inline-block h-4 w-4 min-w-4 shrink-0 rounded-sm border-[calc(var(--spacing)*0.375)]",
              block.checked
                ? "border-(--accent-blue) bg-(--accent-blue)"
                : "border-(--foreground-tertiary) bg-transparent",
            )}
            style={block.checked ? { position: "relative" } : undefined}
          >
            {block.checked && (
              <svg viewBox="0 0 14 14" fill="none" className="h-full w-full text-white">
                <path d="M3 7.5L5.5 10L11 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span className={block.checked ? "line-through opacity-60" : ""}>
            <InlineList items={block.content} projectWorkspacePath={projectWorkspacePath} />
          </span>
          <ChildBlocks children={block.children} projectWorkspacePath={projectWorkspacePath} />
        </div>
      );

    case "toggle":
      return (
        <details className={cn("nfm-toggle my-1", colorClass)} open={block.isOpen || undefined}>
          <summary className="nfm-toggle-summary">
            <ToggleCaretIcon hasChildren={block.children.length > 0} />
            <span className="min-w-0">
              <InlineList items={block.content} projectWorkspacePath={projectWorkspacePath} />
            </span>
          </summary>
          {block.children.length > 0 && (
            <div className="mt-1 pl-4">
              <BlockList blocks={block.children} projectWorkspacePath={projectWorkspacePath} />
            </div>
          )}
        </details>
      );

    case "blockquote":
      return (
        <blockquote
          className={cn(
            "my-2 border-l-[calc(var(--spacing)*0.75)] border-(--border) pl-4 text-(--foreground-secondary)",
            colorClass,
          )}
        >
          <InlineList items={block.content} projectWorkspacePath={projectWorkspacePath} />
          <ChildBlocks children={block.children} projectWorkspacePath={projectWorkspacePath} />
        </blockquote>
      );

    case "codeBlock":
      return (
        <HighlightedCodeBlock
          code={block.code}
          language={block.language}
          className={colorClass}
        />
      );

    case "table":
      return (
        <NfmTableBlock
          table={block}
          projectWorkspacePath={projectWorkspacePath}
          className={colorClass}
        />
      );

    case "callout":
      return (
        <div
          className={cn(
            "nfm-callout my-2 flex gap-2 rounded-sm bg-(--background-tertiary) p-4",
            colorClass,
          )}
        >
          {block.icon && (
            <span className="text-[1.2em] select-none">{block.icon}</span>
          )}
          <div className="min-w-0 flex-1">
            <InlineList items={block.content} projectWorkspacePath={projectWorkspacePath} />
            <ChildBlocks children={block.children} projectWorkspacePath={projectWorkspacePath} />
          </div>
        </div>
      );

    case "image": {
      const sourceUrl = resolveAssetSourceToHttpUrl(block.source);
      const alt = inlineText(block.caption) || "Image";
      const widthStyle = block.previewWidth !== undefined
        ? { width: `${block.previewWidth}px`, maxWidth: "100%" }
        : undefined;

      return (
        <figure className={cn("my-3", colorClass)}>
          <img
            src={sourceUrl}
            alt={alt}
            className="max-w-full rounded-md border border-(--border)"
            style={widthStyle}
            loading="lazy"
          />
          {block.caption.length > 0 && (
            <figcaption className="mt-1 text-sm text-(--foreground-secondary)">
              <InlineList items={block.caption} projectWorkspacePath={projectWorkspacePath} />
            </figcaption>
          )}
          <ChildBlocks children={block.children} projectWorkspacePath={projectWorkspacePath} />
        </figure>
      );
    }

    case "toggleListInlineView":
      return (
        <div className="my-2.5 inline-flex items-center gap-2 rounded-lg border border-dashed border-(--border) bg-[color-mix(in_srgb,var(--background-secondary)_65%,transparent)] px-2.5 py-2 text-xs leading-none text-(--foreground-secondary)" title={`Inline toggle-list view (${block.sourceProjectId})`}>
          <span aria-hidden="true">∞</span>
          <span className="whitespace-nowrap">
            Toggle List Inline View · {block.sourceProjectId}
          </span>
        </div>
      );

    case "cardRef":
      return (
        <div className="my-2.5 inline-flex items-center gap-2 rounded-lg border border-dashed border-(--border) bg-[color-mix(in_srgb,var(--background-secondary)_65%,transparent)] px-2.5 py-2 text-xs leading-none text-(--foreground-secondary)" title={`Card reference (${block.sourceProjectId}/${block.cardId})`}>
          <span aria-hidden="true">↗</span>
          <span className="whitespace-nowrap">
            Card Reference · {block.sourceProjectId}/{block.cardId || "unlinked"}
          </span>
        </div>
      );

    case "card":
      return (
        <div className="my-2.5 inline-flex items-center gap-2 rounded-lg border border-(--border) bg-[color-mix(in_srgb,var(--background-secondary)_65%,transparent)] px-2.5 py-2 text-xs leading-none text-(--foreground-secondary)">
          <span aria-hidden="true">▣</span>
          <span className="whitespace-nowrap">
            Card · {block.displayHint || "Untitled"}
          </span>
        </div>
      );

    case "cardToggle":
      return (
        <details className="nfm-toggle my-1" open>
          <summary className="nfm-toggle-summary">
            <ToggleCaretIcon hasChildren={block.children.length > 0} />
            <span className="min-w-0">
              {block.meta && (
                <span className="mr-2 text-(--foreground-secondary)">{block.meta}</span>
              )}
              <InlineList items={block.content} projectWorkspacePath={projectWorkspacePath} />
            </span>
          </summary>
          {block.children.length > 0 && (
            <div className="mt-1 pl-4">
              <BlockList blocks={block.children} projectWorkspacePath={projectWorkspacePath} />
            </div>
          )}
        </details>
      );

    case "divider":
      return <hr className="my-4 border-t border-(--border)" />;

    case "emptyBlock":
      return <div className="h-[1em]" />;
  }
}

function NumberedListItemContent({
  block,
  projectWorkspacePath,
}: {
  block: NfmNumberedListItem;
  projectWorkspacePath?: string | null;
}) {
  const colorClass = block.color ? nfmColorClass(block.color) : undefined;

  return (
    <li className={cn("mb-1.5", colorClass)}>
      <InlineList items={block.content} projectWorkspacePath={projectWorkspacePath} />
      <ChildBlocks children={block.children} projectWorkspacePath={projectWorkspacePath} />
    </li>
  );
}

function NfmTableBlock({
  table,
  projectWorkspacePath,
  className,
}: {
  table: NfmTable;
  projectWorkspacePath?: string | null;
  className?: string;
}) {
  return (
    <div className={cn("nfm-render-table my-3 max-w-full overflow-x-auto", className)}>
      <table className="border-collapse text-sm leading-5">
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.cells.map((cell, columnIndex) => {
                const Tag = table.headerRow && rowIndex === 0 || table.headerColumn && columnIndex === 0
                  ? "th"
                  : "td";
                const column = table.columns[columnIndex];
                const color = cell.color ?? row.color ?? column?.color;
                const style = {
                  width: column?.width ? `${column.width}px` : undefined,
                  textAlign: column?.align,
                };
                return (
                  <Tag
                    key={columnIndex}
                    className={cn(
                      "min-w-[120px] max-w-[240px] border border-token-border px-[9px] py-[7px] text-left align-top font-normal",
                      (table.headerRow && rowIndex === 0) || (table.headerColumn && columnIndex === 0)
                        ? "bg-token-foreground/5"
                        : "",
                      color ? nfmColorClass(color) : "",
                    )}
                    style={style}
                  >
                    <InlineList
                      items={cell.content}
                      projectWorkspacePath={projectWorkspacePath}
                    />
                  </Tag>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HighlightedCodeBlock({
  code,
  language,
  className,
}: {
  code: string;
  language: string;
  className?: string;
}) {
  const normalizedLanguage = language.trim().toLowerCase();
  const fencedCode = `\`\`\`${normalizedLanguage}\n${code}\n\`\`\``;

  return (
    <div className={cn("nfm-code-block my-2 text-sm", className)}>
      <Streamdown
        plugins={{ code: streamdownCodePlugin }}
        controls={false}
        lineNumbers={false}
      >
        {fencedCode}
      </Streamdown>
    </div>
  );
}

function ChildBlocks({
  children,
  projectWorkspacePath,
}: {
  children: NfmBlock[];
  projectWorkspacePath?: string | null;
}) {
  if (!children || children.length === 0) return null;
  return (
    <div className="mt-1 pl-4">
      <BlockList blocks={children} projectWorkspacePath={projectWorkspacePath} />
    </div>
  );
}

function InlineList({
  items,
  projectWorkspacePath,
}: {
  items: NfmInlineContent[];
  projectWorkspacePath?: string | null;
}) {
  return (
    <>
      {items.map((item, i) => (
        <InlineItem
          key={i}
          item={item}
          projectWorkspacePath={projectWorkspacePath}
        />
      ))}
    </>
  );
}

function InlineItem({
  item,
  projectWorkspacePath,
}: {
  item: NfmInlineContent;
  projectWorkspacePath?: string | null;
}) {
  if (item.type === "linebreak") return <br />;

  if (item.type === "link") {
    return (
      <FileLinkAnchor
        href={item.href}
        projectWorkspacePath={projectWorkspacePath}
        className={cn("nfm-render-link", styleClasses(item.styles))}
      >
        {item.text}
      </FileLinkAnchor>
    );
  }

  if (item.type === "attachment") {
    const Icon = item.mode === "link"
      ? Link2
      : item.kind === "folder"
        ? Folder
        : item.kind === "file"
          ? FileCode2
          : FileText;
    const label = item.name.trim() || (item.kind === "text" ? "Pasted text" : "Untitled attachment");

    return (
      <span
        className="inline-flex max-w-[18rem] items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)] px-2 py-0.5 align-middle text-[12px] leading-5 text-[color-mix(in_srgb,var(--foreground)_84%,transparent)] shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--foreground)_10%,transparent)]"
        title={item.mode === "link" ? item.source : (item.origin || item.source)}
      >
        <Icon className="size-3 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
    );
  }

  if (item.type === "agentConfig") {
    const invalid = (item.unknownAttributes?.length ?? 0) > 0;
    const label = invalid
      ? "Invalid config"
      : item.mode === "plan"
      ? "Plan mode"
      : item.mode === "default"
        ? "Default mode"
        : "Agent config";
    const modelLabel = item.model ? formatCodexModelLabel(item.model, []) : "";
    const detail = [modelLabel, item.reasoning].filter(Boolean).join(" · ");
    return (
      <span className={cn(
        "inline-flex max-w-[18rem] items-center gap-1 rounded-full px-2 py-0.5 align-middle text-[12px] leading-5",
        invalid ? "bg-token-foreground/8 text-token-description-foreground" : "bg-token-charts-blue/10 text-token-charts-blue",
      )}>
        <Bot className="size-3 shrink-0" />
        <span className="truncate">{label}</span>
        {detail ? <span className="truncate opacity-70">{detail}</span> : null}
      </span>
    );
  }

  if (item.type === "threadMention") {
    const label = formatThreadMentionShortUuid(item.uuid);
    return (
      <ThreadMentionInlineVisual
        className="max-w-[18rem] align-baseline"
        title={item.uuid}
        label={label}
      />
    );
  }

  if (item.type === "dateMention") {
    return (
      <DateMentionInlineVisual
        payload={item}
        className="max-w-[18rem]"
        title={formatDateMentionPlainText(item)}
      />
    );
  }

  // text span
  const classes = styleClasses(item.styles, { includeCode: false });
  if (item.styles.code) {
    return <InlineMarkdownCode className={classes}>{item.text}</InlineMarkdownCode>;
  }
  if (!classes) return <>{item.text}</>;
  return <span className={classes}>{item.text}</span>;
}

function styleClasses(
  styles: NfmStyleSet,
  options?: { includeCode?: boolean },
): string | undefined {
  const parts: string[] = [];
  if (styles.bold) parts.push("font-semibold");
  if (styles.italic) parts.push("italic");
  if (styles.strikethrough) parts.push("line-through");
  if (styles.underline) parts.push("underline");
  if (styles.code && options?.includeCode !== false) parts.push("font-mono");
  if (styles.color) parts.push(nfmColorClass(styles.color));
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function nfmColorClass(color: NfmColor): string {
  // Map NFM colors to CSS variable-based classes
  const colorMap: Record<string, string> = {
    gray: "text-[var(--gray-text)]",
    brown: "text-[var(--brown-text,#64473a)]",
    orange: "text-[var(--orange-text,#d9730d)]",
    yellow: "text-[var(--yellow-text,#cb8a00)]",
    green: "text-[var(--green-text,#448361)]",
    blue: "text-[var(--blue-text)]",
    purple: "text-[var(--purple-text,#9065b0)]",
    pink: "text-[var(--pink-text,#ad1a72)]",
    red: "text-[var(--red-text,#e03e3e)]",
    gray_bg: "bg-[var(--gray-bg)] text-[var(--gray-text)]",
    brown_bg: "bg-[var(--brown-bg,#e9e5e3)] text-[var(--brown-text,#64473a)]",
    orange_bg: "bg-[var(--orange-bg,#faebdd)] text-[var(--orange-text,#d9730d)]",
    yellow_bg: "bg-[var(--yellow-bg,#fbf3db)] text-[var(--yellow-text,#cb8a00)]",
    green_bg: "bg-[var(--green-bg,#ddedea)] text-[var(--green-text,#448361)]",
    blue_bg: "bg-[var(--blue-bg)] text-[var(--blue-text)]",
    purple_bg: "bg-[var(--purple-bg,#e8deee)] text-[var(--purple-text,#9065b0)]",
    pink_bg: "bg-[var(--pink-bg,#f4dfeb)] text-[var(--pink-text,#ad1a72)]",
    red_bg: "bg-[var(--red-bg,#fbe4e4)] text-[var(--red-text,#e03e3e)]",
  };
  return colorMap[color] || "";
}

function ToggleCaretIcon({ hasChildren }: { hasChildren: boolean }) {
  return (
    <svg
      aria-hidden="true"
      role="graphics-symbol"
      viewBox="0 0 16 16"
      className="nfm-toggle-caret"
      style={hasChildren ? undefined : { color: "#848483" }}
    >
      <path d="M2.835 3.25a.8.8 0 0 0-.69 1.203l5.164 8.854a.8.8 0 0 0 1.382 0l5.165-8.854a.8.8 0 0 0-.691-1.203z" />
    </svg>
  );
}

function inlineText(items: NfmInlineContent[]): string {
  return items
    .map((item) => {
      if (item.type === "linebreak") return " ";
      if (item.type === "attachment") return item.name;
      if (item.type === "agentConfig") return "";
      if (item.type === "threadMention") return item.uuid;
      if (item.type === "dateMention") return formatDateMentionPlainText(item);
      return item.text;
    })
    .join("")
    .trim();
}
