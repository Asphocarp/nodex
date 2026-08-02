import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";

import { ThreadIcon } from "@/components/shared/icons";
import { cn } from "@/lib/utils";

const THREAD_MENTION_INLINE_UNDERLINE_STYLE = {
  textDecorationColor: "color-mix(in srgb, currentColor 35%, transparent)",
  textDecorationThickness: "0.05em",
  textUnderlineOffset: "10%",
} satisfies CSSProperties;

interface ThreadMentionInlineVisualBaseProps {
  label: ReactNode;
  iconClassName?: string;
  labelClassName?: string;
}

type ThreadMentionInlineVisualSpanProps =
  & ThreadMentionInlineVisualBaseProps
  & Omit<ComponentPropsWithoutRef<"span">, "children">
  & { as?: "span" };

type ThreadMentionInlineVisualButtonProps =
  & ThreadMentionInlineVisualBaseProps
  & Omit<ComponentPropsWithoutRef<"button">, "children">
  & { as: "button" };

export type ThreadMentionInlineVisualProps =
  | ThreadMentionInlineVisualSpanProps
  | ThreadMentionInlineVisualButtonProps;

function ThreadMentionInlineVisualChildren({
  label,
  iconClassName,
  labelClassName,
}: ThreadMentionInlineVisualBaseProps) {
  return (
    <>
      <ThreadIcon
        className={cn(
          "relative top-[0.14em] inline-block size-[1.0em] shrink-0 text-token-description-foreground",
          iconClassName,
        )}
      />
      <span
        className={cn("truncate leading-[inherit] underline", labelClassName)}
        style={THREAD_MENTION_INLINE_UNDERLINE_STYLE}
      >
        {label}
      </span>
    </>
  );
}

export function ThreadMentionInlineVisual(props: ThreadMentionInlineVisualProps) {
  if (props.as === "button") {
    const { as: Element, label, iconClassName, labelClassName, className, ...buttonProps } = props;
    return (
      <Element
        className={cn(
          "inline-flex max-w-full items-baseline gap-[0.3em] whitespace-nowrap rounded-[2px] px-[0.1em] font-medium text-inherit",
          className,
        )}
        {...buttonProps}
      >
        <ThreadMentionInlineVisualChildren
          label={label}
          iconClassName={iconClassName}
          labelClassName={labelClassName}
        />
      </Element>
    );
  }

  const { as: Element = "span", label, iconClassName, labelClassName, className, ...spanProps } = props;
  return (
    <Element
      className={cn(
        "inline-flex max-w-full items-baseline gap-[0.3em] whitespace-nowrap rounded-[2px] px-[0.1em] font-medium text-inherit",
        className,
      )}
      {...spanProps}
    >
      <ThreadMentionInlineVisualChildren
        label={label}
        iconClassName={iconClassName}
        labelClassName={labelClassName}
      />
    </Element>
  );
}
