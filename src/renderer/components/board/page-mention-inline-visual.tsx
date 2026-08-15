import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";

import { PageIcon } from "@/components/shared/icons";
import { cn } from "@/lib/utils";

const PAGE_MENTION_UNDERLINE_STYLE = {
  textDecorationColor: "color-mix(in srgb, currentColor 35%, transparent)",
  textDecorationThickness: "0.05em",
  textUnderlineOffset: "10%",
} satisfies CSSProperties;

interface PageMentionInlineVisualBaseProps {
  readonly label: ReactNode;
  readonly icon?: ReactNode;
  readonly iconClassName?: string;
  readonly labelClassName?: string;
}

type PageMentionInlineVisualSpanProps =
  & PageMentionInlineVisualBaseProps
  & Omit<ComponentPropsWithoutRef<"span">, "children">
  & { readonly as?: "span" };

type PageMentionInlineVisualButtonProps =
  & PageMentionInlineVisualBaseProps
  & Omit<ComponentPropsWithoutRef<"button">, "children">
  & { readonly as: "button" };

export type PageMentionInlineVisualProps =
  | PageMentionInlineVisualSpanProps
  | PageMentionInlineVisualButtonProps;

function PageMentionInlineVisualChildren({
  label,
  icon,
  iconClassName,
  labelClassName,
}: PageMentionInlineVisualBaseProps) {
  return (
    <>
      {icon ? (
        <span
          className={cn(
            "relative top-[0.14em] inline-flex size-[1em] shrink-0",
            iconClassName,
          )}
        >
          {icon}
        </span>
      ) : (
        <PageIcon
          className={cn(
            "relative top-[0.14em] inline-block size-[1em] shrink-0 text-token-description-foreground",
            iconClassName,
          )}
        />
      )}
      <span
        className={cn("truncate leading-[inherit] underline", labelClassName)}
        style={PAGE_MENTION_UNDERLINE_STYLE}
      >
        {label}
      </span>
    </>
  );
}

export function PageMentionInlineVisual(props: PageMentionInlineVisualProps) {
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
    return (
      <Element
        className={cn(
          "inline-flex max-w-full items-baseline gap-[0.3em] whitespace-nowrap rounded-[2px] px-[0.1em] font-medium text-inherit hover:bg-token-foreground/5 focus-visible:bg-token-foreground/5 focus-visible:outline-none",
          className,
        )}
        {...buttonProps}
      >
        <PageMentionInlineVisualChildren
          label={label}
          icon={icon}
          iconClassName={iconClassName}
          labelClassName={labelClassName}
        />
      </Element>
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
  return (
    <Element
      className={cn(
        "inline-flex max-w-full items-baseline gap-[0.3em] whitespace-nowrap rounded-[2px] px-[0.1em] font-medium text-inherit",
        className,
      )}
      {...spanProps}
    >
      <PageMentionInlineVisualChildren
        label={label}
        icon={icon}
        iconClassName={iconClassName}
        labelClassName={labelClassName}
      />
    </Element>
  );
}
