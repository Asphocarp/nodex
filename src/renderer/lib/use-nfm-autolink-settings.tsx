import { useCallback } from "react";
import {
  readNfmAutolinkSettings,
  writeNfmAutolinkSettings,
  type NfmAutolinkSettings,
} from "./nfm-autolink-settings";
import { appScope, scopedAtomWithInitializer, useScopedAtom } from "./maitai";

interface NfmAutolinkSettingsContextValue {
  settings: NfmAutolinkSettings;
  setSettings: (value: NfmAutolinkSettings) => void;
  updateSettings: (patch: Partial<NfmAutolinkSettings>) => void;
}

const nfmAutolinkSettingsAtom = scopedAtomWithInitializer(appScope, readNfmAutolinkSettings, {
  debugLabel: "nfm-autolink-settings",
});

function useNfmAutolinkSettingsInternal(): NfmAutolinkSettingsContextValue {
  const [settings, setSettingsState] = useScopedAtom(nfmAutolinkSettingsAtom);

  const setSettings = useCallback(
    (value: NfmAutolinkSettings) => {
      const next = writeNfmAutolinkSettings(value);
      setSettingsState(next);
    },
    [setSettingsState],
  );

  const updateSettings = useCallback(
    (patch: Partial<NfmAutolinkSettings>) => {
      setSettingsState((current) => {
        const next = writeNfmAutolinkSettings({
          ...current,
          ...patch,
        });
        return next;
      });
    },
    [setSettingsState],
  );

  return { settings, setSettings, updateSettings };
}

export function useNfmAutolinkSettings(): NfmAutolinkSettingsContextValue {
  return useNfmAutolinkSettingsInternal();
}
