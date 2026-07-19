import {
  useCallback,
  useLayoutEffect,
  type ReactNode,
} from "react";
import {
  applyCodeFontSizeRootVariable,
  readCodeFontSize,
  writeCodeFontSize,
} from "./code-font-size";
import {
  appScope,
  scopedAtomWithInitializer,
  useScopedAtom,
} from "./maitai";

interface CodeFontSizeContextValue {
  codeFontSize: number;
  setCodeFontSize: (value: number) => void;
}

const codeFontSizeAtom = scopedAtomWithInitializer(
  appScope,
  readCodeFontSize,
  { debugLabel: "code-font-size" },
);

function useCodeFontSizeInternal(): CodeFontSizeContextValue {
  const [codeFontSize, setCodeFontSizeState] = useScopedAtom(codeFontSizeAtom);

  const setCodeFontSize = useCallback((value: number) => {
    const normalized = writeCodeFontSize(value);
    setCodeFontSizeState(normalized);
  }, [setCodeFontSizeState]);

  return { codeFontSize, setCodeFontSize };
}

export function CodeFontSizeProvider({ children }: { children: ReactNode }) {
  const value = useCodeFontSizeInternal();
  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    applyCodeFontSizeRootVariable(document.documentElement, value.codeFontSize);
  }, [value.codeFontSize]);
  return children;
}

export function useCodeFontSize(): CodeFontSizeContextValue {
  return useCodeFontSizeInternal();
}
