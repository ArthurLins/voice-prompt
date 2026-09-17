import { useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { Download, Trash2 } from "lucide-react";

export type VoiceStatus = { ready: boolean; models: string[]; model: string };
type Progress = { downloaded: number; total: number; phase: string };
const models = [
  { id: "small", name: "Whisper small", detail: "Fast · 488 MB" },
  {
    id: "large-v3-turbo-q5_0",
    name: "Whisper large-v3-turbo",
    detail: "Accurate · 574 MB",
  },
];

export default function ModelManager({
  installed,
  onChanged,
  onBusy,
  setup = false,
}: {
  installed: string[];
  onChanged: (status: VoiceStatus) => void | Promise<void>;
  onBusy?: (busy: boolean) => void;
  setup?: boolean;
}) {
  const [active, setActive] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const running = useRef(false);
  async function operate(id: string, remove: boolean) {
    if (running.current) return;
    running.current = true;
    setActive(id);
    onBusy?.(true);
    setError("");
    setProgress({
      downloaded: 0,
      total: 1,
      phase: remove ? "deleting" : "connecting",
    });
    try {
      if (remove) await invoke("delete_model", { model: id });
      else {
        const channel = new Channel<Progress>();
        channel.onmessage = setProgress;
        await invoke("download_model", { model: id, channel });
      }
      setProgress({
        downloaded: 1,
        total: 1,
        phase: setup ? "preparing" : "checking",
      });
      await onChanged(await invoke<VoiceStatus>("voice_status"));
    } catch (e) {
      setError(String(e));
    } finally {
      running.current = false;
      setActive("");
      setProgress(null);
      onBusy?.(false);
    }
  }
  return (
    <div className="model-manager">
      {models.map((model) => (
        <div className="model-row" key={model.id}>
          <div>
            <strong>{model.name}</strong>
            <small>{model.detail}</small>
          </div>
          <button
            type="button"
            className="secondary"
            disabled={
              Boolean(active) ||
              (installed.includes(model.id) && installed.length <= 1)
            }
            title={
              installed.includes(model.id) && installed.length <= 1
                ? "Keep at least one installed model"
                : undefined
            }
            aria-label={`${installed.includes(model.id) ? "Delete" : "Download"} ${model.name}`}
            onClick={() => void operate(model.id, installed.includes(model.id))}
          >
            {installed.includes(model.id) ? (
              <Trash2 size={14} />
            ) : (
              <Download size={14} />
            )}
            {installed.includes(model.id) ? "Delete" : "Download"}
          </button>
        </div>
      ))}
      {progress && (
        <div className="model-progress" role="status" aria-live="polite">
          <span>
            {progress.phase === "downloading"
              ? `${Math.round((progress.downloaded / progress.total) * 100)}% · ${(progress.downloaded / 1e6).toFixed(0)} / ${(progress.total / 1e6).toFixed(0)} MB`
              : ({
                  connecting: "Connecting…",
                  verifying: "Verifying download…",
                  preparing: "Preparing speech…",
                  deleting: "Deleting model…",
                  checking: "Checking models…",
                }[progress.phase] ?? "Preparing…")}
          </span>
          <progress
            aria-label="Model download"
            max={progress.total}
            value={
              progress.phase === "downloading" || progress.phase === "verifying"
                ? progress.downloaded
                : undefined
            }
          />
        </div>
      )}
      {error && (
        <p className="setting-note" role="alert">
          {error}
        </p>
      )}
      {!setup && (
        <p className="setting-note">
          Model changes apply immediately. Keep at least one installed.
        </p>
      )}
    </div>
  );
}
