import type {
  ConnectRequest,
  LogCacheStatus,
  SaveCachedLogRequest,
  SaveExportRequest,
  SerialApiEvent,
  SerialBridge,
  SerialEncoding,
  SerialPortInfo,
  WriteRequest,
} from "./types";

const RX_FLUSH_INTERVAL_MS = 100;
const RX_DISPLAY_BYTE_LIMIT = 64 * 1024;
const RX_RAW_HEX_BYTE_LIMIT = 8 * 1024;
const LOG_CACHE_WARN_BYTES = 90 * 1024 ** 3;
const LOG_CACHE_LIMIT_BYTES = 100 * 1024 ** 3;

type BrowserSerialPort = {
  open(options: {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: "none" | "odd" | "even";
    bufferSize?: number;
    flowControl?: "none" | "hardware";
  }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo?: () => { usbVendorId?: number; usbProductId?: number; bluetoothServiceClassId?: string };
};

type BrowserSerialNavigator = Navigator & {
  serial?: {
    getPorts(): Promise<BrowserSerialPort[]>;
    requestPort(): Promise<BrowserSerialPort>;
  };
};

type WebSession = {
  port: BrowserSerialPort;
  config: ConnectRequest["config"];
  reader?: ReadableStreamDefaultReader<Uint8Array>;
  readAbort: AbortController;
  cache?: WebLogCache;
};

type PendingRxState = {
  chunks: Uint8Array[];
  totalBytes: number;
  bufferedBytes: number;
  encoding: SerialEncoding;
  timer: number | null;
};

type WebLogCache = {
  fileName: string;
  writer?: FileSystemWritableFileStream;
  bytes: number;
  warned: boolean;
  stopped: boolean;
  writeQueue: Promise<void>;
};

const sessions = new Map<string, WebSession>();
const logCaches = new Map<string, WebLogCache>();
const knownPorts = new Map<string, BrowserSerialPort>();
const portPaths = new WeakMap<BrowserSerialPort, string>();
const pendingRx = new Map<string, PendingRxState>();
const listeners = new Set<(payload: SerialApiEvent) => void>();

let nextPortIndex = 1;

function getSerial() {
  return (navigator as BrowserSerialNavigator).serial;
}

function emit(payload: Omit<SerialApiEvent, "timestamp"> & { timestamp?: number }) {
  const event = {
    timestamp: Date.now(),
    ...payload,
  };
  listeners.forEach((listener) => listener(event));
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

function normalizeHexPayload(value: string) {
  const compact = value.replace(/[^0-9a-fA-F]/g, "");
  if (!compact.length || compact.length % 2 !== 0) {
    throw new Error("十六进制发送内容需要是偶数长度的有效字节。");
  }
  return Uint8Array.from(compact.match(/.{1,2}/g)!.map((item) => Number.parseInt(item, 16)));
}

function createPayloadBuffer(message: string, encoding: SerialEncoding, appendNewline: boolean) {
  const newline = appendNewline ? "\r\n" : "";
  if (encoding === "hex") {
    const base = normalizeHexPayload(message);
    if (!appendNewline) return base;
    const suffix = new TextEncoder().encode(newline);
    const merged = new Uint8Array(base.length + suffix.length);
    merged.set(base);
    merged.set(suffix, base.length);
    return merged;
  }
  return new TextEncoder().encode(`${message}${newline}`);
}

function formatIncomingBuffer(buffer: Uint8Array, encoding: SerialEncoding) {
  const rawHexBuffer = buffer.length > RX_RAW_HEX_BYTE_LIMIT ? buffer.slice(0, RX_RAW_HEX_BYTE_LIMIT) : buffer;
  const rawHexBase = toHex(rawHexBuffer);
  const rawHex = buffer.length > RX_RAW_HEX_BYTE_LIMIT
    ? `${rawHexBase} ... (+${buffer.length - RX_RAW_HEX_BYTE_LIMIT} bytes)`
    : rawHexBase;
  if (encoding === "hex") {
    return { text: rawHex, rawHex };
  }
  return {
    text: new TextDecoder(encoding === "ascii" ? "ascii" : "utf-8", { fatal: false }).decode(buffer),
    rawHex,
  };
}

function trimRxBuffer(state: PendingRxState) {
  while (state.bufferedBytes > RX_DISPLAY_BYTE_LIMIT && state.chunks.length) {
    const extra = state.bufferedBytes - RX_DISPLAY_BYTE_LIMIT;
    const first = state.chunks[0];
    if (first.length <= extra) {
      state.chunks.shift();
      state.bufferedBytes -= first.length;
      continue;
    }
    state.chunks[0] = first.slice(extra);
    state.bufferedBytes -= extra;
  }
}

function mergeChunks(chunks: Uint8Array[], totalBytes: number) {
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });
  return merged;
}

