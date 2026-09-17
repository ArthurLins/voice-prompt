import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import DocumentWindow from "./DocumentWindow";
import SettingsWindow from "./SettingsWindow";
import QuestionsWindow from "./QuestionsWindow";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.location.hash === "#questions" ? (
      <QuestionsWindow />
    ) : window.location.hash === "#document" ? (
      <DocumentWindow />
    ) : window.location.hash === "#settings" ? (
      <SettingsWindow />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
