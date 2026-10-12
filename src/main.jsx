import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import DataProvider from "./DataProvider";
import "./index.css";
import App from "./App.jsx";
import ErrorBoundary from "./Components/ErrorBoundary";
import { installErrorReporter } from "./errorReporter";

// Errors in the browser are reported to the Maintenance page
installErrorReporter();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary fullPage>
      <BrowserRouter>
        <DataProvider>
          <App />
        </DataProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