function flushPendingRx(sessionId: string) {
  const state = pendingRx.get(sessionId);
  if (!state) return;
  if (state.timer !== null) window.clearTimeout(state.timer);
  pendingRx.delete(sessionId);

  if (!state.totalBytes || !state.bufferedBytes) return;
  const buffer = mergeChunks(state.chunks, state.bufferedBytes);
  const formatted = formatIncomingBuffer(buffer, state.encoding);
  const omittedBytes = Math.max(0, state.totalBytes - state.bufferedBytes);
  const prefix = omittedBytes > 0
    ? `[RX ${state.totalBytes} bytes/${RX_FLUSH_INTERVAL_MS}ms, showing latest ${state.bufferedBytes} bytes]\n`
    : "";

  emit({
    sessionId,
    kind: "rx",
    message: `${prefix}${formatted.text}`,
    rawHex: formatted.rawHex,
    bytes: state.totalBytes,
    omittedBytes,
  });
}

function queueRxChunk(sessionId: string, chunk: Uint8Array, encoding: SerialEncoding) {
  let state = pendingRx.get(sessionId);
  if (!state) {
    state = { chunks: [], totalBytes: 0, bufferedBytes: 0, encoding, timer: null };
    pendingRx.set(sessionId, state);
  }

  state.encoding = encoding;
  state.chunks.push(chunk.slice());
  state.totalBytes += chunk.length;
  state.bufferedBytes += chunk.length;
  trimRxBuffer(state);

  if (state.timer === null) {
    state.timer = window.setTimeout(() => flushPendingRx(sessionId), RX_FLUSH_INTERVAL_MS);
  }
}

function getPortInfo(port: BrowserSerialPort): SerialPortInfo {
  let path = portPaths.get(port);
  if (!path) {
    path = `WEB-SERIAL-${nextPortIndex++}`;
    portPaths.set(port, path);
  }
  knownPorts.set(path, port);

  const info = port.getInfo?.() ?? {};
  const vendorId = info.usbVendorId === undefined ? "" : info.usbVendorId.toString(16).padStart(4, "0").toUpperCase();
  const productId = info.usbProductId === undefined ? "" : info.usbProductId.toString(16).padStart(4, "0").toUpperCase();
  const transport = info.bluetoothServiceClassId ? "Bluetooth" : "Web Serial";
  const friendlyName = [path, transport, [vendorId, productId].filter(Boolean).join(":")].filter(Boolean).join(" | ");

  return {
    path,
    manufacturer: transport,
    serialNumber: "",
    vendorId,
    productId,
    friendlyName,
    isWeb: true,
  };
}

async function openLogCache(sessionId: string): Promise<WebLogCache | undefined> {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };
  if (!storage.getDirectory) {
    return undefined;
  }
  const root = await storage.getDirectory();
  const fileName = `serial-cache-${sessionId}.jsonl`;
  const handle = await root.getFileHandle(fileName, { create: true });
  const writer = await handle.createWritable({ keepExistingData: false });
  const cache = { fileName, writer, bytes: 0, warned: false, stopped: false, writeQueue: Promise.resolve() };
  logCaches.set(sessionId, cache);
  return cache;
}

async function cleanupStaleWebLogCaches() {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle & {
      entries?: () => AsyncIterable<[string, FileSystemHandle]>;
      removeEntry?: (name: string, options?: { recursive?: boolean }) => Promise<void>;
    }>;
  };
  if (!storage.getDirectory) return;
  const root = await storage.getDirectory();
  if (!root.entries || !root.removeEntry) return;
  for await (const [name] of root.entries()) {
    if (name.startsWith("serial-cache-") && name.endsWith(".jsonl")) {
      await root.removeEntry(name).catch(() => undefined);
    }
  }
}

