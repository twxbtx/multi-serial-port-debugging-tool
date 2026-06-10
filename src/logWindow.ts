import type { LogEntry } from "./types";

export const MAX_RETAINED_LOGS = 5_000;
export const MAX_LOG_CHAR_BUDGET = 8 * 1024 * 1024;
export const DEFAULT_LOG_ROW_HEIGHT = 18;
export const DEFAULT_LOG_OVERSCAN = 16;

export interface VirtualLogWindowInput {
  totalItems: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight?: number;
  overscan?: number;
}

export interface VariableVirtualLogWindowInput {
  itemHeights: number[];
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
}

export interface VirtualLogWindow {
  startIndex: number;
  endIndex: number;
  topPadding: number;
  bottomPadding: number;
  totalHeight: number;
  offsetY: number;
}

function getLogCharCost(entry: LogEntry) {
  return entry.message.length + (entry.rawHex?.length ?? 0);
}

export function trimLogWindow(entries: LogEntry[]) {
  const next = entries.length > MAX_RETAINED_LOGS ? entries.slice(-MAX_RETAINED_LOGS) : entries.slice();
  let charBudget = next.reduce((total, entry) => total + getLogCharCost(entry), 0);

  while (next.length > 200 && charBudget > MAX_LOG_CHAR_BUDGET) {
    const removed = next.shift();
    charBudget -= removed ? getLogCharCost(removed) : 0;
  }

  return next;
}

export function getBottomScrollTop(totalHeight: number, viewportHeight: number) {
  return Math.max(0, Math.floor(totalHeight) - Math.max(0, Math.floor(viewportHeight)));
}

export function getEffectiveScrollTop({
  autoScroll,
  scrollTop,
  totalHeight,
  viewportHeight,
}: {
  autoScroll: boolean;
  scrollTop: number;
  totalHeight: number;
  viewportHeight: number;
}) {
  return autoScroll ? getBottomScrollTop(totalHeight, viewportHeight) : Math.max(0, Math.floor(scrollTop));
}

export function getLogTailKey(entries: LogEntry[]) {
  const tail = entries.at(-1);
  return tail ? `${entries.length}:${tail.id}:${tail.timestamp}` : "0";
}

function upperBound(values: number[], target: number) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (values[mid] <= target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function lowerBound(values: number[], target: number) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (values[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function calculateVariableVirtualLogWindow({
  itemHeights,
  scrollTop,
  viewportHeight,
  overscan = DEFAULT_LOG_OVERSCAN,
}: VariableVirtualLogWindowInput): VirtualLogWindow {
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const safeScrollTop = Math.max(0, Math.floor(scrollTop));
  const safeViewportHeight = Math.max(0, Math.floor(viewportHeight));
  const offsets = new Array(itemHeights.length + 1);
  offsets[0] = 0;

  itemHeights.forEach((height, index) => {
    offsets[index + 1] = offsets[index] + Math.max(1, Math.floor(height));
  });

  const totalHeight = offsets[offsets.length - 1] ?? 0;
  const firstVisible = Math.max(0, upperBound(offsets, safeScrollTop) - 1);
  const lastVisible = Math.min(itemHeights.length, lowerBound(offsets, safeScrollTop + safeViewportHeight) + 1);
  const startIndex = Math.max(0, firstVisible - safeOverscan);
  const endIndex = Math.min(itemHeights.length, lastVisible + safeOverscan);

  return {
    startIndex,
    endIndex,
    topPadding: offsets[startIndex] ?? 0,
    bottomPadding: Math.max(0, totalHeight - (offsets[endIndex] ?? totalHeight)),
    totalHeight,
    offsetY: offsets[startIndex] ?? 0,
  };
}

export function calculateVirtualLogWindow({
  totalItems,
  scrollTop,
  viewportHeight,
  rowHeight = DEFAULT_LOG_ROW_HEIGHT,
  overscan = DEFAULT_LOG_OVERSCAN,
}: VirtualLogWindowInput): VirtualLogWindow {
  const safeTotal = Math.max(0, Math.floor(totalItems));
  const safeRowHeight = Math.max(1, Math.floor(rowHeight));
  const safeViewportHeight = Math.max(0, Math.floor(viewportHeight));
  const safeScrollTop = Math.max(0, Math.floor(scrollTop));
  const safeOverscan = Math.max(0, Math.floor(overscan));

  const firstVisible = Math.floor(safeScrollTop / safeRowHeight);
  const visibleCount = Math.ceil(safeViewportHeight / safeRowHeight);
  const startIndex = Math.max(0, firstVisible - safeOverscan);
  const endIndex = Math.min(safeTotal, firstVisible + visibleCount + safeOverscan);

  return {
    startIndex,
    endIndex,
    topPadding: startIndex * safeRowHeight,
    bottomPadding: Math.max(0, safeTotal - endIndex) * safeRowHeight,
    totalHeight: safeTotal * safeRowHeight,
    offsetY: startIndex * safeRowHeight,
  };
}
