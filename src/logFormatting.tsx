import type { ReactNode } from "react";
import {
  MAX_LOG_MESSAGE_CHARS,
  MAX_LOG_RAW_HEX_CHARS,
} from "./appConfig";
import { trimLogWindow } from "./logWindow";
import type { ActionStep, LogEntry, SessionState } from "./types";

export function detectAccent(message: string, kind: LogEntry["kind"]): LogEntry["accent"] {
  const lowered = message.toLowerCase();
  if (kind === "error" || lowered.includes("error") || lowered.includes("fail")) return "danger";
  if (lowered.includes("ok") || lowered.includes("ack")) return "success";
  if (lowered.includes("warn") || lowered.includes("timeout")) return "warning";
  return "neutral";
}

export function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  const base = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
  return `${base}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

export function textToHex(value: string) {
  return Array.from(new TextEncoder().encode(value))
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

function getAnsiClass(codes: string) {
  const values = codes.split(";").map((item) => Number(item || 0));
  if (values.includes(0)) return "";
  if (values.includes(90)) return "log-ansi-gray";
  if (values.includes(94) || values.includes(34)) return "log-level-trace";
  if (values.includes(36)) return "log-level-debug";
  if (values.includes(32)) return "log-level-info";
  if (values.includes(33)) return "log-level-warn";
  if (values.includes(31)) return "log-level-error";
  if (values.includes(35)) return "log-level-fatal";
  return "";
}

function getLevelClass(level: string) {
  const normalized = level.toUpperCase();
  if (normalized === "TRACE") return "log-level-trace";
  if (normalized.startsWith("DEBUG")) return "log-level-debug";
  if (normalized === "INFO") return "log-level-info";
  if (normalized === "WARN" || normalized === "WARNING") return "log-level-warn";
  if (normalized === "ERROR") return "log-level-error";
  if (normalized === "FATAL") return "log-level-fatal";
  return "";
}

function renderFileRefs(text: string, keyPrefix: string) {
  const parts: ReactNode[] = [];
  const filePattern = /([A-Za-z0-9_./\\:-]+\.(?:c|h|cc|cpp|cxx|hpp):\d+:?)/g;
  let lastIndex = 0;
  let index = 0;
  text.replace(filePattern, (match, _fileRef, offset: number) => {
    if (offset > lastIndex) parts.push(text.slice(lastIndex, offset));
    parts.push(<span key={`${keyPrefix}-file-${index++}`} className="log-file-ref">{match}</span>);
    lastIndex = offset + match.length;
    return match;
  });
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length ? parts : [text];
}

export function renderColorizedText(text: string) {
  if (!text) return null;
  const escapeChar = String.fromCharCode(27);
  if (text.includes(`${escapeChar}[`)) {
    const parts: ReactNode[] = [];
    const ansiPattern = new RegExp(`${escapeChar}\\[([0-9;]*)m`, "g");
    let currentClass = "";
    let lastIndex = 0;
    let index = 0;
    text.replace(ansiPattern, (match, codes: string, offset: number) => {
      if (offset > lastIndex) {
        const chunk = text.slice(lastIndex, offset);
        parts.push(currentClass ? <span key={`ansi-${index++}`} className={currentClass}>{chunk}</span> : chunk);
      }
      currentClass = getAnsiClass(codes);
      lastIndex = offset + match.length;
      return match;
    });
    if (lastIndex < text.length) {
      const chunk = text.slice(lastIndex);
      parts.push(currentClass ? <span key={`ansi-${index++}`} className={currentClass}>{chunk}</span> : chunk);
    }
    return parts;
  }

  const levelMatch = text.match(/^(\s*)(TRACE|DEBUGR?|INFO|WARN(?:ING)?|ERROR|FATAL)(\s+)/i);
  if (!levelMatch) return renderFileRefs(text, "plain");
  const [, leading, level, gap] = levelMatch;
  const rest = text.slice(levelMatch[0].length);
  return [
    leading,
    <span key="level" className={getLevelClass(level)}>{level}</span>,
    gap,
    ...renderFileRefs(rest, "level-rest"),
  ];
}

function trimText(value: string | undefined, maxChars: number) {
  if (!value) return value;
  if (value.length <= maxChars) return value;
  const omitted = value.length - maxChars;
  return `${value.slice(0, maxChars)}\n...[已截断 ${omitted} 字符，完整内容请导出日志]`;
}

export function compactLogEntry(entry: LogEntry): LogEntry {
  return {
    ...entry,
    message: trimText(entry.message, MAX_LOG_MESSAGE_CHARS) ?? "",
    rawHex: trimText(entry.rawHex, MAX_LOG_RAW_HEX_CHARS),
  };
}

export function trimLogEntries(entries: LogEntry[]) {
  return trimLogWindow(entries);
}

export function getDisplayMessage(session: Pick<SessionState, "showRawHex">, entry: LogEntry) {
  if (!session.showRawHex) return entry.message;
  return entry.rawHex ? entry.rawHex.toUpperCase() : textToHex(entry.message);
}

export function estimateByteCount(entry: LogEntry) {
  if (typeof entry.bytes === "number") return entry.bytes;
  if (typeof entry.rawHex === "string" && entry.rawHex.trim()) {
    return entry.rawHex.match(/\b[0-9a-fA-F]{2}\b/g)?.length ?? 0;
  }
  return new TextEncoder().encode(entry.message).length;
}

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let next = value;
  let index = 0;
  while (next >= 1024 && index < units.length - 1) {
    next /= 1024;
    index += 1;
  }
  return `${next >= 10 || index === 0 ? Math.round(next) : next.toFixed(1)} ${units[index]}`;
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

export function formatLogExport(session: SessionState, format: "json" | "csv" | "txt") {
  if (format === "json") return JSON.stringify(session.logs, null, 2);
  if (format === "csv") {
    return ["timestamp,kind,bytes,omittedBytes,message,rawHex"].concat(
      session.logs.map((entry) =>
        [
          new Date(entry.timestamp).toISOString(),
          entry.kind,
          entry.bytes ?? "",
          entry.omittedBytes ?? "",
          csvCell(entry.message),
          csvCell(entry.rawHex ?? ""),
        ].join(","),
      ),
    ).join("\n");
  }
  return session.logs.map((entry) => {
    const raw = entry.rawHex ? ` | HEX ${entry.rawHex}` : "";
    const pressure = entry.omittedBytes ? ` | omitted ${entry.omittedBytes} bytes` : "";
    return `${new Date(entry.timestamp).toISOString()} [${entry.kind.toUpperCase()}] ${entry.message}${raw}${pressure}`;
  }).join("\n");
}

function xmlCell(value: string | number | boolean | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function formatScriptXml(session: SessionState, actionTape: ActionStep[]) {
  const recordedSteps = actionTape.filter((step) => step.kind === "send" && step.payload);
  const steps = recordedSteps.length
    ? recordedSteps
    : session.commands.filter((command) => command.enabled && command.payload.trim()).map((command) => ({
      id: command.id,
      kind: "send" as const,
      label: command.label,
      sessionId: session.id,
      sessionTitle: session.title,
      path: session.config.path,
      payload: command.payload,
      encoding: command.encoding,
      appendNewline: command.appendNewline,
      delayMs: command.delayMs,
    }));

  const body = steps.map((step, index) => [
    `  <step index="${index + 1}" type="${xmlCell(step.kind)}" label="${xmlCell(step.label)}" delayMs="${xmlCell(step.delayMs)}">`,
    `    <target session="${xmlCell(step.sessionTitle ?? session.title)}" port="${xmlCell(step.path ?? session.config.path)}" />`,
    `    <send encoding="${xmlCell(step.encoding ?? session.config.encoding)}" appendNewline="${xmlCell(step.appendNewline ?? session.config.appendNewline)}">${xmlCell(step.payload)}</send>`,
    "  </step>",
  ].join("\n")).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<serialScript name="${xmlCell(session.title)}" generatedAt="${new Date().toISOString()}">`,
    body || "  <!-- No recorded or enabled send steps. -->",
    "</serialScript>",
  ].join("\n");
}

export function downloadTextFile(defaultName: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = defaultName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