function cacheLine(kind: "rx" | "tx" | "status" | "error", bytes: Uint8Array | string, encoding: SerialEncoding) {
  let base64 = "";
  if (typeof bytes !== "string") {
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      base64 += btoa(String.fromCharCode(...bytes.slice(offset, offset + 0x8000)));
    }
  }
  const payload = typeof bytes === "string"
    ? { text: bytes }
    : { base64 };
  return `${JSON.stringify({ timestamp: new Date().toISOString(), kind, encoding, bytes: typeof bytes === "string" ? undefined : bytes.length, ...payload })}\n`;
}

async function writeCache(sessionId: string, kind: "rx" | "tx" | "status" | "error", payload: Uint8Array | string, encoding: SerialEncoding) {
  const cache = logCaches.get(sessionId);
  if (!cache || cache.stopped || !cache.writer) return;

  const line = cacheLine(kind, payload, encoding);
  const lineBytes = new TextEncoder().encode(line).length;
  if (cache.bytes + lineBytes >= LOG_CACHE_LIMIT_BYTES) {
    cache.stopped = true;
    cache.writeQueue = cache.writeQueue.then(() => cache.writer?.write(cacheLine("error", "日志缓存已达到 100GB，已停止继续记录。请导出当前缓存后再清理或重新连接。", encoding))).then(() => undefined);
    await cache.writeQueue;
    emit({
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

  cache.writeQueue = cache.writeQueue.then(() => cache.writer?.write(line)).then(() => undefined);
  await cache.writeQueue;
  cache.bytes += lineBytes;
  if (!cache.warned && cache.bytes >= LOG_CACHE_WARN_BYTES) {
    cache.warned = true;
    emit({
      sessionId,
      kind: "status",
      message: "日志缓存已超过 90GB，建议尽快导出保存并清理缓存。",
      code: "log-cache-warning",
      cacheBytes: cache.bytes,
      cacheLimitBytes: LOG_CACHE_LIMIT_BYTES,
    });
  }
}

async function readLoop(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session?.port.readable) return;

  try {
    while (!session.readAbort.signal.aborted && session.port.readable) {
      const reader = session.port.readable.getReader();
      session.reader = reader;
      try {
        while (!session.readAbort.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value?.length) {
            void writeCache(sessionId, "rx", value, session.config.encoding);
            queueRxChunk(sessionId, value, session.config.encoding);
          }
        }
      } finally {
        reader.releaseLock();
        session.reader = undefined;
      }
    }
  } catch (error) {
    if (!session.readAbort.signal.aborted) {
      emit({
        sessionId,
        kind: "error",
        message: error instanceof Error ? error.message : "网页串口读取失败",
        code: "port-error",
      });
    }
  } finally {
    flushPendingRx(sessionId);
  }
}

async function downloadFile(defaultName: string, content: BlobPart | Blob) {
  const saveFilePicker = (window as Window & {
    showSaveFilePicker?: (options?: { suggestedName?: string }) => Promise<FileSystemFileHandle>;
  }).showSaveFilePicker;
  if (saveFilePicker) {
    const handle = await saveFilePicker({ suggestedName: defaultName });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return { canceled: false, path: handle.name };
  }

  const blob = content instanceof Blob ? content : new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = defaultName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return { canceled: false };
}

async function saveCachedLog(request: SaveCachedLogRequest) {
  const cache = logCaches.get(request.sessionId);
  if (!cache) {
    return { canceled: true };
  }
  await cache.writer?.close();
  cache.writer = undefined;

  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };
  if (!storage.getDirectory) {
    return { canceled: true };
  }
  const root = await storage.getDirectory();
  const handle = await root.getFileHandle(cache.fileName, { create: false });
  const file = await handle.getFile();
  const result = await downloadFile(request.defaultName, file);
  cache.writer = await handle.createWritable({ keepExistingData: true });
  await cache.writer.seek(file.size);
  return result;
}

