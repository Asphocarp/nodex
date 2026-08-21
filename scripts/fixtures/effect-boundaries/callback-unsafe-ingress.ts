import * as Deferred from "effect/Deferred";
import * as Queue from "effect/Queue";

declare const completion: Deferred.Deferred<void>;
declare const queue: Queue.Queue<string>;

Queue.offerUnsafe(queue, "value");
Deferred.doneUnsafe(completion, Deferred.await(completion));
