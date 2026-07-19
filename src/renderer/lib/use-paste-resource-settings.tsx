import { useCallback } from "react";
import {
  readPasteResourceSettings,
  writePasteResourceSettings,
  type PasteResourceSettings,
} from "./paste-resource-settings";
import {
  appScope,
  scopedAtomWithInitializer,
  useScopedAtom,
} from "./maitai";

interface PasteResourceSettingsContextValue {
  settings: PasteResourceSettings;
  setSettings: (value: PasteResourceSettings) => void;
  updateSettings: (patch: Partial<PasteResourceSettings>) => void;
}

const pasteResourceSettingsAtom = scopedAtomWithInitializer(
  appScope,
  readPasteResourceSettings,
  { debugLabel: "paste-resource-settings" },
);

function usePasteResourceSettingsInternal(): PasteResourceSettingsContextValue {
  const [settings, setSettingsState] = useScopedAtom(pasteResourceSettingsAtom);

  const setSettings = useCallback((value: PasteResourceSettings) => {
    const next = writePasteResourceSettings(value);
    setSettingsState(next);
  }, [setSettingsState]);

  const updateSettings = useCallback((patch: Partial<PasteResourceSettings>) => {
    setSettingsState((current) => {
      const next = writePasteResourceSettings({
        ...current,
        ...patch,
      });
      return next;
    });
  }, [setSettingsState]);

  return { settings, setSettings, updateSettings };
}

export function usePasteResourceSettings(): PasteResourceSettingsContextValue {
  return usePasteResourceSettingsInternal();
}
