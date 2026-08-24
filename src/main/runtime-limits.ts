/**
 * Count budgets for Main-owned ingress. Observation channels are sliding because consumers can
 * reread their canonical owner; reliable command channels backpressure producers instead.
 * Payload owners must additionally cap variable-size bodies before publication.
 */
export const MAIN_OBSERVATION_EVENT_CAPACITY = 1_024;
export const MAIN_RELIABLE_COMMAND_CAPACITY = 512;

/** Terminal chunks are capped before entering a sliding queue, bounding retained output bytes. */
export const TERMINAL_OUTPUT_CHUNK_CAPACITY = 512;
export const TERMINAL_OUTPUT_CHUNK_CHAR_LIMIT = 64 * 1_024;
