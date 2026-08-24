import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import { ConversationEntityMap } from "../../../src/main/codex-application/internal/ConversationEntityMap";

Layer.buildWithScope(Layer.succeed(ConversationEntityMap, {} as never));
Effect.uninterruptible(Effect.void);
Queue.unbounded<unknown>();
PubSub.unbounded<unknown>();
