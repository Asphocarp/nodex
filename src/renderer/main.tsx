import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Agentation } from "agentation";
import App from "./app";
import { AppProviders, initializeRendererDocument } from "./app-providers";
import { initializeRendererSentry } from "./lib/sentry-renderer";

async function startRenderer(): Promise<void> {
  await initializeRendererSentry();
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
