import { z } from "zod";

export interface ProductFeatureGates {
  readonly libraryWorkspace: boolean;
}

export const ProductFeatureGatesSchema = z.object({
  libraryWorkspace: z.boolean(),
}).strict() satisfies z.ZodType<ProductFeatureGates>;

export const DEFAULT_PRODUCT_FEATURE_GATES: ProductFeatureGates = Object.freeze({
  libraryWorkspace: false,
});

export function parseProductFeatureGates(value: unknown): ProductFeatureGates {
  return ProductFeatureGatesSchema.parse(value);
}
