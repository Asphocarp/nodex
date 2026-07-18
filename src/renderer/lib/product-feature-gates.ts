import {
  DEFAULT_PRODUCT_FEATURE_GATES,
  parseProductFeatureGates,
  type ProductFeatureGates,
} from "../../shared/product-feature-gates";
import { invoke } from "./api";

export async function loadProductFeatureGates(): Promise<ProductFeatureGates> {
  try {
    return parseProductFeatureGates(await invoke("app:feature-gates:get"));
  } catch {
    return DEFAULT_PRODUCT_FEATURE_GATES;
  }
}
