import { invoke } from "./api";

export { invoke };

export function readAppCloseBridge(): Window["api"] | null {
  if (typeof window === "undefined") return null;
  return window.api ?? null;
}
