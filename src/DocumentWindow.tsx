import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, Copy, FileText, X } from "lucide-react";
import WindowControls from "./WindowControls";
import { PromptMarkdown } from "./PromptMarkdown";

export default function DocumentWindow() {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void (async () => {
        const off = await getCurrentWindow().listen<string>(
          "prompt-document",
          (event) => {
            setText(event.payload);
            setCopied(false);
          },
        );
        if (disposed) {
          off();
          return;
        }
        unlisten = off;
        const initial = await invoke<string>("get_document");
        if (!disposed) setText(initial);
      })().catch((e) => {
        if (!disposed) setError(String(e));
      });
    } else setText(localStorage.getItem("voice-prompt-document-preview") ?? "");
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError("Could not copy. Select the text and press Ctrl+C.");
    }
  }
  return (
    <div className="document-window">
      <header className="document-bar">
        <div
          className="window-drag"
          onMouseDown={(e) => {
            if (isTauri() && e.button === 0 && e.detail === 1)
              void getCurrentWindow()
                .startDragging()
                .catch((e) => setError(String(e)));
          }}
        >
          <FileText size={15} />
          <span>Your prompt</span>
        </div>
        <button
          className="document-copy"
          disabled={!text}
          onClick={() => void copy()}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
          {copied ? "Copied" : "Copy Markdown"}
        </button>
        <WindowControls closeLabel="Close document" onError={setError} />
      </header>
      {error && (
        <p role="alert" className="document-error">
          {error}
        </p>
      )}
      <main className="document-scroll" tabIndex={0}>
        <article className="document-paper" key={text}>
          {text ? (
            <PromptMarkdown text={text} />
          ) : (
            <p className="empty-document">Your document appears here.</p>
          )}
          <div className="paper-end" aria-hidden="true">
            •
          </div>
        </article>
      </main>
    </div>
  );
}
