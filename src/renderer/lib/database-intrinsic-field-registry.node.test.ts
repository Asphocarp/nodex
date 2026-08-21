import { describe, expect, test } from "vite-plus/test";

import {
  databaseIntrinsicFieldsForLayout,
  supportedDatabaseIntrinsicFields,
} from "./database-intrinsic-field-registry";

describe("Database intrinsic field registry", () => {
  test("defines one typed capability registry for every supported intrinsic field", () => {
    expect(supportedDatabaseIntrinsicFields()).toEqual(["page_key", "created_at", "updated_at"]);
  });

  test("exposes semantic labels and layout capabilities", () => {
    expect(databaseIntrinsicFieldsForLayout("board")).toMatchObject([
      { field: "page_key", label: "ID", slot: "identity" },
      { field: "created_at", label: "Created", slot: "metadata" },
      { field: "updated_at", label: "Updated", slot: "metadata" },
    ]);
    expect(databaseIntrinsicFieldsForLayout("list")).toMatchObject([
      { field: "page_key", label: "ID", slot: "identity" },
      { field: "created_at", label: "Created", slot: "metadata" },
      { field: "updated_at", label: "Updated", slot: "metadata" },
    ]);
  });
});
