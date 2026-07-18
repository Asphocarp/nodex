import { describe, expect, test } from "vitest";

import { DEFAULT_PRODUCT_FEATURE_GATES } from "../shared/product-feature-gates";
import { resolveProductFeatureGates } from "./product-feature-gates";

describe("product feature gates", () => {
  test("keeps the Library workspace closed by default", () => {
    expect(resolveProductFeatureGates({})).toEqual(DEFAULT_PRODUCT_FEATURE_GATES);
  });

  test.each(["1", "true", "TRUE", "yes", "on"])(
    "enables the Library workspace for %s",
    (value) => {
      expect(resolveProductFeatureGates({
        NODEX_LIBRARY_WORKSPACE_ENABLED: value,
      })).toEqual({ libraryWorkspace: true });
    },
  );

  test.each(["0", "false", "off", "no", "unexpected"])(
    "fails closed for %s",
    (value) => {
      expect(resolveProductFeatureGates({
        NODEX_LIBRARY_WORKSPACE_ENABLED: value,
      })).toEqual({ libraryWorkspace: false });
    },
  );
});
