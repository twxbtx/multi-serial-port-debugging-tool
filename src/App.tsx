import { type CSSProperties, type DragEvent, type WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CirclePlay,
  CircleStop,
  Filter,
  Lock,
  Maximize2,
  Minus,
  MoonStar,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Save,
  Send,
  Square,
  SquareTerminal,
  Trash2,
  Unlock,
  X,
  Eraser,
} from "lucide-react";
import "./App.css";
import type {
  ActionStep,
  ConnectionConfig,
  LogEntry,
  SerialApiEvent,
  SerialPortInfo,
  SessionState,
} from "./types";
import {
  ACTION_TAPE_KEY,
  BAUD_RATES,
  INSPECTOR_KEY,
  MAX_BAUD_RATE,
  MAX_LOG_FONT_SIZE,
  MAX_RENDERED_LOGS,
  MIN_LOG_FONT_SIZE,
  PANE_LAYOUT_KEY,
  SERIAL_EVENT_BATCH_LIMIT,
  SERIAL_EVENT_FLUSH_MS,
  SIDEBAR_KEY,
  STORAGE_KEY,
  THEME_KEY,
  THEMES,
} from "./appConfig";
import {
  createCommand,
  createSavedState,
  createSession,
  defaultCommands,
  isKnownTheme,
  isPaneLayout,
  loadActionTape,
  loadSessions,
} from "./sessionState";
import {
  compactLogEntry,
  detectAccent,
  downloadTextFile,
  estimateByteCount,
  formatBytes,
  formatLogExport,
  formatScriptXml,
  formatTime,
  getDisplayMessage,
  renderColorizedText,
  textToHex,
  trimLogEntries,
} from "./logFormatting";
import { getPortLabel, sanitizeBaudRate } from "./portUtils";

type DropSide = "before" | "after";

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getPeerPort(pathName: string) {
  if (pathName === "COM4") return "COM22";
  if (pathName === "COM22") return "COM4";
  return "";
}

