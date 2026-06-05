import { DEFAULT_CONFIG, MAX_BAUD_RATE } from "./appConfig";
import type { SerialPortInfo } from "./types";

export function getPortLabel(port: SerialPortInfo) {
  const friendly = port.friendlyName?.trim();
  const base = friendly && friendly.includes(port.path) ? friendly : [port.path, friendly].filter(Boolean).join(" | ");
  const vendor = [port.vendorId, port.productId].filter(Boolean).join(":");
  const extras = [port.manufacturer, port.serialNumber, vendor].filter((item) => item && !base.includes(item));
  return [base || port.path, ...extras].join(" | ");
}

export function sanitizeBaudRate(value: number) {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_CONFIG.baudRate;
  return Math.min(MAX_BAUD_RATE, Math.round(value));
}
