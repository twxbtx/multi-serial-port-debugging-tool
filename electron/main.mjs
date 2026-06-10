import { app, BrowserWindow, dialog, ipcMain, screen } from "electron";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-http-cache");
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("disable-background-networking");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RX_FLUSH_INTERVAL_MS = 50;
const RX_DISPLAY_BYTE_LIMIT = 2 * 1024;
const RX_RAW_HEX_BYTE_LIMIT = 1024;
const LOG_CACHE_WARN_BYTES = 90 * 1024 ** 3;
const LOG_CACHE_LIMIT_BYTES = 100 * 1024 ** 3;
const PERSISTED_STATE_FILE = "serial-assistant-state.json";
const DEFAULT_WINDOW_WIDTH = 1520;
const DEFAULT_WINDOW_HEIGHT = 940;
const MIN_WINDOW_WIDTH = 720;
const MIN_WINDOW_HEIGHT = 440;

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {http.Server | null} */
let rendererServer = null;
/** @type {string} */
let rendererServerUrl = "";
/** @type {Map<string, any>} */
const sessions = new Map();
/** @type {Map<string, any>} */
const logCaches = new Map();
/** @type {Map<string, { chunks: Buffer[]; totalBytes: number; bufferedBytes: number; encoding: string; timer: NodeJS.Timeout | null }>} */
const pendingRx = new Map();
/** @type {Promise<typeof import("serialport").SerialPort> | null} */
let serialPortCtorPromise = null;
/** @type {Promise<any>} */
let persistedStateWritePromise = Promise.resolve();
/** @type {NodeJS.Timeout | null} */
let windowStateSaveTimer = null;

process.on("uncaughtException", (error) => {
  void writeSelfTestLog(`uncaughtException ${error.stack || error.message}`);
});

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
  void writeSelfTestLog(`unhandledRejection ${message}`);
});

function getDistRoot() {
  return path.join(__dirname, "..", "renderer-dist");
}

function getAppIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "icons", "icon.ico");
  }
  return path.join(__dirname, "..", "icon.ico");
}

function getSelfTestLogPath() {
  return process.env.SERIAL_ASSISTANT_SELFTEST_LOG
    ? path.resolve(process.env.SERIAL_ASSISTANT_SELFTEST_LOG)
    : path.join(app.getPath("temp"), "serial-assistant-selftest.log");
}

function formatSerialPortName(port) {
  const vendorProduct = [port.vendorId, port.productId].filter(Boolean).join(":");
  return [port.path, port.friendlyName, port.manufacturer, port.serialNumber, vendorProduct]
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index)
    .join(" | ");
}

async function getSerialPortCtor() {
  if (!serialPortCtorPromise) {
    serialPortCtorPromise = import("serialport").then((module) => module.SerialPort);
  }
  return serialPortCtorPromise;
}

