import type { ReactNode } from "react";
import { THREAD_VISUAL_TOKENS } from "./local-conversation-visual-tokens";

export function ThreadLabel({ children }: { children: ReactNode }) {
  return <div className={THREAD_VISUAL_TOKENS.subtleLabel}>{children}</div>;
}
