import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatGptAccount } from "./authentication";

type Model = { model: string; displayName: string; isDefault: boolean };
type Props = {
  desktop: boolean;
  onBusy: (busy: boolean) => void;
  model: string;
  onModelChange: (model: string) => void;
};
export default function ChatGptConnection({
  desktop,
  onBusy,
  model,
  onModelChange,
}: Props) {
  const [account, setAccount] = useState<ChatGptAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const active = useRef(true);
  const loginPending = useRef(false);
  const running = useRef(false);
  const busyCallback = useRef(onBusy);
  busyCallback.current = onBusy;
  async function run(command: string) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    busyCallback.current(true);
    try {
      if (command === "chatgpt_login") {
        loginPending.current = true;
        setLoggingIn(true);
      }
      const result = await invoke<ChatGptAccount>(command);
      if (!active.current) return;
      const next = command === "chatgpt_logout" ? { connected: false } : result;
      setAccount(next);
      setLoggingIn(false);
      loginPending.current = false;
      setModels([]);
      setModelsError("");
      if (next?.connected) {
        setModelsLoading(true);
        try {
          const available = await invoke<Model[]>("chatgpt_models");
          if (active.current) setModels(available);
        } catch (e) {
          // A catalog error must not undo a successful login.
          if (active.current) setModelsError(String(e));
        } finally {
          if (active.current) setModelsLoading(false);
        }
      }
    } catch (e) {
      if (active.current) setError(String(e));
    } finally {
      running.current = false;
      loginPending.current = false;
      if (active.current) {
        setBusy(false);
        setLoggingIn(false);
        busyCallback.current(false);
      }
    }
  }
  useEffect(() => {
    active.current = true;
    if (running.current) busyCallback.current(true);
    else if (desktop) void run("chatgpt_status");
    const refresh = () => {
      if (desktop && !running.current) void run("chatgpt_status");
    };
    window.addEventListener("focus", refresh);
    return () => {
      active.current = false;
      window.removeEventListener("focus", refresh);
      if (loginPending.current)
        void invoke("chatgpt_cancel_login").catch(() => {});
      busyCallback.current(false);
    };
  }, [desktop]);
  const unavailable = model && !models.some((m) => m.model === model);
  const defaultModel = models.find((m) => m.isDefault);
  return (
    <div className="chatgpt-connection">
      <p className="setting-note" aria-live="polite">
        {!desktop
          ? "ChatGPT login is available in the desktop app."
          : loggingIn
            ? "Complete the ChatGPT login in your browser."
            : account?.connected
              ? `Connected${account.email ? ` as ${account.email}` : ""}${account.plan ? ` · ${account.plan}` : ""}`
              : busy
                ? "Checking ChatGPT connection…"
                : "Connect your ChatGPT account to use Codex."}
      </p>
      <div className="chatgpt-actions">
        <button
          type="button"
          className="secondary"
          disabled={!desktop || busy}
          onClick={() =>
            void run(account?.connected ? "chatgpt_logout" : "chatgpt_login")
          }
        >
          {account?.connected ? "Disconnect ChatGPT" : "Connect ChatGPT"}
        </button>
        {loggingIn ? (
          <button
            type="button"
            className="text-button"
            onClick={() =>
              void invoke("chatgpt_cancel_login").catch((e) =>
                setError(String(e)),
              )
            }
          >
            Cancel login
          </button>
        ) : (
          <button
            type="button"
            className="text-button"
            disabled={!desktop || busy}
            onClick={() => void run("chatgpt_status")}
          >
            Refresh connection
          </button>
        )}
      </div>
      {error && (
        <p className="setting-note" role="status">
          {error}
        </p>
      )}
      <label>
        ChatGPT model
        <select
          value={model}
          disabled={!desktop || !account?.connected || busy || !models.length}
          aria-describedby="chatgpt-model-note"
          onChange={(e) => onModelChange(e.target.value)}
        >
          <option value="">
            {defaultModel
              ? `Codex default (${defaultModel.displayName})`
              : "Codex default"}
          </option>
          {unavailable && (
            <option value={model} disabled>
              {model} (not in the loaded catalog)
            </option>
          )}
          {models.map((m) => (
            <option key={m.model} value={m.model}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>
      <p id="chatgpt-model-note" className="setting-note" aria-live="polite">
        {modelsLoading
          ? "Loading available models…"
          : modelsError
            ? `Could not load models: ${modelsError} Use Refresh connection to retry.`
            : !account?.connected
              ? "Connect to load the models available to your account."
              : !models.length
                ? "No models are available. Use Refresh connection to retry."
                : unavailable
                  ? "The saved model is unavailable. Choose a listed model or Codex default."
                  : "Models available to your connected account."}
      </p>
      <p className="setting-note">
        Login opens your browser. Connecting or disconnecting takes effect
        immediately; Save applies the selected method and model.
      </p>
    </div>
  );
}
