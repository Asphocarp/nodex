import { persistedAtom } from "@/lib/maitai";

export type ComposerModelPickerView = "simple" | "advanced";

export const COMPOSER_MODEL_PICKER_VIEW_STORAGE_KEY =
  "composer-model-picker-menu-view-v1";

export const composerModelPickerViewAtom = persistedAtom<ComposerModelPickerView>({
  debugLabel: "composer-model-picker-view",
  storageKey: COMPOSER_MODEL_PICKER_VIEW_STORAGE_KEY,
  defaultValue: "simple",
  hydration: "eager",
  synchronization: "cross-window",
  optimistic: true,
  writeFailure: "rollback",
  decode: (value) => value === "advanced" ? "advanced" : "simple",
});
