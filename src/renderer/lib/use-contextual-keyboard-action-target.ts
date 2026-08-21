import { useId, useLayoutEffect } from "react";
import {
  registerContextualKeyboardActionTarget,
  unregisterContextualKeyboardActionTarget,
  type ContextualKeyboardActionTarget,
} from "./contextual-keyboard-actions";

/**
 * Keeps the mounted surface identity stable while replacing its current
 * command capabilities after each committed render.
 */
export function useContextualKeyboardActionTarget(target: ContextualKeyboardActionTarget): void {
  const registrationToken = useId();

  useLayoutEffect(() => {
    registerContextualKeyboardActionTarget(registrationToken, target);
  }, [registrationToken, target]);

  useLayoutEffect(
    () => () => {
      unregisterContextualKeyboardActionTarget(target.surfaceId, registrationToken);
    },
    [registrationToken, target.surfaceId],
  );
}
