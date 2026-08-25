const theme = localStorage.getItem("nodex-theme");
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
const root = document.documentElement;
const parameters = new URLSearchParams(window.location.search);
const initialRoute = parameters.get("initialRoute");
const platform = parameters.get("platform") || navigator.platform.toLowerCase();
const isDark = theme === "dark" || (theme !== "light" && prefersDark);

root.classList.toggle("dark", isDark);
root.classList.toggle("electron-dark", isDark);
root.classList.toggle("electron-light", !isDark);
root.classList.toggle("compact-window", initialRoute === "/global-dictation");
root.classList.toggle("hide-startup-shell", initialRoute === "/global-dictation");
root.classList.toggle("electron-opaque", parameters.get("opaqueWindowSurface") === "true");
root.dataset.codexWindowType = "electron";
root.dataset.windowType = "electron";
root.dataset.codexOs = platform.includes("mac")
  ? "mac"
  : platform.includes("win")
    ? "windows"
    : "linux";
root.dataset.codexWindowChrome = root.dataset.codexOs === "mac" ? "overlay" : "native";

window.EXCALIDRAW_ASSET_PATH = new URL("./excalidraw-assets/", window.location.href).href;
