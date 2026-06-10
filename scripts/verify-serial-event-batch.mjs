import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const modulePath = path.resolve("src/serialEventBatch.ts");
const { groupSerialEventsBySession } = await import(pathToFileURL(modulePath).href);

const events = [
  { sessionId: "a", timestamp: 1, kind: "rx", message: "a1" },
  { sessionId: "b", timestamp: 2, kind: "rx", message: "b1" },
  { sessionId: "a", timestamp: 3, kind: "rx", message: "a2" },
  { sessionId: "b", timestamp: 4, kind: "status", message: "b2" },
  { sessionId: "c", timestamp: 5, kind: "rx", message: "c1" },
];

const grouped = groupSerialEventsBySession(events);
assert.equal(grouped.size, 3);
assert.deepEqual(grouped.get("a")?.map((event) => event.message), ["a1", "a2"]);
assert.deepEqual(grouped.get("b")?.map((event) => event.message), ["b1", "b2"]);
assert.deepEqual(grouped.get("c")?.map((event) => event.message), ["c1"]);

console.log("serial event batch verification passed");
