import type { components } from "./generated";

export const CORE_CLIENT_REQUIREMENTS = {
  "transport": {
    "min": 7,
    "max": 7
  },
  "event_version": 7,
  "modules": [
    {
      "module": "library",
      "contract_version": 10
    },
    {
      "module": "database",
      "contract_version": 6
    },
    {
      "module": "owned_document",
      "contract_version": 6
    },
    {
      "module": "project_workspace",
      "contract_version": 10
    },
    {
      "module": "automation",
      "contract_version": 2
    },
    {
      "module": "store_administration",
      "contract_version": 2
    }
  ],
  "accepted_store_formats": [
    {
      "lineage": "nodex-rust-core",
      "version": 110,
      "schema_fingerprint": "ade5dc21d9e4c86bc66e7d72f99f7f8b359e30189d7b1f6747c322bd88145af6"
    }
  ]
} as const satisfies components["schemas"]["CoreClientRequirements"];

export const CORE_TRANSPORT_BUDGETS = {
  "ordinary_json_request_bytes": 2097152,
  "ordinary_json_response_bytes": 16777216,
  "event_frame_bytes": 2359296,
  "document_json_request_bytes": 67108864,
  "document_response_bytes": 25165832
} as const satisfies components["schemas"]["CoreTransportBudgets"];
