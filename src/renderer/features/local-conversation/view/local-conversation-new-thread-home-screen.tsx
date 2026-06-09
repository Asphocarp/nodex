import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CODEX_SHELL_PANEL_TRANSITION } from "../../../lib/codex-panel-motion";
import { EnsureLocalConversationThreadScrollController } from "./local-conversation-thread-scroll-controller";

interface LocalConversationNewThreadHomeScreenProps {
  hero: ReactNode;
  footer: ReactNode;
  body?: ReactNode;
  floatingContent?: ReactNode;
  contentShiftX?: number;
}

export function LocalConversationNewThreadHomeScreen({
  hero,
  footer,
  body = null,
  floatingContent,
  contentShiftX = 0,
}: LocalConversationNewThreadHomeScreenProps) {
  const reducedMotion = useReducedMotion();

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-(--background)">
      {floatingContent}
      <EnsureLocalConversationThreadScrollController>
        <motion.div
          className="flex min-h-0 flex-1 flex-col"
          animate={{ x: contentShiftX }}
          transition={reducedMotion ? { duration: 0 } : CODEX_SHELL_PANEL_TRANSITION}
        >
          <div className="@container/left-panel relative flex h-full flex-col">
            <div
              className="[container-type:size] relative flex min-h-0 w-full flex-1 flex-col overflow-y-auto [container-name:home-main-content]"
              role="main"
              data-new-thread-home-main="true"
            >
              <div
                className="mx-auto flex h-[39%] w-[min(100%,var(--thread-content-max-width))] min-w-0 shrink-0 flex-col justify-end px-panel pb-6"
                data-new-thread-home-hero="true"
              >
                {hero}
              </div>
              <div
                className="sticky top-0 z-10 mx-auto flex w-[min(100%,var(--thread-content-max-width))] min-w-0 flex-col gap-2 px-panel pt-5 electron:bg-token-main-surface-primary"
                data-new-thread-home-composer="true"
              >
                {footer}
              </div>
              {body ? (
                <div className="mx-auto w-[min(100%,var(--thread-content-max-width))] min-w-0 px-panel pt-2 pb-6">
                  {body}
                </div>
              ) : null}
            </div>
          </div>
        </motion.div>
      </EnsureLocalConversationThreadScrollController>
    </div>
  );
}
