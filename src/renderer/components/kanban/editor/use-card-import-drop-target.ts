import { useEffect, useId, useMemo } from "react";
import type { RefObject } from "react";
import { dropTargetForExternal } from "@atlaskit/pragmatic-drag-and-drop/external/adapter";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  claimCrossWindowDrag,
  completeCrossWindowDrag,
  getCrossWindowDragPreview,
} from "@/lib/cross-window-drag";
import { toast } from "@/components/ui/toast";
import {
  registerCardDropTarget,
  type CardDropApplyResult,
} from "./card-drop-target-registry";
import type {
  CardDragPointer,
  ExternalCardDragPayload,
} from "./external-card-drag-session";
import {
  type DragTransferOperation,
  NODEX_KANBAN_CARDS_DRAG_MIME,
  parseCrossWindowDragToken,
  resolveDragTransferOperation,
} from "../../../../shared/cross-window-drag";

interface UseCardImportDropTargetOptions {
  containerRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
  getTargetCardIds: (pointer: CardDragPointer | null) => string[];
  applyDrop: (
    payload: ExternalCardDragPayload,
    pointer: CardDragPointer,
  ) => CardDropApplyResult | null | Promise<CardDropApplyResult | null>;
  commitDrop: (
    payload: ExternalCardDragPayload,
    result: CardDropApplyResult,
    operation: DragTransferOperation,
    groupId: string,
  ) => Promise<boolean>;
  setHover?: (
    hover: boolean,
    pointer: CardDragPointer | null,
    payload: ExternalCardDragPayload | null,
    operation?: DragTransferOperation,
  ) => void;
}

export function useCardImportDropTarget({
  containerRef,
  enabled = true,
  getTargetCardIds,
  applyDrop,
  commitDrop,
  setHover,
}: UseCardImportDropTargetOptions): void {
  const autoId = useId();
  const targetId = useMemo(() => `card-import-target-${autoId}`, [autoId]);

  useEffect(() => {
    if (!enabled) return;
    const element = containerRef.current;
    if (!element) return;
    getCrossWindowDragPreview();

    const canDrop = (
      payload: ExternalCardDragPayload,
      pointer: CardDragPointer | null,
    ): boolean => {
      const targetCardIds = new Set(getTargetCardIds(pointer));
      return !payload.cards.some((entry) => targetCardIds.has(entry.card.id));
    };
    const setTargetHover = (
      hover: boolean,
      pointer: CardDragPointer | null,
      payload: ExternalCardDragPayload | null,
      operation?: DragTransferOperation,
    ) => {
      if (hover) {
        element.setAttribute("data-card-drop-hover", "");
        element.toggleAttribute("data-card-drop-copy", operation === "copy");
      } else {
        element.removeAttribute("data-card-drop-hover");
        element.removeAttribute("data-card-drop-copy");
      }
      setHover?.(hover, pointer, payload, operation);
    };
    const performDrop = async (
      payload: ExternalCardDragPayload,
      pointer: CardDragPointer,
      operation: DragTransferOperation,
      groupId: string,
    ): Promise<boolean> => {
      if (!canDrop(payload, pointer)) return false;
      const optimisticResult = await applyDrop(payload, pointer);
      if (!optimisticResult) return false;

      try {
        const committed = await commitDrop(payload, optimisticResult, operation, groupId);
        if (!committed) optimisticResult.rollback();
        return committed;
      } catch {
        optimisticResult.rollback();
        return false;
      } finally {
        optimisticResult.cleanup?.();
      }
    };

    const unregister = registerCardDropTarget({
      id: targetId,
      element,
      canDrop,
      setHover: setTargetHover,
      performDrop,
    });

    const unregisterExternal = dropTargetForExternal({
      element,
      canDrop: ({ source, input }) => {
        if (!source.types.includes(NODEX_KANBAN_CARDS_DRAG_MIME)) return false;
        const preview = getCrossWindowDragPreview();
        if (preview?.kind !== "cards") return true;
        return canDrop(preview.payload, { x: input.clientX, y: input.clientY });
      },
      getDropEffect: ({ input }) => resolveDragTransferOperation(input.altKey),
      onDrag: ({ source, location }) => {
        const preview = getCrossWindowDragPreview();
        const previewPayload = preview?.kind === "cards"
          ? preview.payload
          : null;
        if (previewPayload && !canDrop(previewPayload, {
          x: location.current.input.clientX,
          y: location.current.input.clientY,
        })) {
          setTargetHover(false, null, null);
          return;
        }
        setTargetHover(
          true,
          { x: location.current.input.clientX, y: location.current.input.clientY },
          previewPayload,
          resolveDragTransferOperation(location.current.input.altKey),
        );
        void source;
      },
      onDragLeave: () => setTargetHover(false, null, null),
      onDrop: async ({ source, location }) => {
        setTargetHover(false, null, null);
        const token = parseCrossWindowDragToken(
          source.getStringData(NODEX_KANBAN_CARDS_DRAG_MIME),
        );
        if (!token) return;

        const claim = await claimCrossWindowDrag({
          sessionId: token.sessionId,
          kind: "cards",
        });
        if (!claim || claim.kind !== "cards") {
          toast.danger("Could not complete drop; the source was unchanged.");
          return;
        }
        const pointer = {
          x: location.current.input.clientX,
          y: location.current.input.clientY,
        };
        if (!canDrop(claim.payload, pointer)) {
          await completeCrossWindowDrag({ sessionId: token.sessionId, result: "cancel" });
          return;
        }

        const operation = resolveDragTransferOperation(location.current.input.altKey);
        const committed = await performDrop(
          claim.payload,
          pointer,
          operation,
          claim.groupId,
        );
        await completeCrossWindowDrag({
          sessionId: token.sessionId,
          result: committed ? operation : "cancel",
        });
        if (!committed) {
          toast.danger("Could not complete drop; the source was unchanged.");
        }
      },
    });

    return combine(unregister, unregisterExternal);
  }, [
    applyDrop,
    commitDrop,
    containerRef,
    enabled,
    getTargetCardIds,
    setHover,
    targetId,
  ]);
}
