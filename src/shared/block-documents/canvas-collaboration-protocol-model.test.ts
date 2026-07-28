import { describe, expect, test } from "vitest";
import {
  canonicalizeCanvasSceneElement,
  chooseCanvasSceneElementWinner,
  type CanvasSceneElement,
} from "./canvas-scene";

interface PendingMutation {
  readonly mutationId: string;
  readonly candidate: CanvasSceneElement;
}

const elementId = (element: CanvasSceneElement): string =>
  String(element.id);

const elementVersion = (element: CanvasSceneElement | undefined): number =>
  Number(element?.version ?? 0);

const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const applyCandidate = (
  scene: Map<string, CanvasSceneElement>,
  candidate: CanvasSceneElement,
): boolean => {
  const id = elementId(candidate);
  const current = scene.get(id);
  const winner = current
    ? chooseCanvasSceneElementWinner(current, candidate)
    : candidate;
  if (winner === current) return false;
  scene.set(id, winner);
  return true;
};

const sceneEvidence = (
  scene: ReadonlyMap<string, CanvasSceneElement>,
): readonly unknown[] =>
  [...scene.values()]
    .sort((left, right) =>
      elementId(left).localeCompare(elementId(right))
    )
    .map((element) => element.value);

describe("seeded Canvas collaboration protocol model", () => {
  test.each([0x5eed_0001, 0x5eed_0002, 0x5eed_0003])(
    "converges after reorder, duplication, loss, retry, and snapshot repair (seed %i)",
    (seed) => {
      const random = seededRandom(seed);
      const server = new Map<string, CanvasSceneElement>();
      const clients = [
        new Map<string, CanvasSceneElement>(),
        new Map<string, CanvasSceneElement>(),
      ];
      const pending: PendingMutation[] = [];
      const receipts = new Map<string, CanvasSceneElement>();
      let mutationSequence = 0;
      let headSeq = 0;

      const deliver = (mutation: PendingMutation): void => {
        const receipt = receipts.get(mutation.mutationId);
        if (receipt) {
          for (const client of clients) {
            if (random() > 0.35) applyCandidate(client, receipt);
          }
          return;
        }
        const changed = applyCandidate(server, mutation.candidate);
        receipts.set(mutation.mutationId, mutation.candidate);
        if (changed) headSeq += 1;
        for (const client of clients) {
          if (random() > 0.35) applyCandidate(client, mutation.candidate);
          if (random() > 0.8) applyCandidate(client, mutation.candidate);
        }
      };

      for (let turn = 0; turn < 240; turn += 1) {
        const clientIndex = random() < 0.5 ? 0 : 1;
        const elementId = `element-${Math.floor(random() * 12)}`;
        const local = clients[clientIndex]!;
        const current = local.get(elementId);
        const version = elementVersion(current) + 1;
        mutationSequence += 1;
        const candidate = canonicalizeCanvasSceneElement({
          id: elementId,
          type: "rectangle",
          index: `a${elementId.padStart(12, "0")}`,
          version,
          versionNonce: Math.floor(random() * 1_000_000) + 1,
          isDeleted: random() < 0.08,
          x: Math.floor(random() * 2_000),
          y: clientIndex * 100 + turn,
        });
        applyCandidate(local, candidate);
        pending.push({
          mutationId: `mutation-${mutationSequence}`,
          candidate,
        });

        if (pending.length > 0 && random() > 0.25) {
          const index = Math.floor(random() * pending.length);
          const [mutation] = pending.splice(index, 1);
          if (mutation) {
            deliver(mutation);
            if (random() > 0.75) deliver(mutation);
          }
        }
        if (turn % 31 === 0) {
          for (const serverElement of server.values()) {
            for (const client of clients) applyCandidate(client, serverElement);
          }
        }
      }

      while (pending.length > 0) {
        const index = Math.floor(random() * pending.length);
        const [mutation] = pending.splice(index, 1);
        if (mutation) deliver(mutation);
      }
      for (const serverElement of server.values()) {
        for (const client of clients) applyCandidate(client, serverElement);
      }

      expect(headSeq).toBeGreaterThan(0);
      expect(receipts.size).toBe(mutationSequence);
      expect(sceneEvidence(clients[0]!)).toEqual(sceneEvidence(server));
      expect(sceneEvidence(clients[1]!)).toEqual(sceneEvidence(server));
    },
  );
});
