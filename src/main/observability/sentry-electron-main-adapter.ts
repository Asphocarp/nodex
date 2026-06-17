import * as Sentry from "@sentry/electron/main";
import type { MainSentryAdapter } from "./sentry-main";

export const electronMainSentryAdapter: MainSentryAdapter = {
  addBreadcrumb: (breadcrumb) => Sentry.addBreadcrumb(breadcrumb),
  captureException: (error, hint) =>
    Sentry.captureException(error, hint as Parameters<typeof Sentry.captureException>[1]),
  captureMessage: (message, hint) =>
    Sentry.captureMessage(message, hint as Parameters<typeof Sentry.captureMessage>[1]),
  close: (timeout) => Sentry.close(timeout),
  init: (options) => Sentry.init(options),
  setTag: (key, value) => Sentry.setTag(key, value),
};
