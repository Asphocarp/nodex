import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup } from "@testing-library/react";

const nativeRequest = Request;
const nativeResponse = Response;
const nativeHeaders = Headers;
const nativeFetch = fetch;
const nativeURL = URL;
const nativeCSS = globalThis.CSS ?? {
  escape(value: string) {
    return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  },
};

GlobalRegistrator.register({
  url: "http://localhost:51283/",
});

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const browserWindow = window;
const browserDocument = document;
const browserWindowApiDescriptor = Object.getOwnPropertyDescriptor(browserWindow, "api");
const browserLocalStorage = localStorage;
const browserSessionStorage = sessionStorage;
const browserNode = globalThis.Node;
const browserElement = globalThis.Element;
const browserHTMLElement = globalThis.HTMLElement;
const browserHTMLDivElement = globalThis.HTMLDivElement;
const browserEvent = globalThis.Event;
const browserKeyboardEvent = globalThis.KeyboardEvent;
const browserMouseEvent = globalThis.MouseEvent;
const browserPointerEvent = globalThis.PointerEvent;
const browserRequestAnimationFrame = globalThis.requestAnimationFrame;
const browserCancelAnimationFrame = globalThis.cancelAnimationFrame;
const browserResizeObserver = globalThis.ResizeObserver;
const browserGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
const browserScrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");

function ensureHtmlDoctype() {
  if (document.doctype?.name.toLowerCase() === "html") return;
  const documentType = document.implementation.createDocumentType("html", "", "");
  document.insertBefore(documentType, document.documentElement);
}

function ensureStandardsMode() {
  if (document.compatMode === "CSS1Compat") return;
  Object.defineProperty(document, "compatMode", {
    configurable: true,
    value: "CSS1Compat",
  });
}

function restoreBrowserGlobals() {
  Object.defineProperty(globalThis, "Request", {
    configurable: true,
    writable: true,
    value: nativeRequest,
  });
  Object.defineProperty(globalThis, "Response", {
    configurable: true,
    writable: true,
    value: nativeResponse,
  });
  Object.defineProperty(globalThis, "Headers", {
    configurable: true,
    writable: true,
    value: nativeHeaders,
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: nativeFetch,
  });
  Object.defineProperty(globalThis, "URL", {
    configurable: true,
    writable: true,
    value: nativeURL,
  });
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    writable: true,
    value: nativeCSS,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: browserWindow,
  });
  if (browserWindowApiDescriptor) {
    Object.defineProperty(browserWindow, "api", browserWindowApiDescriptor);
  } else {
    Reflect.deleteProperty(browserWindow as Window & typeof globalThis & { api?: unknown }, "api");
  }
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: browserDocument,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: browserLocalStorage,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    writable: true,
    value: browserSessionStorage,
  });
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    writable: true,
    value: browserNode,
  });
  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    writable: true,
    value: browserElement,
  });
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    writable: true,
    value: browserHTMLElement,
  });
  Object.defineProperty(globalThis, "HTMLDivElement", {
    configurable: true,
    writable: true,
    value: browserHTMLDivElement,
  });
  Object.defineProperty(globalThis, "Event", {
    configurable: true,
    writable: true,
    value: browserEvent,
  });
  Object.defineProperty(globalThis, "KeyboardEvent", {
    configurable: true,
    writable: true,
    value: browserKeyboardEvent,
  });
  Object.defineProperty(globalThis, "MouseEvent", {
    configurable: true,
    writable: true,
    value: browserMouseEvent,
  });
  if (typeof browserPointerEvent === "undefined") {
    Reflect.deleteProperty(globalThis as typeof globalThis & { PointerEvent?: typeof PointerEvent }, "PointerEvent");
  } else {
    Object.defineProperty(globalThis, "PointerEvent", {
      configurable: true,
      writable: true,
      value: browserPointerEvent,
    });
  }
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: browserRequestAnimationFrame,
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: browserCancelAnimationFrame,
  });
  if (typeof browserResizeObserver === "undefined") {
    Reflect.deleteProperty(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver }, "ResizeObserver");
  } else {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: browserResizeObserver,
    });
  }
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value: browserGetBoundingClientRect,
  });
  if (browserScrollHeightDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", browserScrollHeightDescriptor);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype as HTMLElement & { scrollHeight?: number }, "scrollHeight");
  }
}

restoreBrowserGlobals();
ensureHtmlDoctype();
ensureStandardsMode();

afterEach(() => {
  try {
    cleanup();
  } finally {
    restoreBrowserGlobals();
    ensureHtmlDoctype();
    ensureStandardsMode();
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = "";
  }
});
