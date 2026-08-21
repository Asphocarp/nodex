import type { components } from "./generated";

export const CORE_CLIENT_REQUIREMENTS = {
  "transport": {
    "min": 11,
    "max": 11
  },
  "event_version": 8,
  "modules": [
    {
      "module": "library",
      "contract_version": 32
    },
    {
      "module": "database",
      "contract_version": 20
    },
    {
      "module": "owned_document",
      "contract_version": 8
    },
    {
      "module": "project_workspace",
      "contract_version": 15
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
      "version": 132,
      "schema_fingerprint": "4d8a73cef28f743faea9c5718ca7eaae90c4f6473895a3fd872a7cb75e870e90"
    }
  ]
} as const satisfies components["schemas"]["CoreClientRequirements"];

export const CORE_TRANSPORT_BUDGETS = {
  "ordinary_json_request_bytes": 2097152,
  "ordinary_json_response_bytes": 16777216,
  "event_frame_bytes": 2359296,
  "document_json_request_bytes": 67108864,
  "document_response_bytes": 25165832,
  "request_deadline_min_ms": 250,
  "request_deadline_max_ms": 300000,
  "interactive_request_deadline_ms": 20000,
  "background_request_deadline_ms": 60000,
  "maintenance_request_deadline_ms": 120000
} as const satisfies components["schemas"]["CoreTransportBudgets"];
