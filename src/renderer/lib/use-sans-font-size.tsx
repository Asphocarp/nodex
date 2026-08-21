import { useCallback, useLayoutEffect, type ReactNode } from "react";
import {
  applySansFontSizeRootVariables,
  readSansFontSize,
  writeSansFontSize,
} from "./sans-font-size";
import { appScope, scopedAtomWithInitializer, useScopedAtom } from "./maitai";

interface SansFontSizeContextValue {
  sansFontSize: number;
  setSansFontSize: (value: number) => void;
}

const sansFontSizeAtom = scopedAtomWithInitializer(appScope, readSansFontSize, {
  debugLabel: "sans-font-size",
});

function useSansFontSizeInternal(): SansFontSizeContextValue {
  const [sansFontSize, setSansFontSizeState] = useScopedAtom(sansFontSizeAtom);

  const setSansFontSize = useCallback(
    (value: number) => {
      const normalized = writeSansFontSize(value);
      setSansFontSizeState(normalized);
    },
    [setSansFontSizeState],
  );

  return { sansFontSize, setSansFontSize };
}

export function SansFontSizeProvider({ children }: { children: ReactNode }) {
  const value = useSansFontSizeInternal();
  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    applySansFontSizeRootVariables(document.documentElement, value.sansFontSize);
  }, [value.sansFontSize]);
  return children;
}

export function useSansFontSize(): SansFontSizeContextValue {
  return useSansFontSizeInternal();
}
