import type Database from "better-sqlite3";

import type {
  PageLifecycleMutationReceiptV2,
  PageLifecycleMutationRequestV2,
} from "../../shared/page-lifecycle-v2";
import type { PageLifecycleCreateDisplayIntent } from "../../shared/page-lifecycle-v2-runtime";
import { compilePageLifecycleCreateRequestV2InDatabase } from "./page-lifecycle-v2-compiler";
import { applyPageLifecycleMutationV2 } from "./page-lifecycle-v2-store";

const unwrapReceipt = (
  result: ReturnType<typeof applyPageLifecycleMutationV2>,
): PageLifecycleMutationReceiptV2 => {
  if (result.ok) return result.value;
  throw new Error(result.error.message);
};

/** Test-only fixture helper that exercises the active schema-v81 authority. */
export const createPageLifecycleV2Fixture = (
  database: Database.Database,
  intent: PageLifecycleCreateDisplayIntent,
): PageLifecycleMutationReceiptV2 =>
  unwrapReceipt(
    applyPageLifecycleMutationV2(
      database,
      compilePageLifecycleCreateRequestV2InDatabase(database, intent),
    ),
  );

/** Test-only fixture helper for already authority-ready lifecycle operations. */
export const applyPageLifecycleV2Fixture = (
  database: Database.Database,
  request: PageLifecycleMutationRequestV2,
): PageLifecycleMutationReceiptV2 =>
  unwrapReceipt(applyPageLifecycleMutationV2(database, request));
