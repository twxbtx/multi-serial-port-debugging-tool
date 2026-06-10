import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const modulePath = path.resolve("src/logWindow.ts");
const {
  MAX_RETAINED_LOGS,
  MAX_LOG_CHAR_BUDGET,
  trimLogWindow,
  calculateVariableVirtualLogWindow,
  calculateVirtualLogWindow,
  getBottomScrollTop,
  getEffectiveScrollTop,
  getLogTailKey,
} = await import(pathToFileURL(modulePath).href);

assert.ok(
  MAX_RETAINED_LOGS <= 5_000,
  `screen log retention should stay bounded for long high-rate serial runs, got ${MAX_RETAINED_LOGS}`,
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
const retainedTailKey = getLogTailKey(retained);
const retainedAfterAppend = trimLogWindow([
  ...retained,
  { id: "log-after-cap", timestamp: entries.length + 1, kind: "rx", message: "line after cap" },
]);
assert.equal(retainedAfterAppend.length, MAX_RETAINED_LOGS);
assert.notEqual(
  getLogTailKey(retainedAfterAppend),
  retainedTailKey,
  "auto-follow trigger must change when the retained log count stays capped but the newest log changes",
);
assert.equal(getLogTailKey([]), "0");

const largeEntries = Array.from({ length: 2_000 }, (_, index) => ({
  id: `large-${index}`,
  timestamp: index,
  kind: "rx",
  message: "x".repeat(8192),
}));
const charTrimmed = trimLogWindow(largeEntries);
const charCost = charTrimmed.reduce((total, entry) => total + entry.message.length + (entry.rawHex?.length ?? 0), 0);
assert.ok(charCost <= MAX_LOG_CHAR_BUDGET + 8192);
assert.ok(charTrimmed.length < largeEntries.length);

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
assert.equal(windowed.totalHeight, retained.length * 20);
assert.equal(windowed.offsetY, windowed.startIndex * 20);
assert.equal(getBottomScrollTop(windowed.totalHeight, 320), windowed.totalHeight - 320);
assert.equal(getBottomScrollTop(120, 320), 0);
assert.equal(
  getEffectiveScrollTop({ autoScroll: true, scrollTop: 0, totalHeight: windowed.totalHeight, viewportHeight: 320 }),
  windowed.totalHeight - 320,
);
assert.equal(
  getEffectiveScrollTop({ autoScroll: false, scrollTop: 12_345, totalHeight: windowed.totalHeight, viewportHeight: 320 }),
  12_345,
);

const variableHeights = [20, 20, 240, 20, 520, 20, 20];
const variableTotalHeight = variableHeights.reduce((total, height) => total + height, 0);
const variableBottomWindow = calculateVariableVirtualLogWindow({
  itemHeights: variableHeights,
  scrollTop: getBottomScrollTop(variableTotalHeight, 160),
  viewportHeight: 160,
  overscan: 1,
});
assert.equal(variableBottomWindow.totalHeight, variableTotalHeight);
assert.equal(variableBottomWindow.endIndex, variableHeights.length);
assert.ok(
  variableBottomWindow.startIndex >= 3,
  `expected bottom window to skip earlier wrapped rows, got startIndex=${variableBottomWindow.startIndex}`,
);

console.log("log window verification passed");
