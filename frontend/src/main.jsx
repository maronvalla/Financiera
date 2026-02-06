import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles/theme.css";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";

const APP_VERSION = "2026-02-05-void-perms";
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    const shouldUpdate = window.confirm("Nueva versi\u00f3n disponible. \u00bfActualizar ahora?");
    if (shouldUpdate) {
      updateSW(true);
    }
  }
});
if (import.meta.env.DEV) {
  console.log(`APP_VERSION=${APP_VERSION}`);
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ErrorBoundary>
  </StrictMode>,
)


