import { useEffect, useState, type ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import ModelManager, { type VoiceStatus } from "./ModelManager";
import WindowControls from "./WindowControls";

export default function ModelSetup({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [ready, setReady] = useState(!isTauri());
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  async function prepare(next: VoiceStatus) {
    setStatus(next);
    if (!next.models.length) return;
    if (!next.ready)
      throw new Error("Speech runtime is missing. Reinstall the application.");
    const stored = await invoke<{ config?: { voiceModel?: string } } | null>(
      "load_workspace",
    );
    const preferred = stored?.config?.voiceModel;
    await invoke("warm_voice", {
      model:
        preferred && next.models.includes(preferred)
          ? preferred
          : next.models[0],
    });
    setReady(true);
  }
  async function check() {
    setChecking(true);
    setError("");
    try {
      await prepare(await invoke<VoiceStatus>("voice_status"));
    } catch (e) {
      setError(String(e));
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    if (!isTauri()) return;
    void getCurrentWindow()
      .setSize(new LogicalSize(420, 360))
      .catch((e) => setError(String(e)));
    void check();
  }, []);
  if (ready) return children;
  return (
    <main className="tool-shell model-setup">
      <header className="toolbar">
        <h2
          className="window-drag"
          onMouseDown={(e) => {
            if (e.button === 0) void getCurrentWindow().startDragging();
          }}
        >
          Voice Prompt
        </h2>
        <WindowControls closeLabel="Close" />
      </header>
      <div className="model-setup-content">
        <h2>{checking ? "Preparing speech…" : "Choose a speech model"}</h2>
        <p className="setting-note">
          Download once to transcribe on your device. Both models support
          multiple languages.
        </p>
        {checking ? (
          <p role="status">Checking installed models…</p>
        ) : (
          <ModelManager
            setup
            installed={status?.models ?? []}
            onChanged={prepare}
            onBusy={setBusy}
          />
        )}
        {error && (
          <p className="setting-note" role="alert">
            {error}
          </p>
        )}
        {!checking && (error || Boolean(status?.models.length)) && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void check()}
          >
            Try again
          </button>
        )}
      </div>
    </main>
  );
}
