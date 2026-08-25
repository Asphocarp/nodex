import { initializeRendererDocument } from "./bootstrap/renderer-document";
import { startStartupController } from "./bootstrap/startup-controller";

const isGlobalDictationRenderer = (): boolean =>
  new URLSearchParams(window.location.search).get("initialRoute") === "/global-dictation";

initializeRendererDocument();

if (isGlobalDictationRenderer()) {
  void import("./global-dictation-renderer").then(({ mountGlobalDictationRenderer }) => {
    mountGlobalDictationRenderer();
  });
} else {
  startStartupController();
}
