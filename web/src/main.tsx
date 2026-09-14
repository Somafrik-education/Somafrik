import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { ConfirmProvider, ToastProvider } from "./design-system";
import { PromptProvider } from "./components/ui/PromptDialog";
import { reportCardVerifyRouterBasename } from "./lib/reportCardVerifyRoute";
import "./index.css";

const appBasename =
  import.meta.env.BASE_URL === "/" ? undefined : import.meta.env.BASE_URL.replace(/\/$/, "");
const routerBasename = reportCardVerifyRouterBasename(
  typeof window !== "undefined" ? window.location.pathname : "",
  appBasename,
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter basename={routerBasename}>
      <ToastProvider>
        <ConfirmProvider>
          <PromptProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </PromptProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
