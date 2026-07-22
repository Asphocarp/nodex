import type { components } from "./generated";

export const CORE_CLIENT_REQUIREMENTS = {
  "transport": {
    "min": 3,
    "max": 3
  },
  "event_version": 2,
  "modules": [
    {
      "module": "library",
      "contract_version": 1
    },
    {
      "module": "database",
      "contract_version": 2
    },
    {
      "module": "owned_document",
      "contract_version": 1
    },
    {
      "module": "project_workspace",
      "contract_version": 3
    },
    {
      "module": "automation",
      "contract_version": 1
    },
    {
      "module": "store_administration",
      "contract_version": 1
    }
  ],
  "accepted_store_formats": [
    {
      "lineage": "nodex-rust-core",
      "version": 89,
      "schema_fingerprint": "6e0e0883d80699deddbbc2e857212b048c9ddd58639c1260e993ac429ef2424f"
    }
  ]
} as const satisfies components["schemas"]["CoreClientRequirements"];
