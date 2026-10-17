"use client";

import { useEffect } from "react";
import type { DataEventName, DataEventPayloadFor } from "@/core/types/events.types";
import { useDataEventBus } from "@/infrastructure/providers/RepositoryProvider";

export function useDataEvent<EventName extends DataEventName>(
  event: EventName,
  listener: (payload: DataEventPayloadFor<EventName>) => void,
) {
  const eventBus = useDataEventBus();

  useEffect(() => eventBus.subscribe(event, listener), [event, eventBus, listener]);
}
