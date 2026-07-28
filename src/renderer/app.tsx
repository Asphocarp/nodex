import {
  useEffect,
  useState,
} from "react";
import { AppStartupScreen } from "@/components/app-startup-screen";
import { NodexToastProvider } from "@/components/ui/toast";
import { WorkbenchShell } from "@/components/workbench/workbench-shell";
import { LocalConversationProvider } from "@/features/local-conversation";
import { HeartbeatAutomationController } from "@/features/local-conversation/heartbeat-automation-controller";
import { LocalConversationViewStateCleanupController } from "@/features/local-conversation/view/local-conversation-view-state-cleanup-controller";
import { NodexModalHost } from "@/lib/modal-registry";
import { loadProductFeatureGates } from "@/lib/product-feature-gates";
import type { WindowSessionBootstrap } from "@/lib/types";
import { bootstrapWindowSession } from "@/lib/window-sessions";
import type { AppInitializationStep } from "../shared/app-startup";
import {
  DEFAULT_PRODUCT_FEATURE_GATES,
  type ProductFeatureGates,
} from "../shared/product-feature-gates";

const rendererBootstrapStartedAt = performance.now();

interface BootstrapState {
  readonly failed: boolean;
  readonly ready: boolean;
  readonly windowSession: WindowSessionBootstrap | null;
  readonly productFeatureGates: ProductFeatureGates;
  readonly step: AppInitializationStep;
}

const INITIAL_BOOTSTRAP_STATE: BootstrapState = {
  failed: false,
  ready: false,
  windowSession: null,
  productFeatureGates: DEFAULT_PRODUCT_FEATURE_GATES,
  step: { phase: "opening" },
};

export default function App() {
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>(
    INITIAL_BOOTSTRAP_STATE,
  );

  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];

    if (window.api?.onInitializationStep) {
      unsubscribers.push(
        window.api.onInitializationStep((step) => {
          if (cancelled) return;
          setBootstrapState((current) => ({ ...current, step }));
        }),
      );
    }

    const loadBootstrap = () => Promise.all([
      bootstrapWindowSession(),
      loadProductFeatureGates(),
    ] as const);
    const bootstrapPromise = window.api?.awaitInitialization
      ? window.api.awaitInitialization().then(loadBootstrap)
      : loadBootstrap();

    void bootstrapPromise
      .then(([windowSession, productFeatureGates]) => {
        if (cancelled) return;
        window.api?.reportInitializationReady?.({
          durationMs:
            performance.now() - rendererBootstrapStartedAt,
          outcome: "ready",
        });
        setBootstrapState({
          failed: false,
          ready: true,
          windowSession,
          productFeatureGates,
          step: { phase: "done" },
        });
      })
      .catch(() => {
        if (cancelled) return;
        window.api?.reportInitializationReady?.({
          durationMs:
            performance.now() - rendererBootstrapStartedAt,
          outcome: "failed",
        });
        setBootstrapState({
          failed: true,
          ready: false,
          windowSession: null,
          productFeatureGates: DEFAULT_PRODUCT_FEATURE_GATES,
          step: { phase: "failed" },
        });
      });

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  if (!bootstrapState.ready || bootstrapState.failed) {
    return (
      <NodexToastProvider>
        <AppStartupScreen step={bootstrapState.step} />
      </NodexToastProvider>
    );
  }

  if (!bootstrapState.windowSession) {
    return (
      <NodexToastProvider>
        <AppStartupScreen step={{ phase: "failed" }} />
      </NodexToastProvider>
    );
  }

  return (
    <NodexToastProvider>
      <LocalConversationProvider>
        <LocalConversationViewStateCleanupController />
        <HeartbeatAutomationController />
        <WorkbenchShell
          windowSessionBootstrap={bootstrapState.windowSession}
          libraryWorkspaceEnabled={
            bootstrapState.productFeatureGates.libraryWorkspace
          }
        />
        <NodexModalHost />
      </LocalConversationProvider>
    </NodexToastProvider>
  );
}
