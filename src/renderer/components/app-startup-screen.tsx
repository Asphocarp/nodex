import { useEffect, useState } from "react";
import type { AppInitializationStep } from "../../shared/app-startup";
import { getStartupStatus } from "../lib/app-startup";
import { NodexLogoShimmer } from "./ui/nodex-logo-shimmer";

const OPENING_COPY_DELAY_MS = 1800;

export interface AppStartupScreenProps {
  step: AppInitializationStep;
}

export function AppStartupScreen({ step }: AppStartupScreenProps) {
  const [openingDelayElapsed, setOpeningDelayElapsed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOpeningDelayElapsed(true);
    }, OPENING_COPY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const status = getStartupStatus(step);
  if (step.phase === "failed") {
    return (
      <main className="flex h-screen items-center justify-center bg-token-main-surface-primary px-8 text-token-foreground">
        <div className="max-w-sm text-center" role="alert">
          <h1 className="text-base font-medium">Nodex could not finish opening</h1>
          <p className="mt-2 text-sm text-token-description-foreground">
            Restart Nodex to try again.
          </p>
        </div>
      </main>
    );
  }

  const showVisibleCopy = step.phase === "migrating" || openingDelayElapsed;

  return (
    <main
      aria-live="polite"
      className="flex h-screen items-center justify-center bg-token-main-surface-primary text-token-foreground"
      role="status"
    >
      <span className="sr-only">{status}</span>
      <div className="flex flex-col items-center gap-3">
        <NodexLogoShimmer className="size-16" />
        {showVisibleCopy ? (
          <p aria-hidden="true" className="text-sm text-token-description-foreground">
            {status}
          </p>
        ) : null}
      </div>
    </main>
  );
}
