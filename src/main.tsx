import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";

import "./styles.css";

// One bundle, two windows: the label decides which UI to load.
const Overlay = lazy(() => import("./overlay/Overlay").then((m) => ({ default: m.Overlay })));
const SettingsApp = lazy(() => import("./settings/SettingsApp").then((m) => ({ default: m.SettingsApp })));

const isOverlay = getCurrentWindow().label === "overlay";
document.documentElement.classList.add(isOverlay ? "overlay" : "settings");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Suspense fallback={null}>{isOverlay ? <Overlay /> : <SettingsApp />}</Suspense>
  </React.StrictMode>,
);
