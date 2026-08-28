import type { ReactNode } from "react";

import { InlineReferenceVisual, type InlineReferenceVisualProps } from "./inline-reference-visual";

export type MentionInlineVisualProps = InlineReferenceVisualProps;

export type MentionInlineKind = "page" | "thread";

type MentionInlineVisualInternalProps = InlineReferenceVisualProps & {
  readonly kind?: MentionInlineKind;
  readonly withGuards?: boolean;
};

function kindDataAttributes(kind: MentionInlineKind | undefined) {
  if (kind === "page") {
    return { "data-page-mention-inline-chip": "true" };
  }
  if (kind === "thread") {
    return { "data-thread-mention-inline-chip": "true" };
  }
  return {};
}

function wrapMentionInlineGuards(chip: ReactNode, kind: MentionInlineKind | undefined) {
  return (
    <span
      className="inline align-baseline"
      data-mention-inline-root="true"
      {...(kind === "page"
        ? { "data-page-mention-inline-root": "true" }
        : kind === "thread"
          ? { "data-thread-mention-inline-root": "true" }
          : {})}
    >
      <span
        aria-hidden="true"
        className="inline-block w-0 overflow-hidden align-baseline"
        data-mention-inline-guard="start"
      />
      {chip}
      <span
        aria-hidden="true"
        className="inline-block w-0 overflow-hidden align-baseline"
        data-mention-inline-guard="end"
      />
    </span>
  );
}

export function MentionInlineVisual({
  kind,
  withGuards,
  ...props
}: MentionInlineVisualInternalProps) {
  const dataAttributes = {
    "data-mention-inline-chip": "true",
    ...kindDataAttributes(kind),
  };

  if (props.as === "button") {
    const chip = <InlineReferenceVisual {...props} {...dataAttributes} />;
    return withGuards ? wrapMentionInlineGuards(chip, kind) : chip;
  }

  if (props.as === "a") {
    const chip = <InlineReferenceVisual {...props} {...dataAttributes} />;
    return withGuards ? wrapMentionInlineGuards(chip, kind) : chip;
  }

  const chip = <InlineReferenceVisual {...props} {...dataAttributes} />;
  return withGuards ? wrapMentionInlineGuards(chip, kind) : chip;
}
