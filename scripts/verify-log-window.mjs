import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const modulePath = path.resolve("src/logWindow.ts");
const {
  MAX_RETAINED_LOGS,
  trimLogWindow,
  calculateVirtualLogWindow,
} = await import(pathToFileURL(modulePath).href);

assert.ok(
  MAX_RETAINED_LOGS >= 50_000,
  `expected at least 50000 retained logs, got ${MAX_RETAINED_LOGS}`,
);

const entries = Array.from({ length: 60_000 }, (_, index) => ({
  id: `log-${index}`,
  timestamp: index,
  kind: "rx",
  message: `line ${index}`,
}));

const retained = trimLogWindow(entries);
assert.equal(retained.length, MAX_RETAINED_LOGS);
assert.equal(retained[0].id, `log-${entries.length - MAX_RETAINED_LOGS}`);

const windowed = calculateVirtualLogWindow({
  totalItems: retained.length,
  scrollTop: 12_345,
  viewportHeight: 320,
  rowHeight: 20,
  overscan: 8,
});

assert.ok(windowed.startIndex >= 0);
assert.ok(windowed.endIndex <= retained.length);
assert.ok(
  windowed.endIndex - windowed.startIndex <= 40,
  `expected virtual render window <= 40 rows, got ${windowed.endIndex - windowed.startIndex}`,
);
assert.equal(windowed.topPadding, windowed.startIndex * 20);
assert.equal(windowed.bottomPadding, (retained.length - windowed.endIndex) * 20);

console.log("log window verification passed");