async function writeSelfTestLog(message) {
  try {
    await fs.appendFile(getSelfTestLogPath(), `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // ignore self-test log errors
  }
}

function getPersistedStatePath() {
  return path.join(app.getPath("userData"), PERSISTED_STATE_FILE);
}

function getLogCacheRoot() {
  return path.join(app.getPath("userData"), "log-cache");
}

function getLogCachePath(sessionId) {
  return path.join(getLogCacheRoot(), `${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "_")}.jsonl`);
}

async function cleanupStaleLogCaches() {
  try {
    await fs.rm(getLogCacheRoot(), { recursive: true, force: true });
  } catch (error) {
    await writeSelfTestLog(`log-cache-cleanup-error ${error.message}`);
  }
}

async function createLogCache(sessionId) {
  const cachePath = getLogCachePath(sessionId);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.rm(cachePath, { force: true });
  const stream = createWriteStream(cachePath, { flags: "w" });
  const cache = {
    path: cachePath,
    stream,
    bytes: 0,
    warned: false,
    stopped: false,
    ended: false,
    exported: false,
  };
  stream.on("error", (error) => {
    cache.stopped = true;
    emitSerialEvent({
      sessionId,
      kind: "error",
      message: `日志缓存写入失败，已停止记录缓存：${error.message}`,
      code: "log-cache-error",
      cacheBytes: cache.bytes,
      cacheLimitBytes: LOG_CACHE_LIMIT_BYTES,
      cacheStopped: true,
    });
  });
  logCaches.set(sessionId, cache);
  return cache;
}

function createLogCacheLine(kind, payload, encoding) {
  const isBuffer = Buffer.isBuffer(payload);
  return `${JSON.stringify({
    timestamp: new Date().toISOString(),
    kind,
    encoding,
    bytes: isBuffer ? payload.length : undefined,
    ...(isBuffer ? { base64: payload.toString("base64") } : { text: String(payload) }),
  })}\n`;
}

function pausePortForCacheDrain(session, cache) {
  if (!session?.port?.pause || !session?.port?.resume || cache.waitingDrain) {
    return;
  }
  cache.waitingDrain = true;
  session.port.pause();
  cache.stream.once("drain", () => {
    cache.waitingDrain = false;
    if (session.port?.isOpen) {
      session.port.resume();
    }
  });
}

function writeLogCache(sessionId, kind, payload, encoding) {
  const cache = logCaches.get(sessionId);
  if (!cache || cache.stopped || cache.ended || !cache.stream) {
    return;
  }

  const line = createLogCacheLine(kind, payload, encoding);
  const lineBytes = Buffer.byteLength(line);
  if (cache.bytes + lineBytes >= LOG_CACHE_LIMIT_BYTES) {
    cache.stopped = true;
    const stopLine = createLogCacheLine("error", "日志缓存已达到 100GB，已停止继续记录。请导出当前缓存后再清理或重新连接。", encoding);
    cache.stream.write(stopLine);
    emitSerialEvent({
      sessionId,
      kind: "error",
      message: "日志缓存已达到 100GB，已停止继续记录。请先导出保存；下次重新打开串口会清理临时缓存并重新记录。",
      code: "log-cache-stopped",
      cacheBytes: cache.bytes,
      cacheLimitBytes: LOG_CACHE_LIMIT_BYTES,
      cacheStopped: true,
    });
    return;
  }

  const canContinue = cache.stream.write(line);
  cache.bytes += lineBytes;
  if (!canContinue) {
    pausePortForCacheDrain(sessions.get(sessionId), cache);
  }
  if (!cache.warned && cache.bytes >= LOG_CACHE_WARN_BYTES) {
    cache.warned = true;
    emitSerialEvent({
      sessionId,
      kind: "status",
      message: "日志缓存已超过 90GB，建议尽快导出保存并清理缓存。",
      code: "log-cache-warning",
      cacheBytes: cache.bytes,
      cacheLimitBytes: LOG_CACHE_LIMIT_BYTES,
    });
  }
}

async function endLogCache(sessionId) {
  const cache = logCaches.get(sessionId);
  if (!cache || cache.ended || !cache.stream) {
    return;
  }
  cache.ended = true;
  await new Promise((resolve) => cache.stream.end(resolve));
}

async function waitForLogCacheFlush(cache) {
  if (!cache || cache.ended || !cache.stream || cache.stopped) {
    return;
  }
  await new Promise((resolve, reject) => {
    cache.stream.write("", (error) => {
      if (error) reject(error);
      else resolve(undefined);
    });
  });
}

async function readPersistedState() {
  try {
    const raw = await fs.readFile(getPersistedStatePath(), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    await writeSelfTestLog(`state-read-error ${error.message}`);
    return null;
  }
}

async function writePersistedStateFile(state) {
  const statePath = getPersistedStatePath();
  const tempPath = `${statePath}.tmp`;
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tempPath, statePath);
  return { ok: true };
}

function createEmptyPersistedState() {
  return {
    version: 2,
    savedAt: Date.now(),
    sessions: [],
  };
}

function normalizePersistedState(value) {
  if (!value || typeof value !== "object") {
    return createEmptyPersistedState();
  }
  return {
    ...value,
    version: 2,
    savedAt: Number.isFinite(value.savedAt) ? value.savedAt : Date.now(),
    sessions: Array.isArray(value.sessions) ? value.sessions : [],
  };
}

async function updatePersistedState(updater) {
  persistedStateWritePromise = persistedStateWritePromise
    .catch(() => undefined)
    .then(async () => {
      const current = normalizePersistedState(await readPersistedState());
      const next = normalizePersistedState(updater(current) ?? current);
      next.savedAt = Date.now();
      await writePersistedStateFile(next);
      return { ok: true };
    });
  return persistedStateWritePromise;
}

async function writePersistedState(state) {
  return await updatePersistedState((current) => ({
    ...current,
    ...state,
    version: 2,
    savedAt: Date.now(),
    sessions: Array.isArray(state?.sessions) ? state.sessions : current.sessions,
    preferences: state?.preferences ?? current.preferences,
    window: state?.window ?? current.window,
  }));
}

function normalizeWindowState(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  const state = {
    width: Math.max(MIN_WINDOW_WIDTH, Math.round(width)),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.round(height)),
    isMaximized: Boolean(value.isMaximized),
  };
  const x = Number(value.x);
  const y = Number(value.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    state.x = Math.round(x);
    state.y = Math.round(y);
  }
  return state;
}

function isWindowPositionVisible(state) {
  if (!Number.isFinite(state?.x) || !Number.isFinite(state?.y)) {
    return false;
  }
  const centerX = state.x + state.width / 2;
  const centerY = state.y + state.height / 2;
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return centerX >= area.x && centerX <= area.x + area.width && centerY >= area.y && centerY <= area.y + area.height;
  });
}

function getWindowCreateOptions(savedWindowState) {
  const state = normalizeWindowState(savedWindowState);
  const options = {
    width: state?.width ?? DEFAULT_WINDOW_WIDTH,
    height: state?.height ?? DEFAULT_WINDOW_HEIGHT,
    isMaximized: Boolean(state?.isMaximized),
  };
  if (state && isWindowPositionVisible(state)) {
    options.x = state.x;
    options.y = state.y;
  }
  return options;
}

function getCurrentWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  const bounds = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  return normalizeWindowState({
    ...bounds,
    isMaximized: mainWindow.isMaximized(),
  });
}

async function persistCurrentWindowState() {
  if (process.env.SERIAL_ASSISTANT_SELFTEST === "1") {
    return { ok: true };
  }
  const windowState = getCurrentWindowState();
  if (!windowState) {
    return { ok: false };
  }
  return await updatePersistedState((current) => ({
    ...current,
    window: windowState,
  }));
}

async function readRendererSavedState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  try {
    return await mainWindow.webContents.executeJavaScript("window.__serialAssistantGetSavedState?.() ?? null", true);
  } catch (error) {
    await writeSelfTestLog(`renderer-state-read-error ${error.message}`);
    return null;
  }
}

async function persistCurrentAppState() {
  if (process.env.SERIAL_ASSISTANT_SELFTEST === "1") {
    return { ok: true };
  }
  const rendererState = await readRendererSavedState();
  const windowState = getCurrentWindowState();
  return await updatePersistedState((current) => ({
    ...current,
    ...(rendererState && typeof rendererState === "object" ? rendererState : {}),
    version: 2,
    sessions: Array.isArray(rendererState?.sessions) ? rendererState.sessions : current.sessions,
    preferences: rendererState?.preferences ?? current.preferences,
    window: windowState ?? current.window,
  }));
}

function scheduleWindowStateSave() {
  if (process.env.SERIAL_ASSISTANT_SELFTEST === "1") {
    return;
  }
  if (windowStateSaveTimer) {
    clearTimeout(windowStateSaveTimer);
  }
  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = null;
    void persistCurrentWindowState().catch((error) => {
      void writeSelfTestLog(`window-state-save-error ${error.message}`);
    });
  }, 300);
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

async function ensureRendererServer() {
  if (!app.isPackaged) {
    return null;
  }
  if (rendererServerUrl) {
    return rendererServerUrl;
  }

  const distRoot = getDistRoot();
  rendererServer = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
      const safePath = path.normalize(requestPath).replace(/^(\.\.[\\/])+/, "");
      const resolvedPath = path.join(distRoot, safePath);
      if (!resolvedPath.startsWith(distRoot)) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Forbidden");
        return;
      }
      const body = await fs.readFile(resolvedPath);
      response.writeHead(200, { "Content-Type": getContentType(resolvedPath) });
      response.end(body);
    } catch (error) {
      await writeSelfTestLog(`renderer-error ${error.message}`);
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`Not Found: ${error.message}`);
    }
  });

  await new Promise((resolve, reject) => {
    rendererServer.once("error", reject);
    rendererServer.listen(0, "127.0.0.1", () => {
      const address = rendererServer.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to determine local renderer server port."));
        return;
      }
      rendererServerUrl = `http://127.0.0.1:${address.port}/`;
      resolve(undefined);
    });
  });

  return rendererServerUrl;
}

