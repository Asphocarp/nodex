import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { NodexPopoverContent } from "@/components/ui/popover";

type NfmEditorPopoverContentProps = ComponentPropsWithoutRef<typeof NodexPopoverContent>;
type AutoFocusHandler = NonNullable<NfmEditorPopoverContentProps["onOpenAutoFocus"]>;

function composePreventDefaultAutoFocus(
  handler: AutoFocusHandler | undefined,
): AutoFocusHandler {
  return (event) => {
    handler?.(event);
    event.preventDefault();
  };
}

export const NfmEditorPopoverContent = forwardRef<
  HTMLDivElement,
  NfmEditorPopoverContentProps
>(function NfmEditorPopoverContent(
  {
    onOpenAutoFocus,
    onCloseAutoFocus,
    ...props
  },
  ref,
) {
  return (
    <NodexPopoverContent
      ref={ref}
      onOpenAutoFocus={composePreventDefaultAutoFocus(onOpenAutoFocus)}
      onCloseAutoFocus={composePreventDefaultAutoFocus(onCloseAutoFocus)}
      {...props}
    />
  );
});
