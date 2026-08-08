import type { components } from "./generated";

export const CORE_CLIENT_REQUIREMENTS = {
  "transport": {
    "min": 10,
    "max": 10
  },
  "event_version": 8,
  "modules": [
    {
      "module": "library",
      "contract_version": 20
    },
    {
      "module": "database",
      "contract_version": 20
    },
    {
      "module": "owned_document",
      "contract_version": 7
    },
    {
      "module": "project_workspace",
      "contract_version": 13
    },
    {
      "module": "automation",
      "contract_version": 3
    },
    {
      "module": "store_administration",
      "contract_version": 2
    }
  ],
  "accepted_store_formats": [
    {
      "lineage": "nodex-rust-core",
      "version": 123,
      "schema_fingerprint": "c9393a19379cb238cb806ec0d011e2ca0d95884a53c5844e42f9ffef44b0571f"
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