function emitSerialEvent(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("serial:event", {
    timestamp: Date.now(),
    ...payload,
  });
}

function normalizeHexPayload(value) {
  const compact = value.replace(/[^0-9a-fA-F]/g, "");
  if (!compact.length || compact.length % 2 !== 0) {
    throw new Error("十六进制发送内容需要是偶数长度的有效字节。");
  }
  return Buffer.from(compact, "hex");
}

function createPayloadBuffer(message, encoding, appendNewline) {
  const newline = appendNewline ? "\r\n" : "";
  if (encoding === "hex") {
    const base = normalizeHexPayload(message);
    return appendNewline ? Buffer.concat([base, Buffer.from(newline, "utf8")]) : base;
  }
  return Buffer.from(`${message}${newline}`, encoding === "ascii" ? "ascii" : "utf8");
}

function formatIncomingBuffer(buffer, encoding) {
  const rawHexBuffer = buffer.length > RX_RAW_HEX_BYTE_LIMIT ? buffer.subarray(0, RX_RAW_HEX_BYTE_LIMIT) : buffer;
  const rawHexBase = rawHexBuffer.toString("hex").match(/.{1,2}/g)?.join(" ") ?? "";
  const rawHex =
    buffer.length > RX_RAW_HEX_BYTE_LIMIT
      ? `${rawHexBase} ... (+${buffer.length - RX_RAW_HEX_BYTE_LIMIT} bytes)`
      : rawHexBase;
  if (encoding === "hex") {
    return { text: rawHex, rawHex };
  }
  return {
    text: buffer.toString(encoding === "ascii" ? "ascii" : "utf8"),
    rawHex,
  };
}

