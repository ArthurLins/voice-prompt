import { Minus, Pin, X } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export default function WindowControls({
  closeLabel,
  closeDisabled = false,
  onClose,
  onError,
  pinned,
  onPin,
  pinDisabled = false,
  hideMinimize = false,
}: {
  closeLabel: string;
  closeDisabled?: boolean;
  onClose?: () => void;
  onError?: (error: string) => void;
  pinned?: boolean;
  onPin?: () => void;
  pinDisabled?: boolean;
  hideMinimize?: boolean;
}) {
  const report = (e: unknown) => onError?.(String(e));
  return (
    <div className="window-controls">
      {onPin && (
        <button
          type="button"
          className={`icon-button pin-button ${pinned ? "active" : ""}`}
          title="Always on top"
          aria-label="Always on top"
          aria-pressed={pinned}
          disabled={pinDisabled}
          onClick={onPin}
        >
          <Pin size={15} />
        </button>
      )}
      {!hideMinimize && (
        <button
          type="button"
          className="icon-button"
          title="Minimize"
          aria-label="Minimize"
          onClick={() => {
            if (isTauri()) void getCurrentWindow().minimize().catch(report);
          }}
        >
          <Minus size={16} />
        </button>
      )}
      <button
        type="button"
        className="icon-button window-close"
        title={closeLabel}
        aria-label={closeLabel}
        disabled={closeDisabled}
        onClick={() => {
          if (onClose) onClose();
          else if (isTauri()) void getCurrentWindow().close().catch(report);
          else window.close();
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
