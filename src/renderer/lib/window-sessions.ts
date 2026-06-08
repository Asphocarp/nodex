import { invoke } from "./api";
import type {
  WindowSessionBootstrap,
  WindowSessionBounds,
  WorkbenchLayoutSnapshot,
} from "./types";

export async function bootstrapWindowSession(): Promise<WindowSessionBootstrap> {
  return (await invoke("window-sessions:bootstrap")) as WindowSessionBootstrap;
}

export async function saveWindowSessionLayout(
  layout: WorkbenchLayoutSnapshot,
): Promise<WindowSessionBootstrap> {
  return (await invoke("window-sessions:save-layout", layout)) as WindowSessionBootstrap;
}

export async function updateWindowSessionBounds(bounds: WindowSessionBounds): Promise<void> {
  await invoke("window-sessions:update-bounds", bounds);
}
