import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { ConfirmProvider, ToastProvider } from "./design-system";
import { PromptProvider } from "./components/ui/PromptDialog";
import { reportCardVerifyRouterBasename } from "./lib/reportCardVerifyRoute";
import { demoRuntimeEnabled } from "./lib/featureFlags";
import { DemoEntryPage } from "./pages/DemoEntryPage";
import { DemoRuntimeEntryPage } from "./pages/DemoRuntimeEntryPage";
import "./index.css";

const appBasename =
  import.meta.env.BASE_URL === "/" ? undefined : import.meta.env.BASE_URL.replace(/\/$/, "");
const routerBasename = reportCardVerifyRouterBasename(
  typeof window !== "undefined" ? window.location.pathname : "",
  appBasename,
);

function RootRoute() {
  const location = useLocation();
  if (location.pathname === "/demo") {
    return <DemoEntryPage />;
  }
  if (location.pathname === "/entry" && demoRuntimeEnabled) {
    return <DemoRuntimeEntryPage />;
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter basename={routerBasename}>
      <ToastProvider>
        <ConfirmProvider>
          <PromptProvider>
            <AuthProvider>
              <RootRoute />
            </AuthProvider>
          </PromptProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
