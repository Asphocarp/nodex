import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";
import type { Priority } from "../../../../shared/types";

type PriorityValueIconProps = ComponentProps<"svg"> & {
  readonly priority: Priority | null;
};

/** The compact value glyph shared by priority cells, labels, and picker rows. */
export function PriorityValueIcon({ priority, className, ...props }: PriorityValueIconProps) {
  const sharedProps = {
    ...props,
    "aria-hidden": true,
    className: cn("size-4 shrink-0 opacity-100", className),
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
  } as const;

  if (priority === "p0-critical") {
    return (
      <svg {...sharedProps} fill="lch(66% 80 48)">
        <path d="M3 1C1.91067 1 1 1.91067 1 3V13C1 14.0893 1.91067 15 3 15H13C14.0893 15 15 14.0893 15 13V3C15 1.91067 14.0893 1 13 1H3ZM7 4L9 4L8.75391 8.99836H7.25L7 4ZM9 11C9 11.5523 8.55228 12 8 12C7.44772 12 7 11.5523 7 11C7 10.4477 7.44772 10 8 10C8.55228 10 9 10.4477 9 11Z" />
      </svg>
    );
  }

  if (priority === null) {
    return (
      <svg {...sharedProps} fill="currentColor">
        <rect x="1.5" y="7.25" width="3" height="1.5" rx="0.5" opacity="0.9" />
        <rect x="6.5" y="7.25" width="3" height="1.5" rx="0.5" opacity="0.9" />
        <rect x="11.5" y="7.25" width="3" height="1.5" rx="0.5" opacity="0.9" />
      </svg>
    );
  }

  const secondOpacity = priority === "p3-low" ? 0.4 : 1;
  const thirdOpacity = priority === "p1-high" ? 1 : 0.4;
  return (
    <svg {...sharedProps} fill="currentColor">
      <rect x="1.5" y="8" width="3" height="6" rx="1" />
      <rect x="6.5" y="5" width="3" height="9" rx="1" opacity={secondOpacity} />
      <rect x="11.5" y="2" width="3" height="12" rx="1" opacity={thirdOpacity} />
    </svg>
  );
}
