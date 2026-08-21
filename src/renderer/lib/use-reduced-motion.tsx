import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  readReducedMotionPreference,
  resolveReducedMotionPreference,
  writeReducedMotionPreference,
  type ReducedMotionPreference,
} from "./reduced-motion";
import {
  appScope,
  atomWithExternalStore,
  scopedAtomWithInitializer,
  useScopedAtom,
  useScopedAtomValue,
} from "./maitai";

const REDUCED_MOTION_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

const ReducedMotionContext = createContext<boolean | null>(null);
const subscribeToNothing = () => () => undefined;
const readMotionAllowedFallback = () => false;

function getSystemReducedMotionSnapshot(): boolean {
  return globalThis.matchMedia?.(REDUCED_MOTION_MEDIA_QUERY).matches ?? false;
}

function subscribeSystemReducedMotion(listener: () => void): () => void {
  const mediaQuery = globalThis.matchMedia?.(REDUCED_MOTION_MEDIA_QUERY);
  if (!mediaQuery) return () => undefined;
  mediaQuery.addEventListener("change", listener);
  return () => mediaQuery.removeEventListener("change", listener);
}

const reducedMotionPreferenceAtom = scopedAtomWithInitializer<ReducedMotionPreference>(
  appScope,
  readReducedMotionPreference,
  { debugLabel: "reduced-motion-preference" },
);

const systemReducedMotionAtom = atomWithExternalStore(appScope, {
  debugLabel: "system-reduced-motion-preference",
  getSnapshot: getSystemReducedMotionSnapshot,
  subscribe: subscribeSystemReducedMotion,
});

export interface ReducedMotionPreferenceValue {
  preference: ReducedMotionPreference;
  resolved: boolean;
  setPreference: (preference: ReducedMotionPreference) => void;
}

export function useReducedMotionPreference(): ReducedMotionPreferenceValue {
  const [preference, setPreferenceState] = useScopedAtom(reducedMotionPreferenceAtom);
  const systemReducedMotion = useScopedAtomValue(systemReducedMotionAtom);
  const resolved = resolveReducedMotionPreference(preference, systemReducedMotion);

  const setPreference = useCallback(
    (nextPreference: ReducedMotionPreference) => {
      setPreferenceState(writeReducedMotionPreference(nextPreference));
    },
    [setPreferenceState],
  );

  return { preference, resolved, setPreference };
}

export function useResolvedReducedMotion(): boolean {
  const resolvedPreference = useContext(ReducedMotionContext);
  const needsSystemFallback = resolvedPreference === null;
  const systemReducedMotion = useSyncExternalStore(
    needsSystemFallback ? subscribeSystemReducedMotion : subscribeToNothing,
    needsSystemFallback ? getSystemReducedMotionSnapshot : readMotionAllowedFallback,
    readMotionAllowedFallback,
  );
  return resolvedPreference ?? systemReducedMotion;
}

/** Keeps the OS media subscription alive at app scope before motion consumers mount. */
export function ReducedMotionProvider({ children }: { children: ReactNode }) {
  const { resolved } = useReducedMotionPreference();
  return <ReducedMotionContext.Provider value={resolved}>{children}</ReducedMotionContext.Provider>;
}
