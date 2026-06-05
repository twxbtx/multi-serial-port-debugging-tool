import {
  ACTION_TAPE_KEY,
  DEFAULT_CONFIG,
  MAX_LOG_FONT_SIZE,
  MIN_LOG_FONT_SIZE,
  STORAGE_KEY,
  THEMES,
} from "./appConfig";
import type {
  ActionStep,
  AppPreferenceState,
  ConnectionConfig,
  SavedAppState,
  SessionCommand,
  SessionState,
} from "./types";

export function createCommand(label: string, payload: string, encoding: ConnectionConfig["encoding"] = "utf8"): SessionCommand {
  return {
    id: crypto.randomUUID(),
    label,
    payload,
    encoding,
    enabled: true,
    delayMs: 0,
    appendNewline: true,
  };
}

export function defaultCommands() {
  return [createCommand("CMD1", "CMD1"), createCommand("CMD2", "CMD2")];
}

export function createSession(index: number, overrides?: Partial<SessionState>): SessionState {
  return {
    id: overrides?.id ?? crypto.randomUUID(),
    title: overrides?.title ?? `串口 ${index + 1}`,
    connected: false,
    simulated: false,
    config: { ...DEFAULT_CONFIG, ...overrides?.config },
    draftMessage: overrides?.draftMessage ?? "",
    filterText: overrides?.filterText ?? "",
    showFilteredOnly: overrides?.showFilteredOnly ?? false,
    showTimestamp: overrides?.showTimestamp ?? true,
    showRawHex: overrides?.showRawHex ?? false,
    showPacketInfo: overrides?.showPacketInfo ?? true,
    showLineWrap: overrides?.showLineWrap ?? false,
    logFontSize: Math.min(MAX_LOG_FONT_SIZE, Math.max(MIN_LOG_FONT_SIZE, Number(overrides?.logFontSize) || 10)),
    autoScroll: overrides?.autoScroll ?? true,
    isRecording: false,
    logs: [],
    commands: overrides?.commands?.length ? overrides.commands : defaultCommands(),
    actionTape: [],
    automation: {
      intervalMs: overrides?.automation?.intervalMs ?? 1000,
      durationMs: overrides?.automation?.durationMs ?? 60000,
      elapsedMs: 0,
      infiniteLoop: overrides?.automation?.infiniteLoop ?? true,
      isRunning: false,
    },
    window: {
      pinned: overrides?.window?.pinned ?? index === 0,
    },
  };
}

export function loadSessions() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("reset")) {
      localStorage.removeItem(STORAGE_KEY);
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [createSession(0), createSession(1)];
    const parsed = JSON.parse(raw) as Partial<SessionState>[];
    return parsed.length ? parsed.map((item, index) => createSession(index, item)) : [createSession(0), createSession(1)];
  } catch {
    return [createSession(0), createSession(1)];
  }
}

export function loadActionTape() {
  try {
    const raw = localStorage.getItem(ACTION_TAPE_KEY);
    return raw ? (JSON.parse(raw) as ActionStep[]) : [];
  } catch {
    return [];
  }
}

export function isPaneLayout(value: unknown): value is NonNullable<AppPreferenceState["paneLayout"]> {
  return value === "auto" || value === "horizontal" || value === "vertical";
}

export function isKnownTheme(value: unknown): value is string {
  return typeof value === "string" && THEMES.some((theme) => theme.id === value);
}

function getSessionSnapshot(session: SessionState): Partial<SessionState> {
  return {
    ...session,
    connected: false,
    simulated: false,
    logs: [],
    actionTape: [],
    automation: { ...session.automation, elapsedMs: 0, isRunning: false },
  };
}

export function createSavedState(sessions: SessionState[], preferences: AppPreferenceState): SavedAppState {
  return {
    version: 2,
    savedAt: Date.now(),
    sessions: sessions.map(getSessionSnapshot),
    preferences: {
      ...preferences,
      globalActionTape: preferences.globalActionTape?.slice(-200) ?? [],
    },
  };
}