function trimRxBuffer(state) {
  while (state.bufferedBytes > RX_DISPLAY_BYTE_LIMIT && state.chunks.length) {
    const extra = state.bufferedBytes - RX_DISPLAY_BYTE_LIMIT;
    const first = state.chunks[0];
    if (first.length <= extra) {
      state.chunks.shift();
      state.bufferedBytes -= first.length;
      continue;
    }
    state.chunks[0] = first.subarray(extra);
    state.bufferedBytes -= extra;
  }
}

function flushPendingRx(sessionId) {
  const state = pendingRx.get(sessionId);
  if (!state) return;
  if (state.timer) {
    clearTimeout(state.timer);
  }
  pendingRx.delete(sessionId);

  if (!state.totalBytes || !state.bufferedBytes) return;
  const buffer = Buffer.concat(state.chunks, state.bufferedBytes);
  const formatted = formatIncomingBuffer(buffer, state.encoding);
  const omittedBytes = Math.max(0, state.totalBytes - state.bufferedBytes);
  const prefix =
    omittedBytes > 0
      ? `[RX ${state.totalBytes} bytes/${RX_FLUSH_INTERVAL_MS}ms, showing latest ${state.bufferedBytes} bytes]\n`
      : "";

  emitSerialEvent({
    sessionId,
    kind: "rx",
    message: `${prefix}${formatted.text}`,
    rawHex: formatted.rawHex,
    bytes: state.totalBytes,
    omittedBytes,
  });
}

