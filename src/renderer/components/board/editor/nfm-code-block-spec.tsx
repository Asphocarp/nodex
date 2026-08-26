import {
  createCodeBlockConfig,
  createCodeBlockSpec,
  parsePreCode,
  parsePreCodeContent,
  type CodeBlockOptions,
} from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { useSyncExternalStore, type RefCallback } from "react";
import { codeBlockViewState } from "@/lib/nfm/code-block-view-state";
import { cn } from "@/lib/utils";
import { getCodeBlockPlainText } from "@/lib/nfm/code-block-model";
import { CodeBlockReadOnlyHeader } from "@/components/shared/code-block-readonly-header";

export interface NfmCodeBlockSpecOptions extends CodeBlockOptions {
  readonly presentation?: "editable" | "readonly";
}

interface NfmCodeBlockSurfaceProps {
  readonly blockId: string;
  readonly language: string;
  readonly contentRef: RefCallback<HTMLElement>;
  readonly wrapped: boolean;
  readonly readOnlyCode?: string;
}

function NfmCodeBlockSurface({
  blockId,
  language,
  contentRef,
  wrapped,
  readOnlyCode,
}: NfmCodeBlockSurfaceProps) {
  return (
    <figure
      data-nfm-code-block-surface
      data-block-id={blockId}
      data-language={language}
      data-wrapped={String(wrapped)}
      className="relative m-0 w-full overflow-hidden rounded-[10px] bg-[var(--code-block-bg)] py-6 text-[var(--foreground)]"
    >
      <div
        contentEditable={false}
        data-nfm-code-block-action-anchor
        className="pointer-events-none absolute top-1 right-1 z-[2]"
      >
        {readOnlyCode === undefined ? null : (
          <CodeBlockReadOnlyHeader languageId={language} code={readOnlyCode} />
        )}
      </div>
      <pre className={cn("m-0 px-[22px] py-3", wrapped ? "overflow-x-hidden" : "overflow-x-auto")}>
        <code
          ref={contentRef}
          data-language={language}
          className={cn(
            "block min-w-0 font-mono text-[13.6px] leading-[20.4px] [tab-size:2]",
            wrapped ? "break-all whitespace-break-spaces" : "whitespace-pre",
          )}
        />
      </pre>
    </figure>
  );
}

function LocalWrapCodeBlockSurface(props: Omit<NfmCodeBlockSurfaceProps, "wrapped">) {
  const wrapped = useSyncExternalStore(
    (listener) => codeBlockViewState.subscribe(props.blockId, listener),
    () => codeBlockViewState.getWrapped(props.blockId),
    () => false,
  );
  return <NfmCodeBlockSurface {...props} wrapped={wrapped} />;
}

export const createNfmCodeBlockSpec = createReactBlockSpec(
  (options: Partial<NfmCodeBlockSpecOptions>) => createCodeBlockConfig(options),
  (options) => ({
    meta: {
      code: true,
      defining: true,
      isolating: false,
      highlight: (block) => block.props.language,
    },
    parse: parsePreCode,
    parseContent: (options) => parsePreCodeContent(options, "codeBlock"),
    render: ({ block, contentRef }) => {
      const props = {
        blockId: block.id,
        language: block.props.language,
        contentRef,
      };
      if (options.presentation === "readonly") {
        return (
          <NfmCodeBlockSurface
            {...props}
            wrapped={false}
            readOnlyCode={getCodeBlockPlainText(block)}
          />
        );
      }
      return <LocalWrapCodeBlockSurface {...props} />;
    },
    toExternalHTML: ({ block, contentRef }) => (
      <pre>
        <code
          ref={contentRef}
          className={`language-${block.props.language}`}
          data-language={block.props.language}
        />
      </pre>
    ),
  }),
  (options) => createCodeBlockSpec(options).extensions ?? [],
);
