import { useState } from "react";
import { Minus, Pin, X, CircleAlert } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export default function WindowControls({
  closeLabel,
  closeDisabled = false,
  onClose,
  onError: _onError,
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
  const [failure, setFailure] = useState({ control: "", message: "" });
  const report = (control: string, e: unknown) => {
    setFailure({ control, message: String(e) });
  };
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
          title={failure.control === "minimize" ? failure.message : "Minimize"}
          aria-label="Minimize"
          onClick={() => {
            setFailure({ control: "", message: "" });
            if (isTauri())
              void getCurrentWindow()
                .minimize()
                .catch((e) => report("minimize", e));
          }}
        >
          {failure.control === "minimize" ? (
            <CircleAlert size={16} />
          ) : (
            <Minus size={16} />
          )}
        </button>
      )}
      <button
        type="button"
        className="icon-button window-close"
        title={failure.control === "close" ? failure.message : closeLabel}
        aria-label={closeLabel}
        disabled={closeDisabled}
        onClick={() => {
          setFailure({ control: "", message: "" });
          if (onClose) onClose();
          else if (isTauri())
            void getCurrentWindow()
              .close()
              .catch((e) => report("close", e));
          else window.close();
        }}
      >
        {failure.control === "close" ? (
          <CircleAlert size={16} />
        ) : (
          <X size={16} />
        )}
      </button>
    </div>
  );
}
