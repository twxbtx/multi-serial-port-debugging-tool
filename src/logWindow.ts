import type { LogEntry } from "./types";

export const MAX_RETAINED_LOGS = 50_000;
export const MAX_LOG_CHAR_BUDGET = 64 * 1024 * 1024;
export const DEFAULT_LOG_ROW_HEIGHT = 18;
export const DEFAULT_LOG_OVERSCAN = 16;

export interface VirtualLogWindowInput {
  totalItems: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight?: number;
  overscan?: number;
}

export interface VirtualLogWindow {
  startIndex: number;
  endIndex: number;
  topPadding: number;
  bottomPadding: number;
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
  };
}
