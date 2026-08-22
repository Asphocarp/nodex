import * as Deferred from "effect/Deferred";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";

declare const completion: Deferred.Deferred<void>;
declare const fiber: { interruptUnsafe(): void };
declare const queue: Queue.Queue<string>;

Semaphore.makeUnsafe(1);
Queue.offerUnsafe(queue, "value");
Deferred.doneUnsafe(completion, Deferred.await(completion));
fiber.interruptUnsafe();
