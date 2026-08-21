import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

export const MENTION_INLINE_UNDERLINE_STYLE = {
  textDecorationColor: "color-mix(in srgb, currentColor 25%, transparent)",
  textDecorationThickness: "0.05em",
  textUnderlineOffset: "10%",
} satisfies CSSProperties;

export const MENTION_INLINE_CHIP_CLASS = [
  "relative isolate z-0 inline-flex max-w-full items-baseline gap-[0.3em] overflow-visible whitespace-nowrap rounded-[2px] align-baseline font-medium text-inherit select-none",
  "border-0 bg-transparent p-0",
  "before:pointer-events-none before:absolute before:-inset-x-[0.15em] before:-inset-y-[0.1em] before:-z-10 before:rounded-[3px] before:bg-token-foreground/5 before:opacity-0 before:content-[''] hover:before:opacity-100 focus-visible:before:opacity-100 data-[mention-token-selected=true]:before:opacity-100",
  "focus-visible:outline-none",
].join(" ");

export type MentionInlineKind = "page" | "thread";

interface MentionInlineVisualBaseProps {
  readonly label: ReactNode;
  readonly icon?: ReactNode;
  readonly iconClassName?: string;
  readonly labelClassName?: string;
}

type MentionInlineVisualSpanProps = MentionInlineVisualBaseProps &
  Omit<ComponentPropsWithoutRef<"span">, "children"> & { readonly as?: "span" };

type MentionInlineVisualButtonProps = MentionInlineVisualBaseProps &
  Omit<ComponentPropsWithoutRef<"button">, "children"> & { readonly as: "button" };

type MentionInlineVisualAnchorProps = MentionInlineVisualBaseProps &
  Omit<ComponentPropsWithoutRef<"a">, "children"> & { readonly as: "a" };

export type MentionInlineVisualProps =
  | MentionInlineVisualSpanProps
  | MentionInlineVisualButtonProps
  | MentionInlineVisualAnchorProps;

type MentionInlineVisualInternalProps = MentionInlineVisualProps & {
  readonly kind?: MentionInlineKind;
  readonly withGuards?: boolean;
};

function MentionInlineVisualChildren({
  label,
  icon,
  iconClassName,
  labelClassName,
}: MentionInlineVisualBaseProps) {
  return (
    <>
      {icon ? (
        <span
          className={cn(
            "relative top-[0.14em] inline-flex size-[1em] shrink-0 text-token-description-foreground",
            iconClassName,
          )}
        >
          {icon}
        </span>
      ) : null}
      <span
        className={cn("truncate leading-[inherit] underline", labelClassName)}
        style={MENTION_INLINE_UNDERLINE_STYLE}
        data-mention-inline-label="true"
      >
        {label}
      </span>
    </>
  );
}

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

  const renderChip = (chip: ReactNode) => (withGuards ? wrapMentionInlineGuards(chip, kind) : chip);

  if (props.as === "button") {
    const {
      as: Element,
      label,
      icon,
      iconClassName,
      labelClassName,
      className,
      ...buttonProps
    } = props;
    return renderChip(
      <Element
        className={cn(MENTION_INLINE_CHIP_CLASS, className)}
        {...buttonProps}
        {...dataAttributes}
      >
        <MentionInlineVisualChildren
          label={label}
          icon={icon}
          iconClassName={iconClassName}
          labelClassName={labelClassName}
        />
      </Element>,
    );
  }

  if (props.as === "a") {
    const {
      as: Element,
      label,
      icon,
      iconClassName,
      labelClassName,
      className,
      ...anchorProps
    } = props;
    return renderChip(
      <Element
        className={cn(MENTION_INLINE_CHIP_CLASS, className)}
        {...anchorProps}
        {...dataAttributes}
      >
        <MentionInlineVisualChildren
          label={label}
          icon={icon}
          iconClassName={iconClassName}
          labelClassName={labelClassName}
        />
      </Element>,
    );
  }

  const {
    as: Element = "span",
    label,
    icon,
    iconClassName,
    labelClassName,
    className,
    ...spanProps
  } = props;
  return renderChip(
    <Element
      className={cn(MENTION_INLINE_CHIP_CLASS, className)}
      {...spanProps}
      {...dataAttributes}
    >
      <MentionInlineVisualChildren
        label={label}
        icon={icon}
        iconClassName={iconClassName}
        labelClassName={labelClassName}
      />
    </Element>,
  );
}
