import {
  DEFAULT_PRODUCT_FEATURE_GATES,
  type ProductFeatureGates,
} from "../shared/product-feature-gates";

const ENABLED_ENV_VALUES = new Set(["1", "true", "yes", "on"]);

export function resolveProductFeatureGates(
  env: Readonly<Record<string, string | undefined>>,
): ProductFeatureGates {
  const libraryWorkspaceValue = env.NODEX_LIBRARY_WORKSPACE_ENABLED
    ?.trim()
    .toLowerCase();

  if (!libraryWorkspaceValue) return DEFAULT_PRODUCT_FEATURE_GATES;

  return Object.freeze({
    libraryWorkspace: ENABLED_ENV_VALUES.has(libraryWorkspaceValue),
  });
}

export const productFeatureGates = resolveProductFeatureGates(process.env);
