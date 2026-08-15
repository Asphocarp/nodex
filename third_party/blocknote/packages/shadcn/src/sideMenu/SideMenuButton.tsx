import { ComponentProps } from "@blocknote/react";
import { forwardRef } from "react";

import { cn } from "../lib/utils.js";
import { useShadCNComponentsContext } from "../ShadCNComponentsContext.js";

export const SideMenuButton = forwardRef<
  HTMLButtonElement,
  ComponentProps["SideMenu"]["Button"]
>((props, ref) => {
  const {
    className,
    children,
    icon,
    label,
    ...buttonProps
  } = props;

  const ShadCNComponents = useShadCNComponentsContext()!;

  return (
    <ShadCNComponents.Button.Button
      {...buttonProps}
      variant={"ghost"}
      className={cn("text-gray-400", className)}
      ref={ref}
      type={buttonProps.type ?? "button"}
      aria-label={label}
    >
      {icon}
      {children}
    </ShadCNComponents.Button.Button>
  );
});