export function installWebSerialBridge() {
  if (window.serialApi) return;
  void cleanupStaleWebLogCaches();

  const bridge: SerialBridge = {
    async listPorts() {
      const serial = getSerial();
      if (!serial) return [];
      return (await serial.getPorts()).map(getPortInfo);
    },

    async requestPort() {
      const serial = getSerial();
      if (!serial) {
        throw new Error("当前浏览器不支持 Web Serial，请使用 Chrome/Edge 或桌面 EXE。");
      }
      return getPortInfo(await serial.requestPort());
    },

    async connectSession(request: ConnectRequest) {
      const serial = getSerial();
      if (!serial) {
        throw new Error("当前浏览器不支持 Web Serial，请使用 Chrome/Edge 或桌面 EXE。");
      }
      await bridge.disconnectSession(request.sessionId);
      const port = knownPorts.get(request.config.path);
      if (!port) {
        throw new Error("网页串口尚未授权，请先点击授权网页串口。");
      }

      await port.open({
        baudRate: Number(request.config.baudRate),
        dataBits: Number(request.config.dataBits),
        stopBits: Number(request.config.stopBits),
        parity: request.config.parity,
        bufferSize: 64 * 1024,
        flowControl: "none",
      });

      const cache = await openLogCache(request.sessionId).catch(() => undefined);
      const session: WebSession = {
        port,
        config: { ...request.config },
        readAbort: new AbortController(),
        cache,
      };
      sessions.set(request.sessionId, session);
      void writeCache(request.sessionId, "status", `网页串口已连接 ${request.config.path} @ ${request.config.baudRate}`, request.config.encoding);
      emit({
        sessionId: request.sessionId,
        kind: "status",
        message: `网页串口已连接 ${request.config.path} @ ${request.config.baudRate}`,
        code: "connected",
      });
      void readLoop(request.sessionId);
      return { ok: true };
    },

    async disconnectSession(sessionId: string) {
      const session = sessions.get(sessionId);
      if (!session) return { ok: true };
      sessions.delete(sessionId);
      flushPendingRx(sessionId);
      session.readAbort.abort();
      await session.reader?.cancel().catch(() => undefined);
      await session.port.close().catch(() => undefined);
      await session.cache?.writer?.close().catch(() => undefined);
      emit({
        sessionId,
        kind: "status",
        message: "网页串口已断开。",
        code: "disconnected",
      });
      return { ok: true };
    },

    async writeData(request: WriteRequest) {
      const session = sessions.get(request.sessionId);
      if (!session?.port.writable) {
        throw new Error("当前会话未连接串口。");
      }
      const payload = createPayloadBuffer(request.message, request.encoding, request.appendNewline);
      const writer = session.port.writable.getWriter();
      try {
        await writer.write(payload);
      } finally {
        writer.releaseLock();
      }
      void writeCache(request.sessionId, "tx", payload, request.encoding);
      emit({
        sessionId: request.sessionId,
        kind: "tx",
        message: request.encoding === "hex" ? toHex(payload) : request.message,
        rawHex: toHex(payload),
        bytes: payload.length,
      });
      return { ok: true, bytes: payload.length };
    },

    async openTextFile() {
      return { canceled: true };
    },

    async saveExport(request: SaveExportRequest) {
      return await downloadFile(request.defaultName, request.content);
    },

    saveCachedLog,

    async getLogCacheStatus(sessionId: string): Promise<LogCacheStatus> {
      const cache = logCaches.get(sessionId);
      return {
        ok: Boolean(cache),
        bytes: cache?.bytes ?? 0,
        warnBytes: LOG_CACHE_WARN_BYTES,
        limitBytes: LOG_CACHE_LIMIT_BYTES,
        stopped: Boolean(cache?.stopped),
      };
    },

    async clearLogCache(sessionId: string) {
      const cache = logCaches.get(sessionId);
      await cache?.writer?.close().catch(() => undefined);
      logCaches.delete(sessionId);
      const session = sessions.get(sessionId);
      if (session) {
        session.cache = await openLogCache(sessionId);
      }
      return { ok: true };
    },

    async chooseBinaryFile() {
      return { canceled: true };
    },

    async sendFile() {
      throw new Error("网页版暂不支持协议文件发送。");
    },

    async setAlwaysOnTop(nextState: boolean) {
      return { ok: true, alwaysOnTop: nextState };
    },

    async getWindowState() {
      return { alwaysOnTop: false, isMaximized: false };
    },

    async minimizeWindow() {
      return { ok: true };
    },

    async toggleMaximizeWindow() {
      return { ok: true, isMaximized: false };
    },

    async closeWindow() {
      window.close();
      return { ok: true };
    },

    async loadSavedState() {
      return null;
    },

    async saveSavedState() {
      return { ok: true };
    },

    onSessionEvent(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };

  window.serialApi = bridge;
}
