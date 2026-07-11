import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export function createRendererVitePlugins() {
  return [react()];
}

export const rendererViteResolve = {
  alias: {
    "@": resolve(process.cwd(), "src/renderer"),
  },
};

export const rendererViteCss = {
  postcss: {
    plugins: [tailwindcss],
  },
};
