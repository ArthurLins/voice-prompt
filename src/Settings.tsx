import { useState, type Dispatch, type SetStateAction } from "react";
import { Plus, RotateCcw, Trash2, X } from "lucide-react";
import type { Config } from "./config";
import ChatGptConnection from "./ChatGptConnection";
import ModelManager, { type VoiceStatus } from "./ModelManager";
import SettingsScroll from "./SettingsScroll";
import WindowControls from "./WindowControls";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { defaultPromptConfig, type PromptProfile } from "./prompts";

type Props = {
  close: () => void;
  draft: Config;
  setDraft: Dispatch<SetStateAction<Config>>;
  devices: MediaDeviceInfo[];
  installedModels: string[];
  onModelsChanged?: (status: VoiceStatus) => void;
  onModelsBusy?: (busy: boolean) => void;
  modelsBusy?: boolean;
  desktop: boolean;
  apiKey: string;
  setApiKey: (value: string) => void;
  keySaved: boolean;
  saving: boolean;
  loading?: boolean;
  authBusy?: boolean;
  onAuthBusy: (busy: boolean) => void;
  error: string;
  save: () => void;
  removeKey: () => void;
};
export default function Settings(props: Props) {
  const { draft, setDraft } = props;
  const [tab, setTab] = useState("prompts");
  const [profileId, setProfileId] = useState("code");
  const profile =
    draft.promptProfiles.find((p) => p.id === profileId) ??
    draft.promptProfiles[0];
  const original = defaultPromptConfig().promptProfiles.find(
    (p) => p.id === profile.id,
  );
  const edit = (changes: Partial<PromptProfile>) =>
    setDraft((d) => ({
      ...d,
      promptProfiles: d.promptProfiles.map((p) =>
        p.id === profile.id ? { ...p, ...changes } : p,
      ),
    }));
  return (
    <div className="settings-window settings-dialog">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          props.save();
        }}
      >
        <header className="dialog-header">
          <h2
            id="settings-title"
            className="window-drag"
            onMouseDown={(e) => {
              if (isTauri() && e.button === 0 && e.detail === 1)
                void getCurrentWindow().startDragging();
            }}
          >
            Settings
          </h2>
          <WindowControls
            closeLabel="Close settings"
            onClose={props.close}
            closeDisabled={props.saving || props.modelsBusy}
          />
        </header>
        <div className="settings-tabs" role="tablist" aria-label="Settings">
          {Object.entries({
            prompts: "Prompts",
            audio: "Audio",
            api: "Connection",
          }).map(([id, label]) => (
            <button
              type="button"
              disabled={props.modelsBusy || props.authBusy}
              role="tab"
              id={`settings-tab-${id}`}
              aria-controls="settings-content"
              aria-selected={tab === id}
              className={tab === id ? "selected" : ""}
              key={id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <SettingsScroll labelledBy={`settings-tab-${tab}`}>
          {tab === "prompts" && (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={draft.alwaysOnTop}
                  onChange={(e) =>
                    setDraft({ ...draft, alwaysOnTop: e.target.checked })
                  }
                />
                Always on top
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={draft.askQuestions ?? false}
                  onChange={(e) =>
                    setDraft({ ...draft, askQuestions: e.target.checked })
                  }
                />
                Clarify uncertainties before generating
              </label>
              <label>
                Prompt type
                <select
                  value={draft.promptType}
                  onChange={(e) =>
                    setDraft({ ...draft, promptType: e.target.value })
                  }
                >
                  <option value="auto">Automatic</option>
                  {draft.promptProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="profile-picker">
                <label>
                  Edit type
                  <select
                    value={profile.id}
                    onChange={(e) => setProfileId(e.target.value)}
                  >
                    {draft.promptProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || "Untitled"}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="secondary"
                  disabled={draft.promptProfiles.length >= 16}
                  onClick={() => {
                    const id = crypto.randomUUID();
                    setDraft((d) => ({
                      ...d,
                      promptProfiles: [
                        ...d.promptProfiles,
                        {
                          id,
                          name: "New type",
                          description: "",
                          language: "source",
                          tone: "assertive",
                          instructions: "",
                        },
                      ],
                    }));
                    setProfileId(id);
                  }}
                >
                  <Plus size={14} /> Type
                </button>
              </div>
              <label>
                Name
                <input
                  maxLength={60}
                  value={profile.name}
                  onChange={(e) => edit({ name: e.target.value })}
                />
              </label>
              <label>
                Purpose
                <textarea
                  className="short-text"
                  maxLength={1000}
                  value={profile.description}
                  onChange={(e) => edit({ description: e.target.value })}
                />
              </label>
              <div className="field-row">
                <label>
                  Prompt language
                  <select
                    value={profile.language}
                    onChange={(e) =>
                      edit({
                        language: e.target.value as PromptProfile["language"],
                      })
                    }
                  >
                    <option value="en">English</option>
                    <option value="pt">Portuguese</option>
                    <option value="source">As requested</option>
                  </select>
                </label>
                <label>
                  Tone
                  <select
                    value={profile.tone}
                    onChange={(e) =>
                      edit({ tone: e.target.value as PromptProfile["tone"] })
                    }
                  >
                    <option value="assertive">Assertive</option>
                    <option value="neutral">Neutral</option>
                  </select>
                </label>
              </div>
              <label>
                Type instructions
                <textarea
                  className="rules-text"
                  maxLength={6000}
                  value={profile.instructions}
                  onChange={(e) => edit({ instructions: e.target.value })}
                />
              </label>
              <div className="profile-tools">
                {original ? (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => edit(original)}
                  >
                    <RotateCcw size={13} /> Restore this type
                  </button>
                ) : (
                  <button
                    type="button"
                    className="text-button danger"
                    disabled={draft.promptProfiles.length === 1}
                    onClick={() => {
                      setDraft((d) => ({
                        ...d,
                        promptType:
                          d.promptType === profile.id ? "auto" : d.promptType,
                        promptProfiles: d.promptProfiles.filter(
                          (p) => p.id !== profile.id,
                        ),
                      }));
                      setProfileId("code");
                    }}
                  >
                    <Trash2 size={13} /> Remove type
                  </button>
                )}
              </div>
              <details>
                <summary>General instructions</summary>
                <label className="sr-only" htmlFor="editor-instructions">
                  General instructions
                </label>
                <textarea
                  id="editor-instructions"
                  className="rules-text"
                  maxLength={12000}
                  value={draft.editorInstructions}
                  onChange={(e) =>
                    setDraft({ ...draft, editorInstructions: e.target.value })
                  }
                />
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      editorInstructions:
                        defaultPromptConfig().editorInstructions,
                    })
                  }
                >
                  <RotateCcw size={13} /> Restore general instructions
                </button>
              </details>
              <label>
                Detail level
                <select
                  value={draft.style}
                  onChange={(e) =>
                    setDraft({ ...draft, style: e.target.value })
                  }
                >
                  <option value="equilibrado">Balanced</option>
                  <option value="conciso">Concise</option>
                  <option value="detalhado">Detailed</option>
                </select>
              </label>
            </>
          )}
          {tab === "audio" && (
            <>
              <label>
                Microphone
                <select
                  value={draft.deviceId}
                  onChange={(e) =>
                    setDraft({ ...draft, deviceId: e.target.value })
                  }
                >
                  <option value="">System default</option>
                  {props.devices
                    .filter((d) => d.deviceId && d.deviceId !== "default")
                    .map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Microphone ${i + 1}`}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Speech language
                <select
                  value={draft.language}
                  onChange={(e) =>
                    setDraft({ ...draft, language: e.target.value })
                  }
                >
                  <option value="pt">Portuguese</option>
                  <option value="en">English</option>
                  <option value="es">Spanish</option>
                  <option value="auto">Detect</option>
                </select>
              </label>
              <label>
                Local model
                <select
                  value={draft.voiceModel}
                  onChange={(e) =>
                    setDraft({ ...draft, voiceModel: e.target.value })
                  }
                >
                  <option
                    value="small"
                    disabled={
                      props.desktop && !props.installedModels.includes("small")
                    }
                  >
                    Whisper small · Fast
                  </option>
                  <option
                    value="large-v3-turbo-q5_0"
                    disabled={
                      props.desktop &&
                      !props.installedModels.includes("large-v3-turbo-q5_0")
                    }
                  >
                    Whisper large-v3-turbo · Accurate
                  </option>
                </select>
              </label>
              {props.desktop && (
                <ModelManager
                  installed={props.installedModels}
                  onChanged={(status) => props.onModelsChanged?.(status)}
                  onBusy={props.onModelsBusy}
                />
              )}
            </>
          )}
          {tab === "api" && (
            <>
              <label>
                Authentication method
                <select
                  value={draft.authenticationMethod ?? "openai-protocol"}
                  aria-describedby="authentication-note"
                  disabled={props.saving || props.loading || props.authBusy}
                  onChange={(e) => {
                    if (
                      e.target.value === "openai-protocol" ||
                      e.target.value === "chatgpt-oauth"
                    )
                      setDraft({
                        ...draft,
                        authenticationMethod: e.target.value,
                      });
                  }}
                >
                  <option value="openai-protocol">
                    OpenAI Protocol (API key)
                  </option>
                  <option value="chatgpt-oauth">ChatGPT login (OAuth)</option>
                </select>
              </label>
              <p id="authentication-note" className="setting-note">
                Choose an API key or sign in with your ChatGPT account.
              </p>
              {draft.authenticationMethod === "chatgpt-oauth" ? (
                <>
                  <ChatGptConnection
                    desktop={props.desktop}
                    onBusy={props.onAuthBusy}
                    model={draft.chatgptModel ?? ""}
                    onModelChange={(chatgptModel) =>
                      setDraft((d) => ({ ...d, chatgptModel }))
                    }
                  />
                </>
              ) : (
                <>
                  <label>
                    API URL
                    <input
                      type="url"
                      value={draft.baseUrl}
                      onChange={(e) => {
                        setDraft({ ...draft, baseUrl: e.target.value });
                        props.setApiKey("");
                      }}
                    />
                  </label>
                  <label>
                    Model
                    <input
                      value={draft.model}
                      onChange={(e) =>
                        setDraft({ ...draft, model: e.target.value })
                      }
                    />
                  </label>
                </>
              )}
              <label>
                Thinking effort
                <select
                  value={draft.thinkingEffort ?? "default"}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      thinkingEffort: e.target
                        .value as Config["thinkingEffort"],
                    })
                  }
                >
                  <option value="default">Model default</option>
                  <option value="none">None</option>
                  <option value="minimal">Minimal</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="xhigh">Extra high</option>
                  <option value="max">Maximum</option>
                </select>
              </label>
              <p className="setting-note">
                Supported effort levels depend on the model and provider.
              </p>
              {draft.authenticationMethod !== "chatgpt-oauth" && (
                <>
                  <label>
                    API key
                    <input
                      type="password"
                      autoComplete="off"
                      value={props.apiKey}
                      onChange={(e) => props.setApiKey(e.target.value)}
                      placeholder={
                        props.keySaved
                          ? "Saved securely on this device; leave blank to keep"
                          : "API key for the configured provider"
                      }
                    />
                  </label>
                  {props.keySaved && (
                    <button
                      type="button"
                      className="text-button danger"
                      onClick={props.removeKey}
                    >
                      Remove saved key
                    </button>
                  )}
                  <p className="setting-note">
                    Only text is sent to the provider. The key stays in your
                    system's secure credential store.
                  </p>
                </>
              )}
            </>
          )}
        </SettingsScroll>
        <footer className="dialog-footer">
          <button
            type="button"
            className="secondary"
            disabled={props.modelsBusy}
            onClick={props.close}
          >
            Cancel
          </button>
          <button
            className="primary"
            title={props.error || undefined}
            aria-invalid={Boolean(props.error)}
            disabled={
              props.saving ||
              props.loading ||
              props.modelsBusy ||
              props.authBusy
            }
          >
            {props.saving ? "Saving…" : props.error ? "Retry save" : "Save"}
          </button>
        </footer>
      </form>
    </div>
  );
}
