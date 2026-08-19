import type { DataSourcePropertyRecordV2 } from "../../../shared/database-module-v2";
import type { DataSourcePropertyEditorBinding } from "./data-source-property-editor-binding";

/** Lightweight data that is safe to render for every closed Property submenu. */
export interface DataSourcePagePropertyMenuDescriptor {
  readonly property: DataSourcePropertyRecordV2;
  readonly disabled: boolean;
  readonly pending: boolean;
}

/** Resolves the complete editor capabilities only after one Property opens. */
export interface DataSourcePagePropertyMenuSource {
  readonly descriptors: readonly DataSourcePagePropertyMenuDescriptor[];
  resolveBinding(
    propertyId: DataSourcePropertyRecordV2["propertyId"],
  ): DataSourcePropertyEditorBinding;
}

export const dataSourcePagePropertyMenuSourceFromBindings = (
  bindings: readonly DataSourcePropertyEditorBinding[],
): DataSourcePagePropertyMenuSource => {
  const bindingsById = new Map(
    bindings.map((binding) => [binding.property.propertyId, binding]),
  );
  return {
    descriptors: bindings.map((binding) => ({
      property: binding.property,
      disabled: binding.disabled,
      pending: binding.pending ?? false,
    })),
    resolveBinding(propertyId) {
      const binding = bindingsById.get(propertyId);
      if (!binding) throw new Error(`Unknown Property menu binding: ${propertyId}`);
      return binding;
    },
  };
};
