import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type {
  CodexAccountSnapshot,
  CodexRateLimitResetInput,
  CodexRateLimitResetResult,
} from "../../shared/types";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { CodexAccount, CodexAccountLoginInput, CodexAccountLoginResult } from "./CodexAccount";

/** Temporary Promise seam for application callers that have not moved into the Main Effect graph. */
export interface CodexAccountPromiseAdapter {
  readonly refresh: () => Promise<CodexAccountSnapshot>;
  readonly consumeRateLimitResetCredit: (
    input: CodexRateLimitResetInput,
  ) => Promise<CodexRateLimitResetResult>;
  readonly startLogin: (input: CodexAccountLoginInput) => Promise<CodexAccountLoginResult>;
  readonly cancelLogin: (loginId: string) => Promise<{ readonly status: "canceled" | "notFound" }>;
  readonly logout: () => Promise<boolean>;
  readonly subscribe: (listener: (snapshot: CodexAccountSnapshot) => void) => () => void;
}

export const makeCodexAccountPromiseAdapter = (
  account: CodexAccount["Service"],
  callbacks: ScopedCallbackRuntime["Service"],
): CodexAccountPromiseAdapter => ({
  refresh: () => callbacks.runPromise(account.refresh),
  consumeRateLimitResetCredit: (input) =>
    callbacks.runPromise(account.consumeRateLimitResetCredit(input)),
  startLogin: (input) => callbacks.runPromise(account.startLogin(input)),
  cancelLogin: (loginId) => callbacks.runPromise(account.cancelLogin(loginId)),
  logout: () => callbacks.runPromise(account.logout),
  subscribe: (listener) => {
    const fiber = callbacks.fork(
      SubscriptionRef.changes(account.snapshot).pipe(
        Stream.runForEach((snapshot) => Effect.sync(() => listener(snapshot))),
      ),
    );
    return () => {
      if (fiber !== null) callbacks.fork(Fiber.interrupt(fiber));
    };
  },
});
