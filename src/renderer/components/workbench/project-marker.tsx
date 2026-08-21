import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { ProjectAppearance, ProjectMarkerColor } from "../../../shared/project-appearance";
import { cn } from "@/lib/utils";
import { ProjectMarkerIconSvg } from "@/components/shared/icons";

interface ProjectMarkerColorClasses {
  swatchClassName: string;
  textClassName: string;
}

export const PROJECT_MARKER_COLOR_CLASSES: Record<ProjectMarkerColor, ProjectMarkerColorClasses> = {
  black: {
    swatchClassName: "bg-token-icon-foreground",
    textClassName: "text-token-icon-foreground",
  },
  red: {
    swatchClassName: "bg-[#fa423e] dark:bg-[#ff6764] electron-dark:bg-[#ff6764]",
    textClassName: "text-[#fa423e] dark:text-[#ff6764] electron-dark:text-[#ff6764]",
  },
  orange: {
    swatchClassName: "bg-[#fb6a22] dark:bg-[#ff8549] electron-dark:bg-[#ff8549]",
    textClassName: "text-[#fb6a22] dark:text-[#ff8549] electron-dark:text-[#ff8549]",
  },
  yellow: {
    swatchClassName: "bg-[#ffc300] dark:bg-[#ffd240] electron-dark:bg-[#ffd240]",
    textClassName: "text-[#ffc300] dark:text-[#ffd240] electron-dark:text-[#ffd240]",
  },
  green: {
    swatchClassName: "bg-[#04b84c] dark:bg-[#40c977] electron-dark:bg-[#40c977]",
    textClassName: "text-[#04b84c] dark:text-[#40c977] electron-dark:text-[#40c977]",
  },
  blue: {
    swatchClassName: "bg-[#0285ff] dark:bg-[#339cff] electron-dark:bg-[#339cff]",
    textClassName: "text-[#0285ff] dark:text-[#339cff] electron-dark:text-[#339cff]",
  },
  purple: {
    swatchClassName: "bg-[#924ff7] dark:bg-[#ad7bf9] electron-dark:bg-[#ad7bf9]",
    textClassName: "text-[#924ff7] dark:text-[#ad7bf9] electron-dark:text-[#ad7bf9]",
  },
  pink: {
    swatchClassName: "bg-[#ff66ad] dark:bg-[#ff8cc1] electron-dark:bg-[#ff8cc1]",
    textClassName: "text-[#ff66ad] dark:text-[#ff8cc1] electron-dark:text-[#ff8cc1]",
  },
};

export interface ProjectMarkerProps extends Omit<ComponentPropsWithoutRef<"span">, "children"> {
  appearance: ProjectAppearance;
  fallbackIcon?: ReactNode;
}

export function ProjectMarker({
  appearance,
  className,
  fallbackIcon,
  ...props
}: ProjectMarkerProps) {
  const marker =
    appearance.marker.kind === "emoji" ? (
      <span className="leading-none">{appearance.marker.emoji}</span>
    ) : appearance.marker.icon === "folder" && fallbackIcon != null ? (
      fallbackIcon
    ) : (
      <ProjectMarkerIconSvg icon={appearance.marker.icon} className="icon-xs" />
    );

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center font-medium",
        appearance.marker.kind === "emoji" ? "text-base" : "text-sm",
        appearance.marker.kind === "icon" &&
          PROJECT_MARKER_COLOR_CLASSES[appearance.color].textClassName,
        className,
      )}
      {...props}
    >
      {marker}
    </span>
  );
}
