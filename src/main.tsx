import { StrictMode, Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { installWebSerialBridge } from "./webSerialBridge.ts";

installWebSerialBridge();

class AppErrorBoundary extends Component<{ children: ReactNode }, { errorMessage: string | null }> {
  state = {
    errorMessage: null,
  };

  static getDerivedStateFromError(error: Error) {
    return {
      errorMessage: error.message || "Unknown renderer error",
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("APP_RENDER_ERROR", error, errorInfo.componentStack);
  }

  render() {
    if (this.state.errorMessage) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            background: "#111315",
            color: "#f4f7fb",
            padding: "24px",
            fontFamily: "\"Segoe UI\", sans-serif",
          }}
        >
          <div
            style={{
              width: "min(720px, 100%)",
              border: "1px solid #32353d",
              borderRadius: "8px",
              background: "#1d1f24",
              padding: "20px",
            }}
          >
            <h1 style={{ margin: "0 0 12px", fontSize: "20px" }}>SerialAssistant renderer error</h1>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                color: "#ff9b9b",
                fontFamily: "Consolas, monospace",
              }}
            >
              {this.state.errorMessage}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

window.addEventListener("error", (event) => {
  console.error("WINDOW_ERROR", event.message, event.error?.stack ?? "");
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason);
  console.error("UNHANDLED_REJECTION", reason);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
