import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Settings from "./Settings";
import { defaults, type Config } from "./config";
import { validateAuthenticationMethod } from "./authentication";
import { normalizePromptConfig, validatePromptConfig } from "./prompts";

export default function SettingsWindow() {
  const [draft, setDraft] = useState(defaults);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [key, setKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const [authBusy, setAuthBusy] = useState(false);
  const authBusyRef = useRef(false);
  const modelsBusyRef = useRef(false);
  const [modelsBusy, setModelsBusy] = useState(false);
  const ack = useRef<{
    id: string;
    resolve: () => void;
    reject: (e: Error) => void;
  } | null>(null);
  useEffect(() => {
    let disposed = false;
    const cleanups: (() => void)[] = [];
    const keep = (off: () => void) => (disposed ? off() : cleanups.push(off));
    void (async () => {
      if (isTauri()) {
        keep(
          await getCurrentWindow().listen<{ id: string; error: string }>(
            "settings-saved",
            ({ payload }) => {
              if (ack.current?.id !== payload.id) return;
              if (payload.error) ack.current.reject(new Error(payload.error));
              else ack.current.resolve();
            },
          ),
        );
        keep(
          await getCurrentWindow().onCloseRequested((e) => {
            if (savingRef.current || modelsBusyRef.current) e.preventDefault();
          }),
        );
      }
      const payload = isTauri()
        ? await invoke<{
            config: Config;
            devices: MediaDeviceInfo[];
            models: string[];
          }>("get_settings")
        : JSON.parse(
            localStorage.getItem("voice-prompt-settings-preview") ?? "null",
          );
      if (disposed) return;
      if (payload) {
        setDraft({
          ...defaults,
          ...payload.config,
          ...normalizePromptConfig(payload.config),
        });
        setDevices(payload.devices);
        setModels(payload.models);
      }
      setLoaded(true);
    })().catch((e) => {
      if (!disposed) setError(String(e));
    });
    return () => {
      disposed = true;
      cleanups.forEach((off) => off());
    };
  }, []);
  useEffect(() => {
    if (!isTauri() || draft.authenticationMethod === "chatgpt-oauth") return;
    let alive = true;
    setKeySaved(false);
    void invoke<boolean>("has_key", { baseUrl: draft.baseUrl })
      .then((value) => {
        if (alive) setKeySaved(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [draft.baseUrl, draft.authenticationMethod]);
  async function close() {
    if (savingRef.current || modelsBusyRef.current) return;
    setKey("");
    if (isTauri()) await getCurrentWindow().close();
    else window.close();
  }
  async function save() {
    if (
      savingRef.current ||
      modelsBusyRef.current ||
      authBusyRef.current ||
      !loaded
    )
      return;
    const validation =
      validateAuthenticationMethod(draft.authenticationMethod) ||
      validatePromptConfig(draft);
    if (validation) {
      setError(validation);
      return;
    }
    if (
      draft.authenticationMethod !== "chatgpt-oauth" &&
      (!draft.baseUrl.trim() || !draft.model.trim())
    ) {
      setError("Enter the API URL and model.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const config = {
        ...draft,
        baseUrl: draft.baseUrl.trim(),
        model: draft.model.trim(),
      };
      if (isTauri()) {
        if (config.authenticationMethod !== "chatgpt-oauth") {
          await invoke("has_key", { baseUrl: config.baseUrl });
          if (key.trim()) {
            await invoke("save_key", { baseUrl: config.baseUrl, key });
            setKey("");
          }
        }
        await new Promise<void>((resolve, reject) => {
          const id = crypto.randomUUID();
          const timer = setTimeout(
            () =>
              reject(
                new Error(
                  "The assistant did not confirm the save. Please try again.",
                ),
              ),
            15000,
          );
          ack.current = {
            id,
            resolve: () => {
              clearTimeout(timer);
              resolve();
            },
            reject: (e) => {
              clearTimeout(timer);
              reject(e);
            },
          };
          void emitTo("main", "settings-save", { id, config }).catch((e) =>
            ack.current?.reject(new Error(String(e))),
          );
        });
      } else {
        const w = JSON.parse(
          localStorage.getItem("voice-prompt-preview") ?? "null",
        );
        if (w)
          localStorage.setItem(
            "voice-prompt-preview",
            JSON.stringify({ ...w, config }),
          );
      }
      savingRef.current = false;
      await close();
    } catch (e) {
      setError(String(e));
    } finally {
      ack.current = null;
      savingRef.current = false;
      setSaving(false);
    }
  }
  return (
    <Settings
      draft={draft}
      setDraft={setDraft}
      devices={devices}
      installedModels={models}
      modelsBusy={modelsBusy}
      onModelsBusy={(busy) => {
        modelsBusyRef.current = busy;
        setModelsBusy(busy);
      }}
      onModelsChanged={(status) => {
        setModels(status.models);
        setDraft((d) =>
          status.models.includes(d.voiceModel)
            ? d
            : { ...d, voiceModel: status.models[0] ?? "small" },
        );
      }}
      authBusy={authBusy}
      onAuthBusy={(busy) => {
        authBusyRef.current = busy;
        setAuthBusy(busy);
      }}
      desktop={isTauri()}
      apiKey={key}
      setApiKey={setKey}
      keySaved={keySaved}
      saving={saving}
      loading={!loaded}
      error={error}
      save={() => void save()}
      close={() => void close().catch((e) => setError(String(e)))}
      removeKey={() => {
        void invoke("save_key", { baseUrl: draft.baseUrl, key: "" })
          .then(() => {
            setKeySaved(false);
            setKey("");
          })
          .catch((e) => setError(String(e)));
      }}
    />
  );
}
