const theme = localStorage.getItem("nodex-theme");
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
if (theme === "dark" || (theme !== "light" && prefersDark)) {
  document.documentElement.classList.add("dark");
}

window.EXCALIDRAW_ASSET_PATH = new URL("./excalidraw-assets/", window.location.href).href;
