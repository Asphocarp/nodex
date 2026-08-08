import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

const mergeClasses = extendTailwindMerge<"icon-size">({
  extend: {
    classGroups: {
      "icon-size": [
        "icon-3xs",
        "icon-xxs",
        "icon-2xs",
        "icon-xs",
        "icon-sm",
        "icon-base",
        "icon-md",
        "icon-lg",
      ],
    },
    conflictingClassGroups: {
      "icon-size": ["size", "w", "h"],
      size: ["icon-size"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return mergeClasses(clsx(inputs))
}
