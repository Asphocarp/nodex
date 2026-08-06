/**
 * Agent destinations are resolved against a canonical BlockRecord window
 * before a command is published. The anchor remains an input concern here;
 * the preparation layer turns it into a stable `before*` identity.
 */
export type AgentSiblingAnchor =
  | { readonly kind: "start" | "end" }
  | { readonly kind: "before" | "after"; readonly blockId: string };

export type AgentPageDestination =
  | {
      readonly kind: "library";
      readonly at?: AgentSiblingAnchor;
    }
  | {
      readonly kind: "page";
      readonly pageId: string;
      readonly at?: AgentSiblingAnchor;
    }
  | {
      readonly kind: "data_source";
      readonly dataSourceId: string;
      readonly values?: readonly {
        readonly propertyId: string;
        readonly value: unknown;
      }[];
      readonly view?: {
        readonly viewId: string;
        readonly groupKey?: string | null;
        readonly at?: AgentSiblingAnchor;
      };
    };
