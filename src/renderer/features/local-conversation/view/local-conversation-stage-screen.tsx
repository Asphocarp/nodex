import type { ThreadStageScreenProps } from "../thread-stage-types";
import { motion, useReducedMotion } from "motion/react";
import { CODEX_SHELL_PANEL_TRANSITION } from "../../../lib/codex-panel-motion";
import { EnsureLocalConversationThreadScrollController } from "./local-conversation-thread-scroll-controller";

export function LocalConversationStageScreen(props: ThreadStageScreenProps) {
  const { header, body, footer, floatingContent, contentShiftX = 0 } = props;
  const reducedMotion = useReducedMotion();
  return (
    <div className="relative flex h-full min-h-0 flex-col bg-(--background)">
      {header ? (
        <div className="sticky top-0 z-10">
          {header}
        </div>
      ) : null}
      {floatingContent}
      <EnsureLocalConversationThreadScrollController>
        <motion.div
          className="flex min-h-0 flex-1 flex-col"
          animate={{ x: contentShiftX }}
          transition={reducedMotion ? { duration: 0 } : CODEX_SHELL_PANEL_TRANSITION}
        >
          <div className="relative mx-auto flex min-h-0 w-full flex-1 flex-col">
            <div className="min-h-0 flex-1">
              {body}
            </div>
          </div>
          <div className="z-10 w-full pb-2">
            {footer}
          </div>
        </motion.div>
      </EnsureLocalConversationThreadScrollController>
    </div>
  );
}
