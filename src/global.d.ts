import type { SavedAppState, SerialBridge } from "./types";

declare global {
  interface Window {
    serialApi?: SerialBridge;
    __serialAssistantGetSavedState?: () => SavedAppState;
  }
}

export {};
