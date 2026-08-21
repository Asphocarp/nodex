import { useCallback } from "react";
import {
  readPageStageCollapsedProperties,
  togglePageStageCollapsedProperty,
  writePageStageCollapsedProperties,
  type PageStageCollapsibleProperty,
} from "./page-stage-collapsed-properties";
import { appScope, scopedAtomWithInitializer, useScopedAtom } from "./maitai";

interface PageStageCollapsedPropertiesContextValue {
  collapsedProperties: PageStageCollapsibleProperty[];
  setCollapsedProperties: (value: PageStageCollapsibleProperty[]) => void;
  toggleCollapsedProperty: (value: PageStageCollapsibleProperty) => void;
}

const pageStageCollapsedPropertiesAtom = scopedAtomWithInitializer(
  appScope,
  readPageStageCollapsedProperties,
  { debugLabel: "page-stage-collapsed-properties" },
);

function usePageStageCollapsedPropertiesInternal(): PageStageCollapsedPropertiesContextValue {
  const [collapsedProperties, setCollapsedPropertiesState] = useScopedAtom(
    pageStageCollapsedPropertiesAtom,
  );

  const setCollapsedProperties = useCallback(
    (value: PageStageCollapsibleProperty[]) => {
      const next = writePageStageCollapsedProperties(value);
      setCollapsedPropertiesState(next);
    },
    [setCollapsedPropertiesState],
  );

  const toggleCollapsedProperty = useCallback(
    (value: PageStageCollapsibleProperty) => {
      setCollapsedPropertiesState((current) => {
        const next = togglePageStageCollapsedProperty(current, value);
        writePageStageCollapsedProperties(next);
        return next;
      });
    },
    [setCollapsedPropertiesState],
  );

  return {
    collapsedProperties,
    setCollapsedProperties,
    toggleCollapsedProperty,
  };
}

export function usePageStageCollapsedProperties(): PageStageCollapsedPropertiesContextValue {
  return usePageStageCollapsedPropertiesInternal();
}
