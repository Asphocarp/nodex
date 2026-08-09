import type { CommandId } from "../../shared/command-keybindings";

export type ContextualKeyboardActionPhase = "keydown" | "keyup";

export interface ContextualKeyboardActionTarget {
  readonly surfaceId: string;
  readonly presentationId: string;
  readonly canExecute: (commandId: CommandId) => boolean;
  readonly execute: (
    commandId: CommandId,
    phase: ContextualKeyboardActionPhase,
  ) => boolean;
}

interface RegisteredTarget {
  readonly token: string;
  readonly target: ContextualKeyboardActionTarget;
}

const registrations = new Map<string, RegisteredTarget>();
let activeSurfaceId: string | null = null;
let activePresentationId: string | null = null;

const resolveActiveTarget = (): ContextualKeyboardActionTarget | null => {
  if (activePresentationId) {
    const activeTarget = activeSurfaceId
      ? registrations.get(activeSurfaceId)?.target
      : null;
    if (activeTarget?.presentationId === activePresentationId) {
      return activeTarget;
    }
    for (const registration of registrations.values()) {
      if (registration.target.presentationId === activePresentationId) {
        return registration.target;
      }
    }
    return null;
  }
  if (activeSurfaceId) {
    return registrations.get(activeSurfaceId)?.target ?? null;
  }
  if (registrations.size !== 1) return null;
  return registrations.values().next().value?.target ?? null;
};

export function registerContextualKeyboardActionTarget(
  token: string,
  target: ContextualKeyboardActionTarget,
): void {
  registrations.set(target.surfaceId, {
    token,
    target,
  });
}

export function unregisterContextualKeyboardActionTarget(
  surfaceId: string,
  token: string,
): void {
  const existing = registrations.get(surfaceId);
  if (!existing || existing.token !== token) return;
  registrations.delete(surfaceId);
  if (activeSurfaceId === surfaceId) activeSurfaceId = null;
}

export function markContextualKeyboardActionTargetActive(
  surfaceId: string,
): void {
  const existing = registrations.get(surfaceId);
  if (!existing) return;
  activeSurfaceId = surfaceId;
  activePresentationId = existing.target.presentationId;
}

export function markContextualKeyboardActionPresentationActive(
  presentationId: string,
): void {
  activePresentationId = presentationId;
  const registration = Array.from(registrations.values()).find(
    (candidate) => candidate.target.presentationId === presentationId,
  );
  activeSurfaceId = registration?.target.surfaceId ?? null;
}

export function canExecuteContextualKeyboardAction(
  commandId: CommandId,
): boolean {
  return resolveActiveTarget()?.canExecute(commandId) ?? false;
}

export function executeContextualKeyboardAction(
  commandId: CommandId,
  phase: ContextualKeyboardActionPhase = "keydown",
): boolean {
  const target = resolveActiveTarget();
  if (!target?.canExecute(commandId)) return false;
  return target.execute(commandId, phase);
}

export function resetContextualKeyboardActionRegistryForTests(): void {
  registrations.clear();
  activeSurfaceId = null;
  activePresentationId = null;
}
