import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GlobalDictationRoot } from "./features/dictation/global-dictation-page";
import "./globals.css";

const isGlobalDictationRenderer = (): boolean =>
  new URLSearchParams(window.location.search).get("initialRoute") === "/global-dictation";

async function startRenderer(): Promise<void> {
  const root = createRoot(document.getElementById("root")!);
  if (isGlobalDictationRenderer()) {
    if (!window.globalDictation) {
      throw new Error("Global dictation requires its restricted Electron preload bridge");
    }
    document.documentElement.classList.add("compact-window");
    root.render(
      <StrictMode>
        <GlobalDictationRoot />
      </StrictMode>,
    );
    return;
  }
  if (!window.api) {
    throw new Error("Nodex renderer requires the Electron preload bridge");
  }
  const [
    { default: App },
    { AppProviders, initializeRendererDocument },
    { initializeElectronRendererLocalCommitIngress },
    { initializeRendererSentry },
    { initializeRendererTelemetry },
    { Agentation },
  ] = await Promise.all([
    import("./app"),
    import("./app-providers"),
    import("./lib/electron-renderer-transport"),
    import("./lib/sentry-renderer"),
    import("./lib/statsig-telemetry"),
    import("agentation"),
  ]);
  initializeElectronRendererLocalCommitIngress(window.api);
  await initializeRendererSentry();
  void initializeRendererTelemetry();
  initializeRendererDocument();

  root.render(
    <StrictMode>
      <AppProviders>
        <App />
        {import.meta.env.DEV ? <Agentation /> : null}
      </AppProviders>
    </StrictMode>,
  );
}

void startRenderer();
