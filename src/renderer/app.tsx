import {
  useEffect,
  useState,
} from "react";
import { AppStartupScreen } from "@/components/app-startup-screen";
import { CoreAuthorityStatusNotice } from "@/components/core-authority-status";
import { NodexToastProvider } from "@/components/ui/toast";
import { WorkbenchShell } from "@/components/workbench/workbench-shell";
import { AppUpdateRestartNotice } from "@/components/workbench/app-update-restart-notice";
import { LocalConversationProvider } from "@/features/local-conversation";
import { HeartbeatAutomationController } from "@/features/local-conversation/heartbeat-automation-controller";
import { DesktopNotificationPermissionBootstrap } from "@/features/local-conversation/desktop-notification-permission-bootstrap";
import { LocalConversationViewStateCleanupController } from "@/features/local-conversation/view/local-conversation-view-state-cleanup-controller";
import { NodexModalHost } from "@/lib/modal-registry";
import { loadProductFeatureGates } from "@/lib/product-feature-gates";
import type { WindowSessionBootstrap } from "@/lib/types";
import { bootstrapWindowSession } from "@/lib/window-sessions";
import type { AppInitializationStep } from "../shared/app-startup";
import type { CoreAuthorityStatus } from "../shared/core-authority-status";
import {
  DEFAULT_PRODUCT_FEATURE_GATES,
  type ProductFeatureGates,
} from "../shared/product-feature-gates";
import { useAppUpdateStatus } from "./app-providers";
import { invoke } from "./lib/api";

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

const READY_CORE_AUTHORITY_STATUS = { kind: "ready" } as const;
const CORE_RECOVERY_NOTICE_DELAY_MS = 1_500;

export default function App() {
  const appUpdateStatus = useAppUpdateStatus();
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null);
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>(
    INITIAL_BOOTSTRAP_STATE,
  );
  const [coreAuthorityStatus, setCoreAuthorityStatus] =
    useState<CoreAuthorityStatus>(READY_CORE_AUTHORITY_STATUS);
  const [showRecoveringCoreAuthority, setShowRecoveringCoreAuthority] =
    useState(false);

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

  useEffect(() => {
    if (coreAuthorityStatus.kind !== "recovering") {
      setShowRecoveringCoreAuthority(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setShowRecoveringCoreAuthority(true);
    }, CORE_RECOVERY_NOTICE_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [coreAuthorityStatus.kind]);

  useEffect(() => {
    let cancelled = false;
    let observedPush = false;
    const unsubscribe = window.api?.onCoreAuthorityStatus?.((status) => {
      if (cancelled) return;
      observedPush = true;
      setCoreAuthorityStatus(status);
    });
    const statusSnapshot = window.api?.getCoreAuthorityStatus?.();
    if (statusSnapshot) {
      void statusSnapshot.then((status) => {
        if (cancelled || observedPush) return;
        setCoreAuthorityStatus(status);
      }).catch(() => undefined);
    }
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const retryCoreAuthority = (): void => {
    void window.api?.retryCoreAuthority?.().catch(() => undefined);
  };

  const relaunchForCoreAuthority = (): void => {
    void window.api?.relaunchForCoreAuthority?.().catch(() => undefined);
  };

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
        <DesktopNotificationPermissionBootstrap />
        <LocalConversationViewStateCleanupController />
        <HeartbeatAutomationController />
        <WorkbenchShell
          windowSessionBootstrap={bootstrapState.windowSession}
          libraryWorkspaceEnabled={
            bootstrapState.productFeatureGates.libraryWorkspace
          }
        />
        <CoreAuthorityStatusNotice
          status={
            coreAuthorityStatus.kind === "recovering"
              && !showRecoveringCoreAuthority
              ? READY_CORE_AUTHORITY_STATUS
              : coreAuthorityStatus
          }
          onRetry={retryCoreAuthority}
          onRelaunch={relaunchForCoreAuthority}
        />
        {appUpdateStatus?.status === "downloaded"
          && dismissedUpdateVersion !== appUpdateStatus.availableVersion ? (
            <div className="pointer-events-none fixed inset-x-3 bottom-14 z-[61] flex justify-center">
              <div className="pointer-events-auto">
                <AppUpdateRestartNotice
                  status={appUpdateStatus}
                  onDismiss={() => {
                    setDismissedUpdateVersion(appUpdateStatus.availableVersion);
                  }}
                  onRestart={() => {
                    void invoke("app:update:install");
                  }}
                />
              </div>
            </div>
          ) : null}
        <NodexModalHost />
      </LocalConversationProvider>
    </NodexToastProvider>
  );
}
