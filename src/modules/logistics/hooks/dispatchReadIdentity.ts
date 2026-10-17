export interface DispatchReadContextState {
  activeContextKey: string | null;
  generation: number;
}

export interface DispatchReadContextToken {
  requestedContextKey: string;
  requestedContextGeneration: number;
}

export interface DispatchContextualValue<T> extends DispatchReadContextToken {
  value: T;
}

export function createDispatchReadContext(
  activeContextKey: string | null,
): DispatchReadContextState {
  return { activeContextKey, generation: 0 };
}

export function advanceDispatchReadContext(
  current: DispatchReadContextState,
  activeContextKey: string | null,
): DispatchReadContextState {
  if (current.activeContextKey === activeContextKey) return current;
  return { activeContextKey, generation: current.generation + 1 };
}

export function captureDispatchReadContext(
  current: DispatchReadContextState,
  contextKey: string | null,
): DispatchReadContextToken | null {
  if (!contextKey || current.activeContextKey !== contextKey) return null;
  return {
    requestedContextKey: contextKey,
    requestedContextGeneration: current.generation,
  };
}

export function readCurrentDispatchContextValue<T>(
  contextualValue: DispatchContextualValue<T> | null,
  current: DispatchReadContextState,
  renderedContextKey: string | null,
): T | null {
  if (
    !contextualValue ||
    contextualValue.requestedContextKey !== renderedContextKey ||
    contextualValue.requestedContextKey !== current.activeContextKey ||
    contextualValue.requestedContextGeneration !== current.generation
  ) {
    return null;
  }
  return contextualValue.value;
}

export interface DispatchReadIdentity {
  sequence: number;
  currentSequence: number;
  requestedContextKey: string;
  activeContextKey: string | null;
  requestedContextGeneration: number;
  activeContextGeneration: number;
  requestedOrderId?: string;
  selectedOrderId?: string | null;
}

export function isCurrentDispatchRead(identity: DispatchReadIdentity): boolean {
  return identity.sequence === identity.currentSequence &&
    identity.requestedContextKey === identity.activeContextKey &&
    identity.requestedContextGeneration === identity.activeContextGeneration &&
    (identity.requestedOrderId === undefined ||
      identity.requestedOrderId === identity.selectedOrderId);
}

export function removeConfirmedDispatchSource<T extends { sourceType: "order" | "transfer"; sourceId: string }>(
  queue: readonly T[],
  sourceType: "order" | "transfer",
  sourceId: string,
): T[] {
  return queue.filter((item) => item.sourceType !== sourceType || item.sourceId !== sourceId);
}
