import { useCallback } from "react";
import {
  readCardPropertyPosition,
  writeCardPropertyPosition,
  type CardPropertyPosition,
} from "./card-property-position";
import { appScope, scopedAtomWithInitializer, useScopedAtom } from "./maitai";

interface CardPropertyPositionContextValue {
  position: CardPropertyPosition;
  setPosition: (value: CardPropertyPosition) => void;
}

const cardPropertyPositionAtom = scopedAtomWithInitializer(appScope, readCardPropertyPosition, {
  debugLabel: "card-property-position",
});

function useCardPropertyPositionInternal(): CardPropertyPositionContextValue {
  const [position, setPositionState] = useScopedAtom(cardPropertyPositionAtom);

  const setPosition = useCallback(
    (value: CardPropertyPosition) => {
      const next = writeCardPropertyPosition(value);
      setPositionState(next);
    },
    [setPositionState],
  );

  return { position, setPosition };
}

export function useCardPropertyPosition(): CardPropertyPositionContextValue {
  return useCardPropertyPositionInternal();
}
