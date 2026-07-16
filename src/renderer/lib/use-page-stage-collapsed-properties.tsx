import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import {
  readPageStageCollapsedProperties,
  togglePageStageCollapsedProperty,
  writePageStageCollapsedProperties,
  type PageStageCollapsibleProperty,
} from "./page-stage-collapsed-properties";

interface PageStageCollapsedPropertiesContextValue {
  collapsedProperties: PageStageCollapsibleProperty[];
  setCollapsedProperties: (value: PageStageCollapsibleProperty[]) => void;
  toggleCollapsedProperty: (value: PageStageCollapsibleProperty) => void;
}

const PageStageCollapsedPropertiesContext = createContext<PageStageCollapsedPropertiesContextValue>({
  collapsedProperties: readPageStageCollapsedProperties(),
  setCollapsedProperties: () => {},
  toggleCollapsedProperty: () => {},
});

function usePageStageCollapsedPropertiesInternal(): PageStageCollapsedPropertiesContextValue {
  const [collapsedProperties, setCollapsedPropertiesState] = useState<PageStageCollapsibleProperty[]>(() =>
    readPageStageCollapsedProperties(),
  );

  const setCollapsedProperties = useCallback((value: PageStageCollapsibleProperty[]) => {
    const next = writePageStageCollapsedProperties(value);
    setCollapsedPropertiesState(next);
  }, []);

  const toggleCollapsedProperty = useCallback((value: PageStageCollapsibleProperty) => {
    setCollapsedPropertiesState((current) => {
      const next = togglePageStageCollapsedProperty(current, value);
      writePageStageCollapsedProperties(next);
      return next;
    });
  }, []);

  return {
    collapsedProperties,
    setCollapsedProperties,
    toggleCollapsedProperty,
  };
}

export function PageStageCollapsedPropertiesProvider({ children }: { children: ReactNode }) {
  const value = usePageStageCollapsedPropertiesInternal();

  return (
    <PageStageCollapsedPropertiesContext.Provider value={value}>
      {children}
    </PageStageCollapsedPropertiesContext.Provider>
  );
}

export function usePageStageCollapsedProperties(): PageStageCollapsedPropertiesContextValue {
  return useContext(PageStageCollapsedPropertiesContext);
}
