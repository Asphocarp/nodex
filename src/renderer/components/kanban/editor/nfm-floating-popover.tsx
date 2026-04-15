import {
  autoUpdate,
  FloatingFocusManager,
  useDismiss,
  useFloating,
  useHover,
  useInteractions,
  useMergeRefs,
  useTransitionStatus,
  useTransitionStyles,
} from "@floating-ui/react";
import { useEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import type { FloatingUIOptions } from "@blocknote/react";

export type NfmPopoverReference =
  | {
      element: Element;
      cacheMountedBoundingClientRect?: boolean;
    }
  | {
      element: undefined;
      getBoundingClientRect: () => DOMRect;
    }
  | {
      element: Element;
      cacheMountedBoundingClientRect?: boolean;
      getBoundingClientRect: () => DOMRect;
    };

export function getMountedBoundingClientRectCache(reference: NfmPopoverReference) {
  let lastBoundingClientRect = new DOMRect();
  const getBoundingClientRect = "getBoundingClientRect" in reference
    ? () => reference.getBoundingClientRect()
    : () => reference.element.getBoundingClientRect();

  return () => {
    if (
      reference.element
      && (reference.cacheMountedBoundingClientRect ?? true)
    ) {
      if (reference.element.isConnected) {
        lastBoundingClientRect = getBoundingClientRect();
      }

      return lastBoundingClientRect;
    }

    return getBoundingClientRect();
  };
}

export function NfmFloatingPopover(
  props: FloatingUIOptions & {
    reference?: NfmPopoverReference;
    children: ReactNode;
  },
) {
  const { refs, floatingStyles, context } = useFloating<HTMLDivElement>({
    whileElementsMounted: autoUpdate,
    ...props.useFloatingOptions,
  });
  const { isMounted, styles } = useTransitionStyles(
    context,
    props.useTransitionStylesProps,
  );
  const { status } = useTransitionStatus(
    context,
    props.useTransitionStatusProps,
  );
  const dismiss = useDismiss(context, props.useDismissProps);
  const hover = useHover(context, { enabled: false, ...props.useHoverProps });
  const { getFloatingProps } = useInteractions([dismiss, hover]);
  const innerHTML = useRef("");
  const ref = useRef<HTMLDivElement>(null);
  const mergedRefs = useMergeRefs([ref, refs.setFloating]);

  useEffect(() => {
    if (!props.reference) return;

    const element = "element" in props.reference
      ? props.reference.element
      : undefined;

    if (element !== undefined) {
      refs.setReference(element);
    }

    refs.setPositionReference({
      getBoundingClientRect: getMountedBoundingClientRectCache(props.reference),
      contextElement: element,
    });
  }, [props.reference, refs]);

  useEffect(() => {
    if (
      (status === "initial" || status === "open")
      && ref.current?.innerHTML
    ) {
      innerHTML.current = ref.current.innerHTML;
    }
  }, [props.children, props.reference, status]);

  if (!isMounted) {
    return false;
  }

  const mergedProps: HTMLAttributes<HTMLDivElement> = {
    ...props.elementProps,
    style: {
      display: "flex",
      ...props.elementProps?.style,
      zIndex: `calc(var(--bn-ui-base-z-index) + ${props.elementProps?.style?.zIndex || 0})`,
      ...floatingStyles,
      ...styles,
    },
    ...getFloatingProps(),
  };

  if (status === "close") {
    return (
      <div
        ref={mergedRefs}
        {...mergedProps}
        dangerouslySetInnerHTML={{ __html: innerHTML.current }}
      />
    );
  }

  if (!props.focusManagerProps?.disabled) {
    return (
      <FloatingFocusManager {...props.focusManagerProps} context={context}>
        <div ref={mergedRefs} {...mergedProps}>
          {props.children}
        </div>
      </FloatingFocusManager>
    );
  }

  return (
    <div ref={mergedRefs} {...mergedProps}>
      {props.children}
    </div>
  );
}
