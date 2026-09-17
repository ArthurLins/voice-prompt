import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Plus, Trash2 } from "lucide-react";
import WindowControls from "./WindowControls";

export type HistorySnapshot = {
  selected: string;
  alwaysOnTop?: boolean;
  locked: boolean;
  conversations: {
    id: string;
    title: string;
    updated: string;
    searchText: string;
  }[];
};
export type HistoryAction = { action: "select" | "delete" | "new"; id: string };
export default function HistoryWindow() {
  const [data, setData] = useState<HistorySnapshot>({
    selected: "",
    locked: true,
    conversations: [],
  });
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [failedAction, setFailedAction] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    void (async () => {
      if (isTauri()) {
        const stop = await getCurrentWindow().listen<HistorySnapshot>(
          "history-state",
          ({ payload }) => {
            if (!disposed) setData(payload);
          },
        );
        if (disposed) {
          stop();
          return;
        }
        off = stop;
      }
      const snapshot = isTauri()
        ? await invoke<HistorySnapshot>("get_history")
        : JSON.parse(
            localStorage.getItem("voice-prompt-history-preview") ?? "null",
          );
      if (!disposed) {
        if (snapshot) setData(snapshot);
        setLoaded(true);
      }
    })().catch((e) => {
      if (!disposed) setError(String(e));
    });
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  async function act(action: HistoryAction) {
    if (!loaded || data.locked) return;
    setError("");
    setFailedAction("");
    try {
      if (isTauri()) await emitTo("main", "history-action", action);
      else {
        window.opener?.postMessage(
          { type: "history-action", action },
          window.location.origin,
        );
        if (action.action === "delete")
          setData((d) => ({
            ...d,
            conversations: d.conversations.filter((c) => c.id !== action.id),
          }));
      }
      if (action.action !== "delete") {
        if (isTauri()) await getCurrentWindow().close();
        else window.close();
      }
    } catch (e) {
      setFailedAction(action.action + action.id);
      setError(String(e));
    }
  }
  const rows = data.conversations.filter((c) =>
    `${c.title} ${c.searchText}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="history-window">
      <header className="dialog-header">
        <h2
          id="history-title"
          className="window-drag"
          title="Drag window"
          onMouseDown={(e) => {
            if (isTauri() && e.button === 0 && e.detail === 1)
              void getCurrentWindow()
                .startDragging()
                .catch((e) => setError(String(e)));
          }}
        >
          History
        </h2>
        <WindowControls closeLabel="Close history" onError={setError} />
      </header>
      <input
        autoFocus
        className="history-search"
        aria-label="Search conversations"
        placeholder="Search"
        title={!failedAction ? error || undefined : undefined}
        aria-invalid={Boolean(error && !failedAction)}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <nav aria-label="Conversations" className="history-list">
        {rows.map((c) => (
          <div className="history-row" key={c.id}>
            <button
              className={c.id === data.selected ? "active" : ""}
              title={failedAction === "select" + c.id ? error : undefined}
              aria-invalid={failedAction === "select" + c.id}
              disabled={!loaded || data.locked}
              onClick={() => void act({ action: "select", id: c.id })}
            >
              <span>{c.title}</span>
              <time>
                {new Date(c.updated).toLocaleDateString("en-US", {
                  day: "2-digit",
                  month: "2-digit",
                })}
              </time>
            </button>
            <button
              className="icon-button danger"
              title={
                failedAction === "delete" + c.id ? error : `Delete ${c.title}`
              }
              aria-invalid={failedAction === "delete" + c.id}
              aria-label={`Delete ${c.title}`}
              disabled={!loaded || data.locked}
              onClick={() => void act({ action: "delete", id: c.id })}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {loaded && !rows.length && (
          <p className="setting-note">No conversations.</p>
        )}
      </nav>
      <footer className="dialog-footer">
        <button
          className="primary"
          title={failedAction === "new" ? error : undefined}
          aria-invalid={failedAction === "new"}
          disabled={!loaded || data.locked}
          onClick={() => void act({ action: "new", id: "" })}
        >
          <Plus size={15} /> New
        </button>
      </footer>
    </div>
  );
}