function queueRxChunk(sessionId, chunk, encoding) {
  let state = pendingRx.get(sessionId);
  if (!state) {
    state = { chunks: [], totalBytes: 0, bufferedBytes: 0, encoding, timer: null };
    pendingRx.set(sessionId, state);
  }

  state.encoding = encoding;
  state.chunks.push(Buffer.from(chunk));
  state.totalBytes += chunk.length;
  state.bufferedBytes += chunk.length;
  trimRxBuffer(state);

  if (!state.timer) {
    state.timer = setTimeout(() => flushPendingRx(sessionId), RX_FLUSH_INTERVAL_MS);
  }
}

async function listPorts() {
  const SerialPort = await getSerialPortCtor();
  const realPorts = await SerialPort.list();
  return realPorts.map((port) => ({
    path: port.path,
    manufacturer: port.manufacturer ?? "",
    serialNumber: port.serialNumber ?? "",
    vendorId: port.vendorId ?? "",
    productId: port.productId ?? "",
    friendlyName: formatSerialPortName(port) || port.path,
    isVirtual: false,
  }));
}

function wireRealSession(sessionId, port, config) {
  port.on("data", (chunk) => {
    writeLogCache(sessionId, "rx", Buffer.from(chunk), config.encoding);
    queueRxChunk(sessionId, chunk, config.encoding);
  });

  port.on("error", (error) => {
    flushPendingRx(sessionId);
    emitSerialEvent({
      sessionId,
      kind: "error",
      message: error.message,
      code: "port-error",
    });
  });

  port.on("close", () => {
    flushPendingRx(sessionId);
    sessions.delete(sessionId);
    emitSerialEvent({
      sessionId,
      kind: "status",
      message: "串口已断开。",
      code: "disconnected",
    });
  });
}

async function closeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    await endLogCache(sessionId).catch(() => undefined);
    return;
  }
  sessions.delete(sessionId);
  flushPendingRx(sessionId);
  await endLogCache(sessionId).catch(() => undefined);

  if (!session.port.isOpen) {
    return;
  }

  await new Promise((resolve, reject) => {
    session.port.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(undefined);
    });
  });
}

