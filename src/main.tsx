import React from "react";
import { createRoot } from "react-dom/client";
import HistoryWindow from "./HistoryWindow";
import App from "./App";
import ModelSetup from "./ModelSetup";
import DocumentWindow from "./DocumentWindow";
import SettingsWindow from "./SettingsWindow";
import QuestionsWindow from "./QuestionsWindow";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.location.hash === "#history" ? (
      <HistoryWindow />
    ) : window.location.hash === "#questions" ? (
      <QuestionsWindow />
    ) : window.location.hash === "#document" ? (
      <DocumentWindow />
    ) : window.location.hash === "#settings" ? (
      <SettingsWindow />
    ) : (
      <ModelSetup>
        <App />
      </ModelSetup>
    )}
  </React.StrictMode>,
);
