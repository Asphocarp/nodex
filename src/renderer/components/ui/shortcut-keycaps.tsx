import { cn } from "@/lib/utils";

interface ShortcutKeycapsProps {
  keys: readonly string[];
  className?: string;
}

export function ShortcutKeycaps({ keys, className }: ShortcutKeycapsProps) {
  return (
    <kbd
      className={cn(
        "rounded-[3px] bg-token-foreground/5 px-1.5 py-0.5 font-sans text-[11px] leading-none font-medium tracking-wide text-token-description-foreground tabular-nums",
        className,
      )}
    >
      {keys.join("")}
    </kbd>
  );
}
