import type {
  DataEventArguments,
  DataEventName,
  DataEventPayload,
  DataEventPayloadFor,
} from "@/core/types/events.types";

type StoredDataEventListener = (payload: DataEventPayload) => void;

export type DataEventListener<EventName extends DataEventName> = (
  payload: DataEventPayloadFor<EventName>,
) => void;

export class DataEventBus {
  private readonly listeners = new Map<DataEventName, Set<StoredDataEventListener>>();

  subscribe<EventName extends DataEventName>(
    event: EventName,
    listener: DataEventListener<EventName>,
  ): () => void {
    const eventListeners = this.listeners.get(event) ?? new Set<StoredDataEventListener>();
    eventListeners.add(listener as StoredDataEventListener);
    this.listeners.set(event, eventListeners);
    return () => this.unsubscribe(event, listener);
  }

  unsubscribe<EventName extends DataEventName>(
    event: EventName,
    listener: DataEventListener<EventName>,
  ): void {
    this.listeners.get(event)?.delete(listener as StoredDataEventListener);
  }

  emit<EventName extends DataEventName>(
    event: EventName,
    ...args: DataEventArguments<EventName>
  ): void {
    const payload = (args[0] ?? {}) as DataEventPayload;
    this.listeners.get(event)?.forEach((listener) => listener(payload));
  }
}
