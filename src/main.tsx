import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

type RootErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

class RootErrorBoundary extends React.Component<React.PropsWithChildren, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown): RootErrorBoundaryState {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Root] render_crash: ${message}`);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="app-loading-state" role="alert" aria-live="assertive">
          <p>Unexpected error. Please restart ClearMind.</p>
          {this.state.message && <p>{this.state.message}</p>}
          <button type="button" className="app-retry-button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
);
