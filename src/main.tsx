import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { installRemoteAccess } from "./lib/remote-access";

installRemoteAccess();

if ("serviceWorker" in navigator && window.location.protocol === "http:") {
  void navigator.serviceWorker.register("/sw.js").catch(() => {
    // The app remains fully usable when a browser blocks service workers.
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
