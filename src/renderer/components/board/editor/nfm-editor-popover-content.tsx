import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { NodexPopoverContent } from "@/components/ui/popover";

type NfmEditorPopoverContentProps = ComponentPropsWithoutRef<typeof NodexPopoverContent>;

export const NfmEditorPopoverContent = forwardRef<HTMLDivElement, NfmEditorPopoverContentProps>(
  function NfmEditorPopoverContent(props, ref) {
    return <NodexPopoverContent ref={ref} initialFocus={false} finalFocus={false} {...props} />;
  },
);
