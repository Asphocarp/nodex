import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Agentation } from "agentation";
import App from "./app";
import { AppProviders, initializeRendererDocument } from "./app-providers";
import { initializeElectronRendererLocalCommitIngress } from "./lib/electron-renderer-transport";
import { initializeRendererSentry } from "./lib/sentry-renderer";
import { initializeRendererTelemetry } from "./lib/statsig-telemetry";

async function startRenderer(): Promise<void> {
  if (!window.api) {
    throw new Error("Nodex renderer requires the Electron preload bridge");
  }
  initializeElectronRendererLocalCommitIngress(window.api);
  await initializeRendererSentry();
  void initializeRendererTelemetry();
  initializeRendererDocument();

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppProviders>
        <App />
        {import.meta.env.DEV ? <Agentation /> : null}
      </AppProviders>
    </StrictMode>,
  );
}

void startRenderer();
