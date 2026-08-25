import type { JSX } from "react";
import { cn } from "@/lib/utils";

type DictationIconProps = JSX.IntrinsicElements["svg"];

export function DictationMicrophoneIcon({ className, ...props }: DictationIconProps) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      className={cn("icon-base shrink-0", className)}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path
        fill="currentColor"
        d="M12 15.4a3.4 3.4 0 0 0 3.4-3.4V6.4a3.4 3.4 0 1 0-6.8 0V12a3.4 3.4 0 0 0 3.4 3.4Zm-6-3.8a1 1 0 1 1 2 0 4 4 0 0 0 8 0 1 1 0 1 1 2 0 6 6 0 0 1-5 5.92V20h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.48A6 6 0 0 1 6 11.6Z"
      />
    </svg>
  );
}
