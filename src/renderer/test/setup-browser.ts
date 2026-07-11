import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
});
