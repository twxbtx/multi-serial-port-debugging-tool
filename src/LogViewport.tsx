import { type CSSProperties, type WheelEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LogEntry, SessionState } from "./types";
import {
  DEFAULT_LOG_OVERSCAN,
  calculateVirtualLogWindow,
} from "./logWindow";
import {
  estimateByteCount,
  formatTime,
  getDisplayMessage,
  renderColorizedText,
} from "./logFormatting";

interface LogViewportProps {
  session: SessionState;
  logs: LogEntry[];
  indexOffset: number;
  viewportRef: (node: HTMLDivElement | null) => void;
  onWheel: (event: WheelEvent<HTMLDivElement>) => void;
}

function getRowHeight(session: SessionState) {
  const fontSize = Number(session.logFontSize) || 10;
  return Math.max(16, Math.ceil(fontSize * (session.showLineWrap ? 4.8 : 1.75)));
}

export function LogViewport({ session, logs, indexOffset, viewportRef, onWheel }: LogViewportProps) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(360);
  const rowHeight = getRowHeight(session);

  const setRefs = (node: HTMLDivElement | null) => {
    localRef.current = node;
    viewportRef(node);
  };

  useLayoutEffect(() => {
    const node = localRef.current;
    if (!node) return undefined;

    const updateSize = () => setViewportHeight(node.clientHeight || 360);
    updateSize();

    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const virtualWindow = useMemo(
    () =>
      calculateVirtualLogWindow({
        totalItems: logs.length,
        scrollTop,
        viewportHeight,
        rowHeight,
        overscan: DEFAULT_LOG_OVERSCAN,
      }),
    [logs.length, rowHeight, scrollTop, viewportHeight],
  );

  const visibleLogs = logs.slice(virtualWindow.startIndex, virtualWindow.endIndex);
  const style = {
    "--log-font-size": `${session.logFontSize}px`,
    "--log-row-height": `${rowHeight}px`,
  } as CSSProperties;

  return (
    <div
      className={`pane-log virtualized ${session.showLineWrap ? "wrap" : "nowrap"}`}
      ref={setRefs}
      style={style}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onWheel={onWheel}
      title="Ctrl + 滚轮缩放日志字体"
    >
      {logs.length ? (
        <>
          <div className="log-virtual-spacer" style={{ height: virtualWindow.topPadding }} />
          {visibleLogs.map((entry, index) => {
            const absoluteIndex = indexOffset + virtualWindow.startIndex + index + 1;
            return (
              <div key={entry.id} className={`log-line ${entry.kind} ${entry.accent ?? "neutral"} ${session.showTimestamp ? "" : "no-time"}`}>
                {session.showTimestamp ? <span className="log-time">{formatTime(entry.timestamp)}</span> : null}
                <span className="log-kind">{entry.kind.toUpperCase()}</span>
                <span className="log-message">
                  {session.showPacketInfo ? (
                    <span className="packet-badge">
                      #{absoluteIndex} {estimateByteCount(entry)}B{entry.omittedBytes ? ` +${entry.omittedBytes}` : ""}
                    </span>
                  ) : null}
                  {renderColorizedText(getDisplayMessage(session, entry))}
                </span>
              </div>
            );
          })}
          <div className="log-virtual-spacer" style={{ height: virtualWindow.bottomPadding }} />
        </>
      ) : (
        <div className="empty-inline">暂无日志。连接串口后开始接收。</div>
      )}
    </div>
  );
}
