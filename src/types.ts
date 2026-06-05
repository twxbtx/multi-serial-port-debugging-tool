export type SerialEncoding = "utf8" | "ascii" | "hex";
export type SerialParity = "none" | "odd" | "even";
export type ProtocolKind = "xmodem" | "ymodem";
export type LogKind = "rx" | "tx" | "info" | "error" | "status";
export type ActionKind = "connect" | "disconnect" | "send" | "command" | "wait";
export type MacroStepState = "idle" | "running" | "ok" | "fail";

export interface SerialPortInfo {
  path: string;
  manufacturer: string;
  serialNumber: string;
  vendorId: string;
  productId: string;
  friendlyName: string;
  isVirtual?: boolean;
  isWeb?: boolean;
}

export interface ConnectionConfig {
  path: string;
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  stopBits: 1 | 2;
  parity: SerialParity;
  encoding: SerialEncoding;
  appendNewline: boolean;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  kind: LogKind;
  message: string;
  rawHex?: string;
  bytes?: number;
  omittedBytes?: number;
  accent?: "warning" | "success" | "danger" | "neutral";
}

export interface SessionCommand {
  id: string;
  label: string;
  payload: string;
  encoding: SerialEncoding;
  enabled: boolean;
  delayMs: number;
  appendNewline: boolean;
}

export interface ActionStep {
  id: string;
  kind: ActionKind;
  label: string;
  sessionId?: string;
  sessionTitle?: string;
  path?: string;
  payload?: string;
  encoding?: SerialEncoding;
  appendNewline?: boolean;
  delayMs: number;
  result?: MacroStepState;
}

export interface AutomationState {
  intervalMs: number;
  durationMs: number;
  elapsedMs: number;
  infiniteLoop: boolean;
  isRunning: boolean;
}

export interface SessionWindowState {
  pinned: boolean;
}

export interface SessionState {
  id: string;
  title: string;
  connected: boolean;
  simulated: boolean;
  config: ConnectionConfig;
  draftMessage: string;
  filterText: string;
  showFilteredOnly: boolean;
  showTimestamp: boolean;
  showRawHex: boolean;
  showPacketInfo: boolean;
  showLineWrap: boolean;
  logFontSize: number;
  autoScroll: boolean;
  isRecording: boolean;
  logs: LogEntry[];
  commands: SessionCommand[];
  actionTape: ActionStep[];
  automation: AutomationState;
  window: SessionWindowState;
}

export interface ThemePreset {
  id: string;
  label: string;
  description: string;
}

export interface SerialApiEvent {
  sessionId: string;
  timestamp: number;
  kind: LogKind | "file-progress";
  message?: string;
  rawHex?: string;
  bytes?: number;
  omittedBytes?: number;
  code?: string;
  progress?: number;
  protocol?: ProtocolKind;
  active?: boolean;
  failed?: boolean;
  cacheBytes?: number;
  cacheLimitBytes?: number;
  cacheStopped?: boolean;
}

export interface ConnectRequest {
  sessionId: string;
  config: ConnectionConfig;
}

export interface WriteRequest {
  sessionId: string;
  message: string;
  encoding: SerialEncoding;
  appendNewline: boolean;
}

export interface SaveExportRequest {
  defaultName: string;
  content: string;
}

export interface SaveCachedLogRequest {
  sessionId: string;
  defaultName: string;
}

export interface LogCacheStatus {
  ok: boolean;
  bytes: number;
  warnBytes: number;
  limitBytes: number;
  stopped: boolean;
  path?: string;
}

export interface SendFileRequest {
  sessionId: string;
  protocol: ProtocolKind;
  filePath: string;
}

export interface AppPreferenceState {
  themeId?: string;
  paneLayout?: "auto" | "horizontal" | "vertical";
  leftSidebarLocked?: boolean;
  rightInspectorLocked?: boolean;
  activeSessionId?: string;
  globalActionTape?: ActionStep[];
}

export interface PersistedWindowState {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isMaximized?: boolean;
}

export interface SavedAppState {
  version: 1 | 2;
  savedAt: number;
  sessions: Partial<SessionState>[];
  preferences?: AppPreferenceState;
  window?: PersistedWindowState;
}

export interface SerialBridge {
  listPorts(): Promise<SerialPortInfo[]>;
  requestPort?(): Promise<SerialPortInfo>;
  connectSession(request: ConnectRequest): Promise<{ ok: boolean }>;
  disconnectSession(sessionId: string): Promise<{ ok: boolean }>;
  writeData(request: WriteRequest): Promise<{ ok: boolean; bytes: number }>;
  openTextFile(): Promise<{ canceled: boolean; path?: string; content?: string }>;
  saveExport(request: SaveExportRequest): Promise<{ canceled: boolean; path?: string }>;
  saveCachedLog?(request: SaveCachedLogRequest): Promise<{ canceled: boolean; path?: string }>;
  getLogCacheStatus?(sessionId: string): Promise<LogCacheStatus>;
  clearLogCache?(sessionId: string): Promise<{ ok: boolean }>;
  chooseBinaryFile(): Promise<{ canceled: boolean; path?: string }>;
  sendFile(request: SendFileRequest): Promise<{ ok: boolean }>;
  setAlwaysOnTop(nextState: boolean): Promise<{ ok: boolean; alwaysOnTop: boolean }>;
  getWindowState(): Promise<{ alwaysOnTop: boolean; isMaximized: boolean }>;
  minimizeWindow(): Promise<{ ok: boolean }>;
  toggleMaximizeWindow(): Promise<{ ok: boolean; isMaximized: boolean }>;
  closeWindow(): Promise<{ ok: boolean }>;
  loadSavedState(): Promise<SavedAppState | null>;
  saveSavedState(state: SavedAppState): Promise<{ ok: boolean }>;
  onSessionEvent(callback: (payload: SerialApiEvent) => void): () => void;
}
