import type { ConnectionConfig, ThemePreset } from "./types";

export const STORAGE_KEY = "serial-assistant.v2.sessions";
export const THEME_KEY = "serial-assistant.v3.theme";
export const PANE_LAYOUT_KEY = "serial-assistant.v2.pane-layout";
export const SIDEBAR_KEY = "serial-assistant.v2.left-sidebar";
export const INSPECTOR_KEY = "serial-assistant.v2.right-inspector";
export const ACTION_TAPE_KEY = "serial-assistant.v2.action-tape";

export const MAX_LOGS = 520;
export const MAX_RENDERED_LOGS = 120;
export const MAX_LOG_MESSAGE_CHARS = 1400;
export const MAX_LOG_RAW_HEX_CHARS = 900;
export const MAX_LOG_CHAR_BUDGET = 180_000;
export const MIN_LOG_FONT_SIZE = 8;
export const MAX_LOG_FONT_SIZE = 18;
export const SERIAL_EVENT_FLUSH_MS = 100;
export const SERIAL_EVENT_BATCH_LIMIT = 120;
export const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1000000, 1500000, 2000000, 3000000, 4000000, 6000000, 7000000];
export const MAX_BAUD_RATE = 10_000_000;

export const THEMES: ThemePreset[] = [
  { id: "ios-glass", label: "iOS 玻璃", description: "浅色磨砂玻璃控制台" },
  { id: "deep-dark", label: "深色主体", description: "默认深色调试台" },
  { id: "tech-blue", label: "深蓝科技", description: "高对比蓝色科技风" },
  { id: "eco-green", label: "环保绿", description: "绿色低疲劳监看" },
  { id: "vital-orange", label: "活力橙", description: "醒目活力强调色" },
  { id: "elegant-purple", label: "优雅紫", description: "柔和紫色工作台" },
  { id: "industrial-dark", label: "TI 红", description: "WBMS Master Station 深色红" },
  { id: "classic-light", label: "浅色", description: "长时间阅读" },
  { id: "oscilloscope", label: "示波绿", description: "高对比日志" },
  { id: "graphite", label: "石墨", description: "低亮度" },
];

export const DEFAULT_CONFIG: ConnectionConfig = {
  path: "",
  baudRate: 2000000,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  encoding: "utf8",
  appendNewline: true,
};
