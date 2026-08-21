import type { ReactNode } from "react";
import {
  ComposerScope,
  WorkbenchSessionScopePath,
  type ComposerScopeDescriptor,
  type RouteScopeDescriptor,
  type ThreadScopeDescriptor,
} from "@/lib/workbench-ui-scopes";
import { ScopeProvider } from "@/lib/maitai";

const TEST_THREAD_SCOPE: ThreadScopeDescriptor = {
  stableKey: "session:renderer-test",
  phase: "attached",
  projectSessionId: "renderer-test",
  clientThreadId: null,
  threadId: "thread_1",
};

const TEST_ROUTE_SCOPE: RouteScopeDescriptor = {
  routeKey: "/renderer-test/thread_1",
  kind: "thread",
};

const TEST_COMPOSER_SCOPE: ComposerScopeDescriptor = {
  identity: "task:session:renderer-test",
  focusComposerNonce: null,
};

export function TestThreadRouteScopePath({ children }: { readonly children: ReactNode }) {
  return (
    <WorkbenchSessionScopePath thread={TEST_THREAD_SCOPE} route={TEST_ROUTE_SCOPE} selected>
      {children}
    </WorkbenchSessionScopePath>
  );
}

export function TestComposerScopePath({ children }: { readonly children: ReactNode }) {
  return (
    <TestThreadRouteScopePath>
      <ScopeProvider scope={ComposerScope} descriptor={TEST_COMPOSER_SCOPE}>
        {children}
      </ScopeProvider>
    </TestThreadRouteScopePath>
  );
}
