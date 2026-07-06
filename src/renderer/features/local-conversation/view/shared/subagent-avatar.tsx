import type { CSSProperties } from "react";
import { cn } from "../../../../lib/utils";

function hashSubagentSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33 + seed.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function buildSubagentAvatarStyle(seed: string): CSSProperties {
  const hue = hashSubagentSeed(seed) % 360;
  return {
    background:
      `radial-gradient(circle at 35% 28%, hsl(${hue} 78% 72% / 0.95), hsl(${(hue + 42) % 360} 60% 48% / 0.28) 48%, hsl(${(hue + 208) % 360} 54% 34% / 0.24))`,
    color: `hsl(${hue} 62% 30%)`,
  };
}

export function SubagentAvatar({
  seed,
  active = false,
  className,
  iconClassName,
}: {
  seed: string;
  active?: boolean;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-token-border/40 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.22)]",
        active && "ring-1 ring-token-text-link-foreground/45",
        className ?? "size-4",
      )}
      data-subagent-avatar-active={active ? "true" : "false"}
      data-subagent-avatar-seed={seed}
      style={buildSubagentAvatarStyle(seed)}
    >
      <svg
        viewBox="0 0 20 20"
        className={cn("h-[70%] w-[70%]", iconClassName)}
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M10 3.25v1.5m-3.1 3.1h6.2m-7.35.5c0-1.31 1.06-2.38 2.38-2.38h3.74c1.32 0 2.38 1.07 2.38 2.38v2.53a3.12 3.12 0 0 1-3.13 3.12H8.88a3.12 3.12 0 0 1-3.13-3.12V8.35Z"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8.3 10.35h.01m3.38 0h.01"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