export default function App() {
  const [initialState] = useState(() => {
    const loaded = loadSessions();
    return { sessions: loaded, activeSessionId: loaded[0]?.id ?? "" };
  });
  const [sessions, setSessions] = useState<SessionState[]>(initialState.sessions);
  const [activeSessionId, setActiveSessionId] = useState(initialState.activeSessionId);
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [themeId, setThemeId] = useState(localStorage.getItem(THEME_KEY) ?? THEMES[0].id);
  const [paneLayout, setPaneLayout] = useState<"auto" | "horizontal" | "vertical">(
    () => (localStorage.getItem(PANE_LAYOUT_KEY) as "auto" | "horizontal" | "vertical" | null) ?? "horizontal",
  );
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [globalRecording, setGlobalRecording] = useState(false);
  const [globalActionTape, setGlobalActionTape] = useState<ActionStep[]>(() => loadActionTape());
  const [leftSidebarLocked, setLeftSidebarLocked] = useState(() => localStorage.getItem(SIDEBAR_KEY) !== "collapsed");
  const [rightInspectorLocked, setRightInspectorLocked] = useState(() => localStorage.getItem(INSPECTOR_KEY) !== "collapsed");
  const [desktopStateReady, setDesktopStateReady] = useState(() => !window.serialApi?.loadSavedState);
  const [openPortMenuSessionId, setOpenPortMenuSessionId] = useState<string | null>(null);
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ sessionId: string; side: DropSide } | null>(null);

  const sessionsRef = useRef(sessions);
  const logViewportRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const serialEventQueueRef = useRef<SerialApiEvent[]>([]);
  const serialEventFlushTimerRef = useRef<number | null>(null);
  const periodicTimersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    document.title = "多串口测试台 V2.1";
  }, []);

  useEffect(() => {
    const getSavedState = () =>
      createSavedState(sessions, {
        themeId,
        paneLayout,
        leftSidebarLocked,
        rightInspectorLocked,
        activeSessionId,
        globalActionTape,
      });
    window.__serialAssistantGetSavedState = getSavedState;
    return () => {
      if (window.__serialAssistantGetSavedState === getSavedState) {
        delete window.__serialAssistantGetSavedState;
      }
    };
  }, [activeSessionId, globalActionTape, leftSidebarLocked, paneLayout, rightInspectorLocked, sessions, themeId]);

  useEffect(() => {
    if (!window.serialApi?.loadSavedState) return undefined;

    let canceled = false;
    void window.serialApi
      .loadSavedState()
      .then((state) => {
        if (canceled || !state) return;
        const restored = state.sessions?.length ? state.sessions.map((item, index) => createSession(index, item)) : null;
        const preferences = state.preferences;

        if (restored) {
          setSessions(restored);
          const preferredActiveSessionId = preferences?.activeSessionId;
          const nextActiveSessionId =
            preferredActiveSessionId && restored.some((session) => session.id === preferredActiveSessionId)
              ? preferredActiveSessionId
              : restored[0]?.id ?? "";
          setActiveSessionId(nextActiveSessionId);
        }
        const savedThemeId = preferences?.themeId;
        const savedPaneLayout = preferences?.paneLayout;
        if (isKnownTheme(savedThemeId)) setThemeId(savedThemeId);
        if (isPaneLayout(savedPaneLayout)) setPaneLayout(savedPaneLayout);
        if (typeof preferences?.leftSidebarLocked === "boolean") setLeftSidebarLocked(preferences.leftSidebarLocked);
        if (typeof preferences?.rightInspectorLocked === "boolean") setRightInspectorLocked(preferences.rightInspectorLocked);
        if (Array.isArray(preferences?.globalActionTape)) setGlobalActionTape(preferences.globalActionTape.slice(-200));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!canceled) setDesktopStateReady(true);
      });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    sessionsRef.current = sessions;
    const timer = window.setTimeout(() => {
      const savedState = createSavedState(sessions, {
        themeId,
        paneLayout,
        leftSidebarLocked,
        rightInspectorLocked,
        activeSessionId,
        globalActionTape,
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState.sessions));
      if (desktopStateReady && window.serialApi?.saveSavedState) {
        void window.serialApi.saveSavedState(savedState).catch(() => undefined);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [activeSessionId, desktopStateReady, globalActionTape, leftSidebarLocked, paneLayout, rightInspectorLocked, sessions, themeId]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, themeId);
    document.documentElement.dataset.theme = themeId;
  }, [themeId]);

  useEffect(() => localStorage.setItem(PANE_LAYOUT_KEY, paneLayout), [paneLayout]);
  useEffect(() => localStorage.setItem(SIDEBAR_KEY, leftSidebarLocked ? "expanded" : "collapsed"), [leftSidebarLocked]);
  useEffect(() => localStorage.setItem(INSPECTOR_KEY, rightInspectorLocked ? "expanded" : "collapsed"), [rightInspectorLocked]);
  useEffect(() => localStorage.setItem(ACTION_TAPE_KEY, JSON.stringify(globalActionTape.slice(-200))), [globalActionTape]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? sessions[0],
    [activeSessionId, sessions],
  );

  const occupiedPorts = useMemo(
    () =>
      new Set(
        sessions
          .filter((session) => session.connected && session.config.path)
          .map((session) => session.config.path),
      ),
    [sessions],
  );

  const workbenchSessions = sessions;

  const updateSession = useCallback((sessionId: string, updater: (session: SessionState) => SessionState) => {
    setSessions((current) => current.map((session) => (session.id === sessionId ? updater(session) : session)));
  }, []);

  const addLog = useCallback((sessionId: string, kind: LogEntry["kind"], message: string, rawHex?: string, meta?: Partial<LogEntry>) => {
    updateSession(sessionId, (session) => {
      const entry = compactLogEntry({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        kind,
        message,
        rawHex,
        accent: detectAccent(message, kind),
        ...meta,
      });
      return { ...session, logs: trimLogEntries([...session.logs, entry]) };
    });
  }, [updateSession]);

  const applySerialEvents = useCallback((events: SerialApiEvent[]) => {
    setSessions((current) =>
      current.map((session) => {
        const relevant = events.filter((event) => event.sessionId === session.id);
        if (!relevant.length) return session;

        let connected = session.connected;
        let simulated = session.simulated;
        const nextLogs: LogEntry[] = [];

        relevant.forEach((event) => {
          if (event.kind !== "file-progress" && event.message) {
            const entry = compactLogEntry({
              id: crypto.randomUUID(),
              timestamp: event.timestamp || Date.now(),
              kind: event.kind,
              message: event.message,
              rawHex: event.rawHex,
              accent: detectAccent(event.message, event.kind),
              bytes: event.bytes,
              omittedBytes: event.omittedBytes,
            });
            nextLogs.push(entry);
          }

          if (event.code === "connected") {
            connected = true;
          } else if (event.code === "disconnected") {
            connected = false;
            simulated = false;
          }
        });

        return {
          ...session,
          connected,
          simulated,
          logs: nextLogs.length ? trimLogEntries([...session.logs, ...nextLogs]) : session.logs,
        };
      }),
    );
  }, []);

  const flushSerialEvents = useCallback(() => {
    serialEventFlushTimerRef.current = null;
    const events = serialEventQueueRef.current.splice(0);
    if (events.length) applySerialEvents(events);
  }, [applySerialEvents]);

  useEffect(() => {
    if (!window.serialApi) return undefined;

    const loadPorts = async () => {
      const list = await window.serialApi!.listPorts();
      setPorts(list);
    };
    const loadWindowState = async () => {
      const state = await window.serialApi!.getWindowState();
      setAlwaysOnTop(Boolean(state.alwaysOnTop));
      setIsWindowMaximized(Boolean(state.isMaximized));
    };

    void loadPorts();
    void loadWindowState();

    const timer = window.setInterval(() => void loadPorts(), 2000);
    const focusHandler = () => void loadPorts();
    window.addEventListener("focus", focusHandler);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", focusHandler);
    };
  }, []);

  useEffect(() => {
    if (!window.serialApi) return undefined;
    const scheduleFlush = () => {
      if (serialEventFlushTimerRef.current === null) {
        serialEventFlushTimerRef.current = window.setTimeout(flushSerialEvents, SERIAL_EVENT_FLUSH_MS);
      }
    };

    return window.serialApi.onSessionEvent((event) => {
      serialEventQueueRef.current.push(event);
      if (serialEventQueueRef.current.length >= SERIAL_EVENT_BATCH_LIMIT) {
        if (serialEventFlushTimerRef.current !== null) window.clearTimeout(serialEventFlushTimerRef.current);
        flushSerialEvents();
      } else {
        scheduleFlush();
      }
    });
  }, [flushSerialEvents]);

  useEffect(() => {
    return () => {
      if (serialEventFlushTimerRef.current !== null) window.clearTimeout(serialEventFlushTimerRef.current);
      serialEventQueueRef.current = [];
      Object.values(periodicTimersRef.current).forEach((timer) => window.clearInterval(timer));
      periodicTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    sessions.forEach((session) => {
      if (!session.autoScroll) return;
      const node = logViewportRefs.current[session.id];
      if (node) node.scrollTop = node.scrollHeight;
    });
  }, [sessions]);

  const getVisibleLogs = (session: SessionState) => {
    const tokens = session.filterText.split(/[,\s]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (!tokens.length) return session.logs.slice(-MAX_RENDERED_LOGS);
    const matched = session.logs.filter((entry) => {
      const haystack = `${entry.message} ${entry.rawHex ?? ""}`.toLowerCase();
      return tokens.some((token) => haystack.includes(token));
    });
    return (session.showFilteredOnly ? matched : session.logs).slice(-MAX_RENDERED_LOGS);
  };

  const focusSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
  };

  const createNewSession = () => {
    setSessions((current) => {
      const next = createSession(current.length);
      setActiveSessionId(next.id);
      return [...current, next];
    });
  };

  const moveSession = (sessionId: string, direction: -1 | 1) => {
    setSessions((current) => {
      const index = current.findIndex((session) => session.id === sessionId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const reorderSession = (draggedSessionId: string, targetSessionId: string, side: DropSide) => {
    if (draggedSessionId === targetSessionId) return;
    setSessions((current) => {
      const draggedIndex = current.findIndex((session) => session.id === draggedSessionId);
      const targetIndex = current.findIndex((session) => session.id === targetSessionId);
      if (draggedIndex < 0 || targetIndex < 0) return current;

      const next = [...current];
      const [dragged] = next.splice(draggedIndex, 1);
      const remainingTargetIndex = next.findIndex((session) => session.id === targetSessionId);
      const insertIndex = remainingTargetIndex + (side === "after" ? 1 : 0);
      next.splice(insertIndex, 0, dragged);
      return next;
    });
  };

  const getDropSide = (event: DragEvent<HTMLElement>): DropSide => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX > rect.left + rect.width / 2 ? "after" : "before";
  };

  const clearLogs = (sessionId: string) => {
    updateSession(sessionId, (session) => ({ ...session, logs: [] }));
  };

  const requestWebSerialPort = async (sessionId: string) => {
    if (!window.serialApi?.requestPort) {
      addLog(sessionId, "error", "当前运行环境不支持网页串口授权，请使用 Chrome/Edge 或桌面 EXE。");
      return;
    }
    try {
      const port = await window.serialApi.requestPort();
      setPorts((current) => {
        const next = current.filter((item) => item.path !== port.path);
        return [...next, port];
      });
      updateSession(sessionId, (session) => ({ ...session, config: { ...session.config, path: port.path } }));
      addLog(sessionId, "status", `已授权网页串口 ${port.path}，可以连接。`);
    } catch (error) {
      addLog(sessionId, "error", error instanceof Error ? error.message : "网页串口授权失败");
    }
  };

  const zoomLogFont = (sessionId: string, event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    updateSession(sessionId, (session) => ({
      ...session,
      logFontSize: Math.min(MAX_LOG_FONT_SIZE, Math.max(MIN_LOG_FONT_SIZE, session.logFontSize + direction)),
    }));
  };

  const stopPeriodicSend = useCallback((sessionId: string) => {
    const timer = periodicTimersRef.current[sessionId];
    if (timer) {
      window.clearInterval(timer);
      delete periodicTimersRef.current[sessionId];
    }
    updateSession(sessionId, (session) => ({ ...session, automation: { ...session.automation, isRunning: false } }));
  }, [updateSession]);

  const connectSession = async (sessionId: string) => {
    const session = sessionsRef.current.find((item) => item.id === sessionId);
    if (!session) return;
    if (!session.config.path) {
      addLog(sessionId, "error", "请先选择串口。");
      return;
    }

    if (!window.serialApi) {
      updateSession(sessionId, (current) => ({
        ...current,
        connected: true,
        simulated: true,
        logs: trimLogEntries([
          ...current.logs,
          compactLogEntry({
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            kind: "status",
            message: `[预览] 已连接 ${session.config.path} @ ${session.config.baudRate}`,
            accent: "success",
          }),
        ]),
      }));
      return;
    }

    try {
      await window.serialApi.connectSession({ sessionId, config: session.config });
      updateSession(sessionId, (current) => ({ ...current, connected: true }));
    } catch (error) {
      addLog(sessionId, "error", error instanceof Error ? error.message : "连接失败");
    }
  };

  const disconnectSession = async (sessionId: string) => {
    stopPeriodicSend(sessionId);
    if (!window.serialApi) {
      updateSession(sessionId, (current) => ({ ...current, connected: false, simulated: false }));
      addLog(sessionId, "status", "预览串口已断开。");
      return;
    }
    try {
      await window.serialApi.disconnectSession(sessionId);
      updateSession(sessionId, (current) => ({ ...current, connected: false }));
    } catch (error) {
      addLog(sessionId, "error", error instanceof Error ? error.message : "断开失败");
    }
  };

  const sendMessage = useCallback(async (sessionId: string, payload: string, appendNewline: boolean, encoding?: ConnectionConfig["encoding"]) => {
    const session = sessionsRef.current.find((item) => item.id === sessionId);
    if (!session || !payload.trim()) return;
    const actualEncoding = encoding ?? session.config.encoding;

    if (globalRecording) {
      setGlobalActionTape((current) =>
        [
          ...current,
          {
            id: crypto.randomUUID(),
            kind: "send" as const,
            label: `${session.title} ${payload}`,
            sessionId,
            sessionTitle: session.title,
            path: session.config.path,
            payload,
            encoding: actualEncoding,
            appendNewline,
            delayMs: 0,
          },
        ].slice(-200),
      );
    }

    if (!window.serialApi) {
      addLog(sessionId, "tx", payload, actualEncoding === "hex" ? payload : textToHex(payload));
      const peerPath = getPeerPort(session.config.path);
      const peerSession = sessionsRef.current.find(
        (item) => item.id !== sessionId && item.connected && item.config.path === peerPath,
      );
      window.setTimeout(() => {
        if (peerSession) {
          addLog(peerSession.id, "rx", `[预览接收 ${session.config.path}->${peerSession.config.path}] ${payload}`);
          addLog(sessionId, "status", `预览链路已转发到 ${peerSession.config.path}`);
          return;
        }
        addLog(sessionId, "rx", `[预览回环] ${payload}`);
      }, 80);
      return;
    }

    try {
      await window.serialApi.writeData({
        sessionId,
        message: payload,
        appendNewline,
        encoding: actualEncoding,
      });
    } catch (error) {
      addLog(sessionId, "error", error instanceof Error ? error.message : "发送失败");
    }
  }, [addLog, globalRecording]);

  const sendLines = async (sessionId: string) => {
    const session = sessionsRef.current.find((item) => item.id === sessionId);
    if (!session) return;
    const lines = session.draftMessage.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      await sendMessage(sessionId, line, session.config.appendNewline);
      await sleep(20);
    }
  };

  const startPeriodicSend = (sessionId: string) => {
    const session = sessionsRef.current.find((item) => item.id === sessionId);
    if (!session || periodicTimersRef.current[sessionId]) return;
    if (!session.draftMessage.trim()) {
      addLog(sessionId, "error", "周期发送需要先填写发送内容。");
      return;
    }
    const intervalMs = Math.max(20, Number(session.automation.intervalMs) || 1000);
    updateSession(sessionId, (current) => ({ ...current, automation: { ...current.automation, intervalMs, isRunning: true } }));
    periodicTimersRef.current[sessionId] = window.setInterval(() => {
      const latest = sessionsRef.current.find((item) => item.id === sessionId);
      if (!latest || !latest.automation.isRunning) return;
      void sendMessage(sessionId, latest.draftMessage, latest.config.appendNewline);
    }, intervalMs);
    void sendMessage(sessionId, session.draftMessage, session.config.appendNewline);
  };

  const sendSelectedCommands = async (sessionId: string) => {
    const session = sessionsRef.current.find((item) => item.id === sessionId);
    if (!session) return;
    for (const command of session.commands.filter((item) => item.enabled && item.payload.trim())) {
      if (command.delayMs > 0) await sleep(command.delayMs);
      await sendMessage(sessionId, command.payload, command.appendNewline, command.encoding);
    }
  };

  const exportLogs = async (sessionId: string, format: "json" | "csv" | "txt") => {
    const session = sessionsRef.current.find((item) => item.id === sessionId);
    if (!session) return;
    const safeTitle = session.title.replace(/[\\/:*?"<>|]/g, "_");
    const content = formatLogExport(session, format);
    const defaultName = `${safeTitle}-logs.${format}`;
    if (!window.serialApi) {
      downloadTextFile(defaultName, content);
      return;
    }
    try {
      await window.serialApi.saveExport({ defaultName, content });
    } catch (error) {
      addLog(sessionId, "error", error instanceof Error ? error.message : "导出失败");
    }
  };

  const exportCachedLog = async (sessionId: string) => {
    const session = sessionsRef.current.find((item) => item.id === sessionId);
    if (!session) return;
    if (!window.serialApi?.saveCachedLog) {
      addLog(sessionId, "error", "当前运行环境不支持临时缓存导出。");
      return;
    }
    const safeTitle = session.title.replace(/[\\/:*?"<>|]/g, "_");
    try {
      const status = await window.serialApi.getLogCacheStatus?.(sessionId);
      const result = await window.serialApi.saveCachedLog({
        sessionId,
        defaultName: `${safeTitle}-cache.jsonl`,
      });
      if (!result.canceled) {
        addLog(sessionId, "status", `缓存日志已保存${status ? `（${formatBytes(status.bytes)}）` : ""}。已保存文件不会被自动清理。`);
      }
    } catch (error) {
      addLog(sessionId, "error", error instanceof Error ? error.message : "缓存导出失败");
    }
  };

  const exportScriptXml = async (sessionId: string) => {
    const session = sessionsRef.current.find((item) => item.id === sessionId);
    if (!session) return;
    const safeTitle = session.title.replace(/[\\/:*?"<>|]/g, "_");
    const content = formatScriptXml(session, globalActionTape);
    const defaultName = `${safeTitle}-script.xml`;
    if (!window.serialApi) {
      downloadTextFile(defaultName, content);
      return;
    }
    try {
      await window.serialApi.saveExport({ defaultName, content });
    } catch (error) {
      addLog(sessionId, "error", error instanceof Error ? error.message : "脚本导出失败");
    }
  };

  const deleteSession = async (sessionId: string) => {
    await disconnectSession(sessionId);
    const remaining = sessionsRef.current.filter((session) => session.id !== sessionId);
    const nextSessions = remaining.length ? remaining : [createSession(0)];
    setSessions(nextSessions);
    if (activeSessionId === sessionId) {
      setActiveSessionId(nextSessions[0].id);
    }
  };

  const toggleAlwaysOnTop = async () => {
    if (!window.serialApi) {
      setAlwaysOnTop((current) => !current);
      return;
    }
    const result = await window.serialApi.setAlwaysOnTop(!alwaysOnTop);
    setAlwaysOnTop(result.alwaysOnTop);
  };

  const minimizeWindow = () => {
    void window.serialApi?.minimizeWindow();
  };

  const toggleMaximizeWindow = async () => {
    if (!window.serialApi) {
      setIsWindowMaximized((current) => !current);
      return;
    }
    const result = await window.serialApi.toggleMaximizeWindow();
    setIsWindowMaximized(Boolean(result.isMaximized));
  };

  const closeWindow = () => {
    if (window.serialApi) {
      void window.serialApi.closeWindow();
    } else {
      window.close();
    }
  };

  const renderSessionPane = (session: SessionState) => {
    const logs = getVisibleLogs(session);
    const isActive = session.id === activeSessionId;
    const totalBytes = session.logs.reduce((sum, entry) => sum + estimateByteCount(entry), 0);
    const hiddenCount = Math.max(0, session.logs.length - logs.length);
    return (
      <article
        key={session.id}
        className={`session-pane tile ${isActive ? "selected" : ""}`}
      >
        <header className="pane-header">
          <div className="pane-title">
            <span className={`status-dot ${session.connected ? "online" : "offline"}`} />
            <div>
              <strong>{session.title}</strong>
              <span>{session.connected ? `已连接 ${session.config.path}` : `待连接 ${session.config.path || "未选择串口"}`}</span>
            </div>
          </div>
          <div className="pane-actions">
            <button type="button" className="ghost-icon" title="清空日志" aria-label="清空日志" onClick={() => clearLogs(session.id)}>
              <Eraser size={14} />
            </button>
            <button type="button" className="ghost-icon" title="删除窗口" aria-label="删除窗口" onClick={() => void deleteSession(session.id)}>
              <Trash2 size={14} />
            </button>
            <button
              type="button"
              className={`ghost-icon ${session.window.pinned ? "active" : ""}`}
              title={session.window.pinned ? "取消固定" : "固定到主视图"}
              onClick={() =>
                updateSession(session.id, (current) => ({
                  ...current,
                  window: { ...current.window, pinned: !current.window.pinned },
                }))
              }
            >
              {session.window.pinned ? <Pin size={14} /> : <PinOff size={14} />}
            </button>
            <button
              type="button"
              className="ghost-icon"
              title={session.autoScroll ? "暂停跟随" : "自动跟随"}
              onClick={() => updateSession(session.id, (current) => ({ ...current, autoScroll: !current.autoScroll }))}
            >
              {session.autoScroll ? <Unlock size={14} /> : <Lock size={14} />}
            </button>
          </div>
        </header>

        <div className="pane-filter-row">
          <label className="pane-filter">
            <Filter size={14} />
            <input
              placeholder="过滤关键字"
              value={session.filterText}
              onChange={(event) => updateSession(session.id, (current) => ({ ...current, filterText: event.target.value }))}
            />
          </label>
        </div>

        <div className="pane-option-row">
          <label className="mini-check" title="接收区按十六进制显示">
            <input type="checkbox" checked={session.showRawHex} onChange={(event) => updateSession(session.id, (current) => ({ ...current, showRawHex: event.target.checked }))} />
            HEX
          </label>
          <label className="mini-check" title="显示时间戳">
            <input type="checkbox" checked={session.showTimestamp} onChange={(event) => updateSession(session.id, (current) => ({ ...current, showTimestamp: event.target.checked }))} />
            时间
          </label>
          <label className="mini-check" title="显示字节数和截断信息">
            <input type="checkbox" checked={session.showPacketInfo} onChange={(event) => updateSession(session.id, (current) => ({ ...current, showPacketInfo: event.target.checked }))} />
            分包
          </label>
          <label className="mini-check" title="日志自动换行">
            <input type="checkbox" checked={session.showLineWrap} onChange={(event) => updateSession(session.id, (current) => ({ ...current, showLineWrap: event.target.checked }))} />
            换行
          </label>
          <label className="mini-check" title="只显示过滤匹配结果">
            <input type="checkbox" checked={session.showFilteredOnly} onChange={(event) => updateSession(session.id, (current) => ({ ...current, showFilteredOnly: event.target.checked }))} />
            只看过滤
          </label>
          <label className="mini-check" title="勾选后日志自动滚动到最新">
            <input type="checkbox" checked={session.autoScroll} onChange={(event) => updateSession(session.id, (current) => ({ ...current, autoScroll: event.target.checked }))} />
            跟随最新
          </label>
          <span className="log-stats">{session.logs.length} 条 / {formatBytes(totalBytes)}{hiddenCount ? ` / 隐藏 ${hiddenCount}` : ""}</span>
        </div>

        <div
          className={`pane-log ${session.showLineWrap ? "wrap" : "nowrap"}`}
          ref={(node) => { logViewportRefs.current[session.id] = node; }}
          style={{ "--log-font-size": `${session.logFontSize}px` } as CSSProperties}
          onWheel={(event) => zoomLogFont(session.id, event)}
          title="Ctrl + 滚轮缩放日志字体"
        >
          {logs.length ? (
            logs.map((entry, index) => (
              <div key={entry.id} className={`log-line ${entry.kind} ${entry.accent ?? "neutral"} ${session.showTimestamp ? "" : "no-time"}`}>
                {session.showTimestamp ? <span className="log-time">{formatTime(entry.timestamp)}</span> : null}
                <span className="log-kind">{entry.kind.toUpperCase()}</span>
                <span className="log-message">
                  {session.showPacketInfo ? (
                    <span className="packet-badge">
                      #{hiddenCount + index + 1} {estimateByteCount(entry)}B{entry.omittedBytes ? ` +${entry.omittedBytes}` : ""}
                    </span>
                  ) : null}
                  {renderColorizedText(getDisplayMessage(session, entry))}
                </span>
              </div>
            ))
          ) : (
            <div className="empty-inline">暂无日志。连接串口后开始接收。</div>
          )}
        </div>

        <div className="pane-config-row">
          <input className="pane-name-input" value={session.title} title="窗口名称" onChange={(event) => updateSession(session.id, (current) => ({ ...current, title: event.target.value }))} />
          <div className="port-combo">
            <input
              className="port-path-input"
              value={session.config.path}
              title={ports.find((port) => port.path === session.config.path) ? getPortLabel(ports.find((port) => port.path === session.config.path)!) : "串口，可手动输入 COM 号"}
              data-testid={isActive ? "serial-port-select" : `serial-port-select-${session.id}`}
              onChange={(event) => {
                setOpenPortMenuSessionId(null);
                updateSession(session.id, (current) => ({ ...current, config: { ...current.config, path: event.target.value } }));
              }}
              placeholder="COMx"
            />
            <button
              type="button"
              className="port-combo-button"
              title="选择串口"
              aria-label="选择串口"
              onClick={(event) => {
                event.stopPropagation();
                setOpenPortMenuSessionId((current) => (current === session.id ? null : session.id));
              }}
            >
              <ChevronDown size={13} />
            </button>
            {openPortMenuSessionId === session.id ? (
              <div className="port-menu" role="listbox">
                {window.serialApi?.requestPort ? (
                  <button
                    type="button"
                    className="port-menu-option"
                    onClick={() => {
                      setOpenPortMenuSessionId(null);
                      void requestWebSerialPort(session.id);
                    }}
                  >
                    <strong>WEB</strong>
                    <span>授权网页串口</span>
                  </button>
                ) : null}
                {ports.length ? ports.map((port) => {
                  const occupied = occupiedPorts.has(port.path) && port.path !== session.config.path;
                  return (
                    <button
                      key={port.path}
                      type="button"
                      className={`port-menu-option ${port.path === session.config.path ? "active" : ""}`}
                      disabled={occupied}
                      title={getPortLabel(port)}
                      onClick={() => {
                        updateSession(session.id, (current) => ({ ...current, config: { ...current.config, path: port.path } }));
                        setOpenPortMenuSessionId(null);
                      }}
                    >
                      <strong>{port.path}</strong>
                      <span>{getPortLabel(port).replace(port.path, "").replace(/^\s*\|\s*/, "") || "串口"}</span>
                      {occupied ? <em>已占用</em> : null}
                    </button>
                  );
                }) : <div className="port-menu-empty">暂无串口，可手动输入</div>}
              </div>
            ) : null}
          </div>
          <input
            className="baud-rate-input"
            type="number"
            list={`baud-rate-options-${session.id}`}
            min={300}
            max={MAX_BAUD_RATE}
            step={1}
            value={session.config.baudRate || ""}
            title="波特率，可输入 7000000 等高速值"
            onChange={(event) => updateSession(session.id, (current) => ({ ...current, config: { ...current.config, baudRate: Math.max(0, Number(event.target.value) || 0) } }))}
            onBlur={() => updateSession(session.id, (current) => ({ ...current, config: { ...current.config, baudRate: sanitizeBaudRate(current.config.baudRate) } }))}
          />
          <datalist id={`baud-rate-options-${session.id}`}>
            {BAUD_RATES.map((rate) => <option key={rate} value={rate}>{rate}</option>)}
          </datalist>
          <select value={session.config.encoding === "hex" ? "hex" : "utf8"} title="发送格式" onChange={(event) => updateSession(session.id, (current) => ({ ...current, config: { ...current.config, encoding: event.target.value as ConnectionConfig["encoding"] } }))}>
            <option value="utf8">STR</option>
            <option value="hex">HEX</option>
          </select>
          <select value={String(session.config.appendNewline)} title="换行" onChange={(event) => updateSession(session.id, (current) => ({ ...current, config: { ...current.config, appendNewline: event.target.value === "true" } }))}>
            <option value="true">CRLF</option>
            <option value="false">无</option>
          </select>
          <button type="button" className={`${session.connected ? "ghost-button" : "primary-button"} pane-link-button`} title="连接串口" onClick={() => void connectSession(session.id)}>
            连接
          </button>
          <button type="button" className="ghost-button pane-link-button" title="断开串口" onClick={() => void disconnectSession(session.id)}>
            断开
          </button>
        </div>

        <div className="pane-send-stack">
          <div className="pane-send">
            <textarea
              value={session.draftMessage}
              placeholder={session.config.encoding === "hex" ? "HEX：01 03 00 00 00 02" : "输入待发送数据，可多行"}
              onChange={(event) => updateSession(session.id, (current) => ({ ...current, draftMessage: event.target.value }))}
            />
            <button type="button" className="primary-button small" onClick={() => void sendMessage(session.id, session.draftMessage, session.config.appendNewline)}>
              <Send size={14} />
              发
            </button>
          </div>
          <div className="send-tools">
            <button type="button" className="ghost-button small-inline" onClick={() => void sendLines(session.id)}>
              <Send size={14} />
              分行
            </button>
            <label className="interval-field" title="周期发送间隔 ms">
              <span>周期(ms)</span>
              <input
                type="number"
                min={20}
                step={10}
                value={session.automation.intervalMs}
                onChange={(event) => updateSession(session.id, (current) => ({ ...current, automation: { ...current.automation, intervalMs: Number(event.target.value) } }))}
              />
            </label>
            <button
              type="button"
              className={`${session.automation.isRunning ? "primary-button" : "ghost-button"} small-inline`}
              onClick={() => (session.automation.isRunning ? stopPeriodicSend(session.id) : startPeriodicSend(session.id))}
            >
              {session.automation.isRunning ? <CircleStop size={14} /> : <CirclePlay size={14} />}
              {session.automation.isRunning ? "停止" : "循环"}
            </button>
            <div className="log-export-actions" aria-label="日志导出">
              <button type="button" className="ghost-button export-button" title="导出 JSON 日志" onClick={() => void exportLogs(session.id, "json")}><Save size={13} />JSON</button>
              <button type="button" className="ghost-button export-button" title="导出 CSV 日志" onClick={() => void exportLogs(session.id, "csv")}><Save size={13} />CSV</button>
              <button type="button" className="ghost-button export-button" title="导出 TXT 日志" onClick={() => void exportLogs(session.id, "txt")}><Save size={13} />TXT</button>
              {window.serialApi?.saveCachedLog ? (
                <button type="button" className="ghost-button export-button" title="保存本次连接的临时缓存日志" onClick={() => void exportCachedLog(session.id)}><Save size={13} />缓存</button>
              ) : null}
            </div>
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className={`app-shell ${isWindowMaximized ? "maximized" : ""}`}>
      <header className="topbar">
        <div className="topbar-title">
          <SquareTerminal size={16} />
          <div>
            <strong>多串口测试台 V2.1</strong>
            <span>{activeSession ? `${activeSession.title} · ${activeSession.connected ? `已连接 ${activeSession.config.path}` : `待连接 ${activeSession.config.path || "未选择串口"}`}` : "薄视图、强日志背压、字符串/HEX 发送与周期测试"}</span>
          </div>
        </div>
        <div className="topbar-window-controls" aria-label="窗口控制">
          <button type="button" className="window-control-button" title="最小化" aria-label="最小化" onClick={minimizeWindow}>
            <Minus size={14} />
          </button>
          <button type="button" className="window-control-button" title={isWindowMaximized ? "还原" : "最大化"} aria-label={isWindowMaximized ? "还原" : "最大化"} onClick={() => void toggleMaximizeWindow()}>
            {isWindowMaximized ? <Square size={12} /> : <Maximize2 size={13} />}
          </button>
          <button type="button" className="window-control-button close" title="关闭" aria-label="关闭" onClick={closeWindow}>
            <X size={14} />
          </button>
        </div>
      </header>

      <div className={`workspace ${leftSidebarLocked ? "sidebar-expanded" : "sidebar-collapsed"}`}>
        <aside className={`session-sidebar ${leftSidebarLocked ? "expanded" : "collapsed"}`}>
          <div className="sidebar-header">
            <div className="sidebar-title">
              <Activity size={14} />
              <strong>会话</strong>
            </div>
            <button type="button" className="ghost-icon" title="折叠左侧栏" onClick={() => setLeftSidebarLocked((current) => !current)}>
              {leftSidebarLocked ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
            </button>
          </div>
          <div className="sidebar-tools">
            <button type="button" className="primary-button sidebar-new-button" onClick={createNewSession}>
              <Plus size={15} />
              添加窗口
            </button>
            <button type="button" className="ghost-button sidebar-new-button" onClick={() => window.serialApi?.listPorts().then((items) => setPorts(items))}>
              <RefreshCw size={15} />
              刷新串口
            </button>
            <label className="select-wrap sidebar-control">
              <MoonStar size={14} />
              <select value={themeId} onChange={(event) => setThemeId(event.target.value)}>
                {THEMES.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
              </select>
            </label>
            <label className="select-wrap sidebar-control">
              <Activity size={14} />
              <select value={paneLayout} onChange={(event) => setPaneLayout(event.target.value as "auto" | "horizontal" | "vertical")}>
                <option value="horizontal">横向</option>
                <option value="vertical">纵向</option>
                <option value="auto">自动</option>
              </select>
            </label>
            <button type="button" className={`ghost-button sidebar-new-button ${alwaysOnTop ? "active" : ""}`} onClick={() => void toggleAlwaysOnTop()}>
              <Pin size={15} />
              窗口置顶
            </button>
          </div>
          <div className="session-list">
            {sessions.map((session, index) => (
              <div
                key={session.id}
                role="button"
                tabIndex={0}
                className={`session-tab ${session.id === activeSessionId ? "active" : ""}`}
                onClick={() => focusSession(session.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") focusSession(session.id);
                }}
              >
                <span className={`status-dot ${session.connected ? "online" : "offline"}`} />
                <div className="session-tab-copy">
                  <strong>{session.title}</strong>
                  <span>{session.config.path || "未选择"}</span>
                </div>
                <div className="session-sort-actions" aria-label="串口排序">
                  <button
                    type="button"
                    className="ghost-icon sort-inline"
                    title="上移"
                    disabled={index === 0}
                    onClick={(event) => {
                      event.stopPropagation();
                      moveSession(session.id, -1);
                    }}
                  >
                    <ChevronUp size={11} />
                  </button>
                  <button
                    type="button"
                    className="ghost-icon sort-inline"
                    title="下移"
                    disabled={index === sessions.length - 1}
                    onClick={(event) => {
                      event.stopPropagation();
                      moveSession(session.id, 1);
                    }}
                  >
                    <ChevronDown size={11} />
                  </button>
                </div>
                <button
                  type="button"
                  className={`ghost-icon pin-inline ${session.window.pinned ? "active" : ""}`}
                  title={session.window.pinned ? "取消固定" : "固定"}
                  onClick={(event) => {
                    event.stopPropagation();
                    updateSession(session.id, (current) => ({ ...current, window: { ...current.window, pinned: !current.window.pinned } }));
                  }}
                >
                  {session.window.pinned ? <Pin size={12} /> : <PinOff size={12} />}
                </button>
              </div>
            ))}
          </div>
        </aside>

        <main className="main-stage">
          <div className={`stage-grid ${rightInspectorLocked ? "inspector-expanded" : "inspector-collapsed"}`}>
            <section className="workbench panel">
              <div className="focus-strip" data-testid="focus-strip">
                {sessions.map((session) => {
                  const isShown = workbenchSessions.some((item) => item.id === session.id);
                  return (
                    <button
                      key={session.id}
                      type="button"
                      draggable
                      className={[
                        "focus-chip",
                        session.id === activeSessionId ? "active" : "",
                        isShown ? "shown" : "folded",
                        draggingSessionId === session.id ? "dragging" : "",
                        dropTarget?.sessionId === session.id ? `drop-${dropTarget.side}` : "",
                      ].filter(Boolean).join(" ")}
                      title="拖拽调整下方串口窗口顺序"
                      onClick={() => focusSession(session.id)}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", session.id);
                        setDraggingSessionId(session.id);
                        setDropTarget(null);
                      }}
                      onDragOver={(event) => {
                        if (!draggingSessionId || draggingSessionId === session.id) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDropTarget({ sessionId: session.id, side: getDropSide(event) });
                      }}
                      onDragLeave={() => {
                        setDropTarget((current) => (current?.sessionId === session.id ? null : current));
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const draggedSessionId = event.dataTransfer.getData("text/plain") || draggingSessionId;
                        const side = getDropSide(event);
                        if (draggedSessionId) reorderSession(draggedSessionId, session.id, side);
                        setDraggingSessionId(null);
                        setDropTarget(null);
                      }}
                      onDragEnd={() => {
                        setDraggingSessionId(null);
                        setDropTarget(null);
                      }}
                    >
                      <span className={`status-dot ${session.connected ? "online" : "offline"}`} />
                      <strong>{session.title}</strong>
                      <span>{session.config.path || "未选"}</span>
                    </button>
                  );
                })}
              </div>
              <div className={`pane-grid simple-grid layout-${paneLayout} count-${workbenchSessions.length}`}>
                {workbenchSessions.map((session) => renderSessionPane(session))}
              </div>
            </section>

            <aside className={`inspector panel ${rightInspectorLocked ? "expanded" : "collapsed"}`}>
              <button type="button" className={`ghost-icon inspector-toggle ${rightInspectorLocked ? "active" : ""}`} title="右侧指令表" onClick={() => setRightInspectorLocked((current) => !current)}>
                {rightInspectorLocked ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
              </button>
              {rightInspectorLocked && activeSession ? (
                <div className="inspector-content">
                  <div className="panel-head compact inspector-head">
                    <div>
                      <h2>{activeSession.title}</h2>
                      <p>自定义指令、批量发送和测试自动化。</p>
                    </div>
                  </div>

                  <section className="inspector-section command-table-section">
                    <div className="section-title">自定义指令</div>
                    <div className="command-table-head">
                      <span>选</span>
                      <span>名称</span>
                      <span>模式</span>
                      <span>延时</span>
                      <span>内容</span>
                      <span>上</span>
                      <span>下</span>
                      <span>发</span>
                      <span>删</span>
                    </div>
                    <div className="command-list enhanced compact-command-list">
                      {activeSession.commands.map((command, index) => (
                        <div key={command.id} className="command-card compact single-line-card command-table-row">
                          <div className="command-card-top one-line compact-one-line">
                            <button type="button" className="ghost-icon" title="参与批量发送" onClick={() => updateSession(activeSession.id, (session) => ({ ...session, commands: session.commands.map((item) => item.id === command.id ? { ...item, enabled: !item.enabled } : item) }))}>
                              {command.enabled ? <CheckSquare size={14} /> : <Square size={14} />}
                            </button>
                            <input value={command.label} title="命令名称" onChange={(event) => updateSession(activeSession.id, (session) => ({ ...session, commands: session.commands.map((item) => item.id === command.id ? { ...item, label: event.target.value } : item) }))} />
                            <select value={command.encoding === "hex" ? "hex" : "utf8"} title="发送格式" onChange={(event) => updateSession(activeSession.id, (session) => ({ ...session, commands: session.commands.map((item) => item.id === command.id ? { ...item, encoding: event.target.value as ConnectionConfig["encoding"] } : item) }))}>
                              <option value="utf8">STR</option>
                              <option value="hex">HEX</option>
                            </select>
                            <input type="number" min={0} step={10} value={command.delayMs} title="发送前延时 ms" onChange={(event) => updateSession(activeSession.id, (session) => ({ ...session, commands: session.commands.map((item) => item.id === command.id ? { ...item, delayMs: Number(event.target.value) } : item) }))} />
                            <input className="command-payload-inline" value={command.payload} placeholder={command.encoding === "hex" ? "HEX" : "内容"} onChange={(event) => updateSession(activeSession.id, (session) => ({ ...session, commands: session.commands.map((item) => item.id === command.id ? { ...item, payload: event.target.value } : item) }))} />
                            <button type="button" className="ghost-icon" title="上移" disabled={index === 0} onClick={() => updateSession(activeSession.id, (session) => {
                              if (index === 0) return session;
                              const commands = [...session.commands];
                              [commands[index - 1], commands[index]] = [commands[index], commands[index - 1]];
                              return { ...session, commands };
                            })}><ChevronUp size={14} /></button>
                            <button type="button" className="ghost-icon" title="下移" disabled={index === activeSession.commands.length - 1} onClick={() => updateSession(activeSession.id, (session) => {
                              if (index === session.commands.length - 1) return session;
                              const commands = [...session.commands];
                              [commands[index], commands[index + 1]] = [commands[index + 1], commands[index]];
                              return { ...session, commands };
                            })}><ChevronDown size={14} /></button>
                            <button type="button" className="ghost-icon" title="发送命令" onClick={() => void sendMessage(activeSession.id, command.payload, command.appendNewline, command.encoding)}>
                              <Send size={14} />
                            </button>
                            <button type="button" className="ghost-icon" title="删除命令" onClick={() => updateSession(activeSession.id, (session) => ({ ...session, commands: session.commands.filter((item) => item.id !== command.id) }))}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="panel-actions command-table-actions">
                      <button type="button" className="primary-button compact-button" onClick={() => updateSession(activeSession.id, (session) => ({ ...session, commands: [...session.commands, createCommand(`CMD${session.commands.length + 1}`, "")] }))}>
                        <Plus size={16} />添加
                      </button>
                      <button type="button" className="ghost-button compact-button" onClick={() => void sendSelectedCommands(activeSession.id)}>
                        <Send size={16} />批量
                      </button>
                      <button type="button" className="ghost-button compact-button" onClick={() => updateSession(activeSession.id, (session) => ({ ...session, commands: session.commands.map((command) => ({ ...command, enabled: true })) }))}>
                        <CheckSquare size={16} />全选
                      </button>
                      <button type="button" className="ghost-button compact-button" onClick={() => updateSession(activeSession.id, (session) => ({ ...session, commands: session.commands.map((command) => ({ ...command, enabled: !command.enabled })) }))}>
                        <Square size={16} />反选
                      </button>
                      <button type="button" className="ghost-button compact-button" onClick={() => updateSession(activeSession.id, (session) => ({ ...session, commands: defaultCommands() }))}>
                        <Trash2 size={16} />重置
                      </button>
                    </div>
                  </section>

                  <section className="inspector-section compact-section">
                    <div className="section-title">动作记录</div>
                    <div className="macro-list compact-macro-list">
                      {globalActionTape.slice(-6).map((step, index) => (
                        <div key={step.id} className="macro-step compact">
                          <div className="macro-step-head">
                            <span className="macro-index">{index + 1}</span>
                            <strong>{step.sessionTitle || step.sessionId}</strong>
                            <code>{step.payload}</code>
                          </div>
                        </div>
                      ))}
                      {!globalActionTape.length ? <div className="empty-inline">打开右下角录制后，发送动作会记录在这里。</div> : null}
                    </div>
                    <div className="panel-actions">
                      <span className={`record-status-pill ${globalRecording ? "active" : ""}`}>
                        <span className="record-symbol" aria-hidden="true" />
                        {globalRecording ? "录制中" : "待录制"}
                      </span>
                      <button type="button" className="ghost-button" onClick={() => void exportScriptXml(activeSession.id)}>
                        <Save size={16} />XML
                      </button>
                      <button type="button" className="ghost-button" onClick={() => setGlobalActionTape([])}>
                        <Trash2 size={16} />清空
                      </button>
                    </div>
                  </section>
                </div>
              ) : null}
            </aside>
          </div>
        </main>
      </div>
      <button
        type="button"
        className={`record-fab ${globalRecording ? "active" : ""}`}
        title={globalRecording ? "停止录制动作" : "开始录制动作"}
        aria-label={globalRecording ? "停止录制动作" : "开始录制动作"}
        onClick={() => setGlobalRecording((current) => !current)}
      >
        <span className="record-symbol" aria-hidden="true" />
      </button>
    </div>
  );
}
