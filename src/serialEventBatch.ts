import type { SerialApiEvent } from "./types";

export function groupSerialEventsBySession(events: SerialApiEvent[]) {
  const grouped = new Map<string, SerialApiEvent[]>();
  events.forEach((event) => {
    const current = grouped.get(event.sessionId);
    if (current) {
      current.push(event);
      return;
    }
    grouped.set(event.sessionId, [event]);
  });
  return grouped;
}
