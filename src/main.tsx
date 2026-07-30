import React from "react";
import ReactDOM from "react-dom/client";

// Must come before the editor: `browser-fs-access` decides how it saves files
// the moment it loads, based on whether the file-picker API exists.
import "./tauri-fs";

import "@excalidraw/excalidraw/index.css";
import "./styles.css";
import App from "./App";

window.EXCALIDRAW_ASSET_PATH = "/";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
