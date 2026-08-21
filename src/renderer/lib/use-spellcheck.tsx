import { useCallback } from "react";
import { appScope, scopedAtomWithInitializer, useScopedAtom } from "./maitai";

interface SpellcheckContextValue {
  spellcheck: boolean;
  toggleSpellcheck: () => void;
}

const STORAGE_KEY = "nodex-spellcheck";

const spellcheckAtom = scopedAtomWithInitializer(
  appScope,
  () => localStorage.getItem(STORAGE_KEY) !== "false",
  { debugLabel: "spellcheck" },
);

function useSpellcheckInternal(): SpellcheckContextValue {
  const [spellcheck, setSpellcheck] = useScopedAtom(spellcheckAtom);

  const toggleSpellcheck = useCallback(() => {
    setSpellcheck((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
      return next;
    });
  }, [setSpellcheck]);

  return { spellcheck, toggleSpellcheck };
}

export function useSpellcheck(): SpellcheckContextValue {
  return useSpellcheckInternal();
}
