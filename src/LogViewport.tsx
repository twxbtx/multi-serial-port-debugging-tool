import { memo, type CSSProperties, type WheelEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LogEntry, SessionState } from "./types";
import {
  DEFAULT_LOG_OVERSCAN,
  calculateVariableVirtualLogWindow,
  calculateVirtualLogWindow,
  getEffectiveScrollTop,
  getLogTailKey,
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

const AUTO_FOLLOW_RENDER_LIMIT = 120;

function getRowHeight(session: SessionState) {
  const fontSize = Number(session.logFontSize) || 10;
  return Math.max(16, Math.ceil(fontSize * (session.showLineWrap ? 4.8 : 1.75)));
}

function estimateWrappedLogHeight(entry: LogEntry, session: SessionState, viewportWidth: number, rowHeight: number, absoluteIndex: number) {
  if (!session.showLineWrap) return rowHeight;

  const fontSize = Number(session.logFontSize) || 10;
  const lineHeight = Math.max(16, Math.ceil(fontSize * 1.55));
  const timeColumnWidth = session.showTimestamp ? 86 : 0;
  const kindColumnWidth = 30;
  const gridGap = session.showTimestamp ? 16 : 8;
  const sidePadding = 22;
  const packetText = session.showPacketInfo
    ? `#${absoluteIndex} ${estimateByteCount(entry)}B${entry.omittedBytes ? ` +${entry.omittedBytes}` : ""} `
    : "";
  const usableWidth = Math.max(80, viewportWidth - timeColumnWidth - kindColumnWidth - gridGap - sidePadding);
  const approxCharWidth = Math.max(6, fontSize * 0.62);
  const charsPerLine = Math.max(8, Math.floor(usableWidth / approxCharWidth));
  const text = `${packetText}${getDisplayMessage(session, entry) || " "}`;
  const visualLines = text.split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);

  return Math.max(rowHeight, visualLines * lineHeight + 2);
}

const LogLine = memo(function LogLine({
  entry,
  absoluteIndex,
  showTimestamp,
  showPacketInfo,
  showRawHex,
}: {
  entry: LogEntry;
  absoluteIndex: number;
  showTimestamp: boolean;
  showPacketInfo: boolean;
  showRawHex: boolean;
}) {
  return (
    <div className={`log-line ${entry.kind} ${entry.accent ?? "neutral"} ${showTimestamp ? "" : "no-time"}`}>
      {showTimestamp ? <span className="log-time">{formatTime(entry.timestamp)}</span> : null}
      <span className="log-kind">{entry.kind.toUpperCase()}</span>
      <span className="log-message">
        {showPacketInfo ? (
          <span className="packet-badge">
            #{absoluteIndex} {estimateByteCount(entry)}B{entry.omittedBytes ? ` +${entry.omittedBytes}` : ""}
          </span>
        ) : null}
        {renderColorizedText(getDisplayMessage({ showRawHex }, entry))}
      </span>
    </div>
  );
});

export function LogViewport({ session, logs, indexOffset, viewportRef, onWheel }: LogViewportProps) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(360);
  const [viewportWidth, setViewportWidth] = useState(520);
  const useTailFollow = session.autoScroll;
  const rowHeight = getRowHeight(session);
  const itemHeights = useMemo(
    () =>
      useTailFollow
        ? []
        : logs.map((entry, index) => estimateWrappedLogHeight(entry, session, viewportWidth, rowHeight, indexOffset + index + 1)),
    [
      indexOffset,
      logs,
      rowHeight,
      session,
      useTailFollow,
      viewportWidth,
    ],
  );
  const estimatedTotalHeight = useMemo(() => itemHeights.reduce((total, height) => total + height, 0), [itemHeights]);
  const totalHeight = session.showLineWrap ? estimatedTotalHeight : logs.length * rowHeight;
  const tailLogKey = getLogTailKey(logs);
  const effectiveScrollTop = getEffectiveScrollTop({
    autoScroll: session.autoScroll,
    scrollTop,
    totalHeight,
    viewportHeight,
  });

  const setRefs = (node: HTMLDivElement | null) => {
    localRef.current = node;
    viewportRef(node);
  };

  useLayoutEffect(() => {
    const node = localRef.current;
    if (!node) return undefined;

    const updateSize = () => {
      setViewportHeight(node.clientHeight || 360);
      setViewportWidth(node.clientWidth || 520);
    };
    updateSize();

    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const virtualWindow = useMemo(
    () =>
      session.showLineWrap
        ? calculateVariableVirtualLogWindow({
            itemHeights,
            scrollTop: effectiveScrollTop,
            viewportHeight,
            overscan: DEFAULT_LOG_OVERSCAN,
          })
        : calculateVirtualLogWindow({
            totalItems: logs.length,
            scrollTop: effectiveScrollTop,
            viewportHeight,
            rowHeight,
            overscan: DEFAULT_LOG_OVERSCAN,
          }),
    [effectiveScrollTop, itemHeights, logs.length, rowHeight, session.showLineWrap, viewportHeight],
  );

  const visibleLogs = logs.slice(virtualWindow.startIndex, virtualWindow.endIndex);
  const followStartIndex = Math.max(0, logs.length - AUTO_FOLLOW_RENDER_LIMIT);
  const followLogs = useTailFollow ? logs.slice(followStartIndex) : [];
  const style = {
    "--log-font-size": `${session.logFontSize}px`,
    "--log-row-height": `${rowHeight}px`,
  } as CSSProperties;

  useLayoutEffect(() => {
    if (!session.autoScroll) return;
    const node = localRef.current;
    if (!node) return;
    let frameId = 0;

    const scrollToBottom = () => {
      const nextScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
      if (Math.abs(node.scrollTop - nextScrollTop) > 1) {
        node.scrollTop = nextScrollTop;
      }
      setScrollTop(nextScrollTop);
    };

    scrollToBottom();
    frameId = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frameId);
  }, [session.autoScroll, tailLogKey, viewportHeight]);

  const renderLogLine = (entry: LogEntry, absoluteIndex: number) => (
    <LogLine
      key={entry.id}
      entry={entry}
      absoluteIndex={absoluteIndex}
      showTimestamp={session.showTimestamp}
      showPacketInfo={session.showPacketInfo}
      showRawHex={session.showRawHex}
    />
  );

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
        useTailFollow ? (
          <div className="log-follow-tail">
            {followLogs.map((entry, index) => renderLogLine(entry, indexOffset + followStartIndex + index + 1))}
          </div>
        ) : (
          <div className="log-virtual-canvas" style={{ height: virtualWindow.totalHeight }}>
            <div className="log-virtual-window" style={{ transform: `translateY(${virtualWindow.offsetY}px)` }}>
              {visibleLogs.map((entry, index) => renderLogLine(entry, indexOffset + virtualWindow.startIndex + index + 1))}
            </div>
          </div>
        )
      ) : (
        <div className="empty-inline">暂无日志。连接串口后开始接收。</div>
      )}
    </div>
  );
}