async function createMainWindow() {
  await writeSelfTestLog(`createMainWindow packaged=${app.isPackaged}`);
  const persistedState = normalizePersistedState(await readPersistedState());
  const windowOptions = getWindowCreateOptions(persistedState.window);

  mainWindow = new BrowserWindow({
    title: "多串口测试台 V2.1",
    icon: getAppIconPath(),
    x: windowOptions.x,
    y: windowOptions.y,
    width: windowOptions.width,
    height: windowOptions.height,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    resizable: true,
    thickFrame: true,
    frame: false,
    transparent: false,
    backgroundColor: "#07140e",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  if (windowOptions.isMaximized) {
    mainWindow.maximize();
  }
  await writeSelfTestLog("browserWindow-created");

  let isClosingAfterWindowStateSave = false;
  mainWindow.on("resize", scheduleWindowStateSave);
  mainWindow.on("move", scheduleWindowStateSave);
  mainWindow.on("maximize", scheduleWindowStateSave);
  mainWindow.on("unmaximize", scheduleWindowStateSave);
  mainWindow.on("close", (event) => {
    if (process.env.SERIAL_ASSISTANT_SELFTEST === "1" || isClosingAfterWindowStateSave) {
      return;
    }
    event.preventDefault();
    isClosingAfterWindowStateSave = true;
    if (windowStateSaveTimer) {
      clearTimeout(windowStateSaveTimer);
      windowStateSaveTimer = null;
    }
    void persistCurrentAppState()
      .catch((error) => {
        void writeSelfTestLog(`window-state-close-save-error ${error.message}`);
      })
      .finally(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.destroy();
        }
      });
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    void writeSelfTestLog(`render-process-gone ${JSON.stringify(details)}`);
  });
  mainWindow.webContents.on("unresponsive", () => {
    void writeSelfTestLog("renderer-unresponsive");
  });
  mainWindow.webContents.on("responsive", () => {
    void writeSelfTestLog("renderer-responsive");
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    void writeSelfTestLog(`did-fail-load ${JSON.stringify({ errorCode, errorDescription, validatedURL })}`);
  });
  mainWindow.webContents.on("console-message", (_event, levelOrDetails, message, line, sourceId) => {
    const details = typeof levelOrDetails === "object" && levelOrDetails
      ? levelOrDetails
      : { level: levelOrDetails, message, line, sourceId };
    const text = String(details.message ?? "");
    const level = Number(details.level ?? 0);
    const shouldLog =
      level >= 2 ||
      text.includes("APP_RENDER_ERROR") ||
      text.includes("WINDOW_ERROR") ||
      text.includes("UNHANDLED_REJECTION");
    if (shouldLog) {
      void writeSelfTestLog(`renderer-console ${JSON.stringify({
        level,
        message: text.slice(0, 2000),
        line: details.line ?? details.lineNumber,
        sourceId: details.sourceId,
      })}`);
    }
  });

  mainWindow.webContents.once("did-finish-load", () => {
    void writeSelfTestLog("did-finish-load");
    if (process.env.SERIAL_ASSISTANT_SELFTEST !== "1") {
      return;
    }

    setTimeout(async () => {
      try {
        const summary = await mainWindow.webContents.executeJavaScript(`
          (() => ({
            title: document.title,
            bodyLength: document.body?.innerText?.length ?? 0,
            rootChildren: document.getElementById("root")?.childElementCount ?? 0,
            href: location.href
          }))()
        `);
        const portsResult = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            try {
              if (!window.serialApi?.listPorts) {
                return { ok: false, error: "serialApi.listPorts is not available" };
              }
              const items = await window.serialApi.listPorts();
              return { ok: true, ports: items.map((item) => item.path) };
            } catch (error) {
              return { ok: false, error: error?.message || String(error) };
            }
          })()
        `);
        const resizeResult = [];
        for (const size of [
          { width: 1080, height: 740 },
          { width: 944, height: 949 },
          { width: 820, height: 460 },
        ]) {
          mainWindow.setSize(size.width, size.height, false);
          await new Promise((resolve) => setTimeout(resolve, 180));
          const layout = await mainWindow.webContents.executeJavaScript(`
            (() => {
              const rect = (selector) => {
                const element = document.querySelector(selector);
                if (!element) return null;
                const r = element.getBoundingClientRect();
                return { width: Math.round(r.width), height: Math.round(r.height), bottom: Math.round(r.bottom) };
              };
              const panes = [...document.querySelectorAll(".session-pane")].map((pane) => {
                const paneRect = pane.getBoundingClientRect();
                const send = pane.querySelector(".pane-send-stack")?.getBoundingClientRect();
                const config = pane.querySelector(".pane-config-row")?.getBoundingClientRect();
                const visibleOverflow = Boolean(send && send.bottom > paneRect.bottom + 1) || Boolean(config && config.bottom > paneRect.bottom + 1);
                return {
                  width: Math.round(paneRect.width),
                  height: Math.round(paneRect.height),
                  scrollable: pane.scrollHeight > pane.clientHeight + 1,
                  visibleOverflow,
                };
              });
              return {
                viewport: { width: window.innerWidth, height: window.innerHeight },
                workspace: rect(".workspace"),
                paneGrid: rect(".pane-grid"),
                panes,
                anyVisibleOverflow: panes.some((pane) => pane.visibleOverflow && !pane.scrollable),
              };
            })()
          `);
          resizeResult.push({ ...size, ...layout });
        }
        await writeSelfTestLog(`selftest ${JSON.stringify(summary)}`);
        await writeSelfTestLog(`selftest-ports ${JSON.stringify(portsResult)}`);
        await writeSelfTestLog(`selftest-window ${JSON.stringify({ resizable: mainWindow.isResizable(), bounds: mainWindow.getBounds() })}`);
        await writeSelfTestLog(`selftest-resize ${JSON.stringify(resizeResult)}`);
        const resizeOk = mainWindow.isResizable() && resizeResult.every((item) => item.workspace?.width > 0 && item.paneGrid?.width > 0 && !item.anyVisibleOverflow);
        app.exit(summary.rootChildren > 0 && portsResult.ok && resizeOk ? 0 : 2);
      } catch (error) {
        await writeSelfTestLog(`selftest-error ${error.message}`);
        app.exit(3);
      }
    }, 1800);
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173/renderer.html";
  if (app.isPackaged) {
    const packagedUrl = await ensureRendererServer();
    if (!packagedUrl) {
      throw new Error("Packaged renderer server URL was not created.");
    }
    await writeSelfTestLog(`loadURL ${packagedUrl}`);
    await mainWindow.loadURL(packagedUrl);
  } else {
    await writeSelfTestLog(`loadURL ${devServerUrl}`);
    await mainWindow.loadURL(devServerUrl);
    if (process.env.SERIAL_ASSISTANT_OPEN_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  }

  if (process.env.SERIAL_ASSISTANT_SELFTEST === "1") {
    setTimeout(async () => {
      try {
        const summary = await mainWindow.webContents.executeJavaScript(`
          (() => ({
            rootChildren: document.getElementById("root")?.childElementCount ?? 0,
            bodyLength: document.body?.innerText?.length ?? 0
          }))()
        `);
        await writeSelfTestLog(`selftest-timeout ${JSON.stringify(summary)}`);
        app.exit(summary.rootChildren > 0 ? 0 : 4);
      } catch (error) {
        await writeSelfTestLog(`selftest-timeout-error ${error.message}`);
        app.exit(5);
      }
    }, 7000);
  }

  mainWindow.on("closed", () => {
    if (windowStateSaveTimer) {
      clearTimeout(windowStateSaveTimer);
      windowStateSaveTimer = null;
    }
    mainWindow = null;
  });
}

ipcMain.handle("serial:listPorts", async () => {
  return await listPorts();
});

ipcMain.handle("settings:load", async () => {
  return await readPersistedState();
});

ipcMain.handle("settings:save", async (_, state) => {
  return await writePersistedState(state);
});

ipcMain.handle("serial:connect", async (_, request) => {
  const { sessionId, config } = request;
  await closeSession(sessionId).catch(() => undefined);

  const availablePorts = await listPorts();
  const selected = availablePorts.find((port) => port.path === config.path);
  if (!selected) {
    throw new Error(`串口 ${config.path} 不存在。`);
  }

  const SerialPort = await getSerialPortCtor();
  const port = new SerialPort({
    path: config.path,
    baudRate: Number(config.baudRate),
    dataBits: Number(config.dataBits),
    stopBits: Number(config.stopBits),
    parity: config.parity,
    highWaterMark: 64 * 1024,
    autoOpen: false,
  });

  wireRealSession(sessionId, port, config);

  await new Promise((resolve, reject) => {
    port.open((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(undefined);
    });
  });

  const cache = await createLogCache(sessionId);
  sessions.set(sessionId, { kind: "real", port, config: { ...config }, cache });
  writeLogCache(sessionId, "status", `已连接 ${config.path} @ ${config.baudRate}`, config.encoding);
  emitSerialEvent({
    sessionId,
    kind: "status",
    message: `已连接 ${config.path} @ ${config.baudRate}`,
    code: "connected",
  });
  return { ok: true };
});

ipcMain.handle("serial:disconnect", async (_, sessionId) => {
  await closeSession(sessionId);
  return { ok: true };
});

ipcMain.handle("serial:write", async (_, request) => {
  const { sessionId, message, encoding, appendNewline } = request;
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error("当前会话未连接串口。");
  }

  const payload = createPayloadBuffer(message, encoding, appendNewline);

  await new Promise((resolve, reject) => {
    session.port.write(payload, (error) => {
      if (error) {
        reject(error);
        return;
      }
      session.port.drain((drainError) => {
        if (drainError) {
          reject(drainError);
          return;
        }
        resolve(undefined);
      });
    });
  });

  writeLogCache(sessionId, "tx", payload, encoding);
  emitSerialEvent({
    sessionId,
    kind: "tx",
    message: encoding === "hex" ? payload.toString("hex").match(/.{1,2}/g)?.join(" ") ?? "" : message,
    rawHex: payload.toString("hex").match(/.{1,2}/g)?.join(" ") ?? "",
  });
  return { ok: true, bytes: payload.length };
});

ipcMain.handle("dialog:openTextFile", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "导入日志/回放文件",
    properties: ["openFile"],
    filters: [
      { name: "Replay Data", extensions: ["json", "csv", "txt"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }
  const selectedPath = result.filePaths[0];
  const content = await fs.readFile(selectedPath, "utf8");
  return { canceled: false, path: selectedPath, content };
});

ipcMain.handle("dialog:saveExport", async (_, request) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "导出串口数据",
    defaultPath: request.defaultName,
    filters: [
      { name: "JSON", extensions: ["json"] },
      { name: "CSV", extensions: ["csv"] },
      { name: "Text", extensions: ["txt"] },
      { name: "XML Script", extensions: ["xml"] },
    ],
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }
  await fs.writeFile(result.filePath, request.content, "utf8");
  return { canceled: false, path: result.filePath };
});

ipcMain.handle("dialog:saveCachedLog", async (_, request) => {
  const cache = logCaches.get(request.sessionId);
  if (!cache?.path) {
    throw new Error("当前会话没有可导出的临时缓存。");
  }
  await waitForLogCacheFlush(cache);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "保存本次串口缓存日志",
    defaultPath: request.defaultName,
    filters: [
      { name: "JSON Lines", extensions: ["jsonl"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }
  await pipeline(createReadStream(cache.path), createWriteStream(result.filePath));
  cache.exported = true;
  return { canceled: false, path: result.filePath };
});

ipcMain.handle("logCache:getStatus", async (_, sessionId) => {
  const cache = logCaches.get(sessionId);
  return {
    ok: Boolean(cache),
    bytes: cache?.bytes ?? 0,
    warnBytes: LOG_CACHE_WARN_BYTES,
    limitBytes: LOG_CACHE_LIMIT_BYTES,
    stopped: Boolean(cache?.stopped),
    path: cache?.path,
  };
});

ipcMain.handle("logCache:clear", async (_, sessionId) => {
  await endLogCache(sessionId).catch(() => undefined);
  const cache = logCaches.get(sessionId);
  if (cache?.path) {
    await fs.rm(cache.path, { force: true }).catch(() => undefined);
  }
  logCaches.delete(sessionId);
  const session = sessions.get(sessionId);
  if (session) {
    const nextCache = await createLogCache(sessionId);
    session.cache = nextCache;
  }
  return { ok: true };
});

ipcMain.handle("dialog:chooseBinaryFile", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择待发送文件",
    properties: ["openFile"],
    filters: [
      { name: "Firmware", extensions: ["bin", "hex", "img", "txt"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }
  return { canceled: false, path: result.filePaths[0] };
});

ipcMain.handle("serial:sendFile", async (_, request) => {
  const { sessionId, protocol, filePath } = request;
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error("当前会话未连接串口，无法发送文件。");
  }
  throw new Error(`${protocol.toUpperCase()} file transfer is not implemented in the lightweight desktop build.`);
});

ipcMain.handle("window:setAlwaysOnTop", async (_, nextState) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, alwaysOnTop: false };
  }
  mainWindow.setAlwaysOnTop(Boolean(nextState), "screen-saver");
  return { ok: true, alwaysOnTop: mainWindow.isAlwaysOnTop() };
});

ipcMain.handle("window:getState", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { alwaysOnTop: false, isMaximized: false };
  }
  return { alwaysOnTop: mainWindow.isAlwaysOnTop(), isMaximized: mainWindow.isMaximized() };
});

ipcMain.handle("window:minimize", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false };
  }
  mainWindow.minimize();
  return { ok: true };
});

ipcMain.handle("window:toggleMaximize", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, isMaximized: false };
  }
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
  return { ok: true, isMaximized: mainWindow.isMaximized() };
});

ipcMain.handle("window:close", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false };
  }
  mainWindow.close();
  return { ok: true };
});

app.whenReady().then(async () => {
  await cleanupStaleLogCaches();
  void createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("window-all-closed", async () => {
  await Promise.all([...sessions.keys()].map((sessionId) => closeSession(sessionId).catch(() => undefined)));
  if (rendererServer) {
    await new Promise((resolve) => rendererServer.close(() => resolve(undefined)));
    rendererServer = null;
    rendererServerUrl = "";
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
