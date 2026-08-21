import { createContext, useCallback, useContext, type ReactNode } from "react";
import { DEFAULT_FILE_LINK_OPENER_ID, type FileLinkOpenerId } from "../../shared/file-link-openers";
import { readFileLinkOpener, writeFileLinkOpener } from "./file-link-opener-settings";
import { appScope, scopedAtomWithInitializer, useScopedAtom } from "./maitai";

interface FileLinkOpenerContextValue {
  opener: FileLinkOpenerId;
  setOpener: (value: FileLinkOpenerId) => void;
}

const FileLinkOpenerContext = createContext<FileLinkOpenerContextValue>({
  opener: DEFAULT_FILE_LINK_OPENER_ID,
  setOpener: () => undefined,
});

const fileLinkOpenerAtom = scopedAtomWithInitializer(appScope, readFileLinkOpener, {
  debugLabel: "file-link-opener",
});

function useFileLinkOpenerInternal(): FileLinkOpenerContextValue {
  const [opener, setOpenerState] = useScopedAtom(fileLinkOpenerAtom);

  const setOpener = useCallback(
    (value: FileLinkOpenerId) => {
      const next = writeFileLinkOpener(value);
      setOpenerState(next);
    },
    [setOpenerState],
  );

  return { opener, setOpener };
}

/**
 * Keeps the configured desktop opener available to settings and explicit
 * external actions. File references themselves are routed by the semantic
 * router so ordinary in-app links never pass through a document-level bridge.
 */
export function FileLinkOpenerProvider({ children }: { children: ReactNode }) {
  const value = useFileLinkOpenerInternal();
  return <FileLinkOpenerContext.Provider value={value}>{children}</FileLinkOpenerContext.Provider>;
}

export function useFileLinkOpener(): FileLinkOpenerContextValue {
  return useContext(FileLinkOpenerContext);
}
