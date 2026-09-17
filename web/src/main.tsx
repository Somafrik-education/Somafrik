import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { ConfirmProvider, ToastProvider } from "./design-system";
import { PromptProvider } from "./components/ui/PromptDialog";
import { DemoEntryPage } from "./pages/DemoEntryPage";
import "./index.css";

const routerBasename =
  import.meta.env.BASE_URL === "/" ? undefined : import.meta.env.BASE_URL.replace(/\/$/, "");

function RootRoute() {
  const location = useLocation();
  if (location.pathname === "/demo") {
    return <DemoEntryPage />;
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
