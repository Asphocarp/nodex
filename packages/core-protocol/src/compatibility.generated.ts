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
      "contract_version": 4
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
      "version": 90,
      "schema_fingerprint": "5ed6a9baa72223aae5fae81c92b335f7df976cd6cc676a61d4416a636de362ce"
    }
  ]
} as const satisfies components["schemas"]["CoreClientRequirements"];
