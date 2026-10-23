import { Component } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";
import { reportError } from "../errorReporter";

// When a page breaks while it's drawn, this shows a short message (with a
// Reload button) instead of a blank screen, and reports the error to the
// Maintenance page (errorReporter.js).
// Used around each staff page (StaffLayout.jsx, so moving to another page
// clears it) and around the whole app as a last resort (main.jsx).
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    if (error && info?.componentStack && !error.stack?.includes(info.componentStack))
      error.stack = `${error.stack ?? ""}\n${info.componentStack}`;
    reportError(error, "render");
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className={`flex flex-col items-center justify-center gap-3 p-6 text-center ${
          this.props.fullPage ? "min-h-dvh bg-page" : "py-16"
        }`}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <TriangleAlert className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold">Something went wrong on this page</h1>
        <p className="max-w-sm text-sm text-muted">
          It's been reported automatically. Reloading usually fixes it.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn-glass mt-1 flex h-8.5 sm:h-7 cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium transition active:scale-[0.97]"
        >
          <RotateCw className="h-4 w-4" />
          Reload
        </button>
      </div>
    );
  }
}
