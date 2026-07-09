import type { ThreadStageScreenProps } from "../thread-stage-types";

export function LocalConversationStageScreen(props: ThreadStageScreenProps) {
  const { header, body, footer, floatingContent, onReadInteraction } = props;
  return (
    <div
      className="relative flex h-full min-h-0 flex-col bg-(--background)"
      onKeyDownCapture={onReadInteraction}
      onPointerDownCapture={onReadInteraction}
      onWheelCapture={onReadInteraction}
    >
      <div className="sticky top-0 z-10">
        {header}
      </div>
      {floatingContent}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative mx-auto flex min-h-0 w-full flex-1 flex-col">
          <div className="min-h-0 flex-1">
            {body}
          </div>
        </div>
        {footer ? (
          <div className="z-10 w-full pb-2">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
