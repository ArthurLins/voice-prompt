import { useEffect, useRef, useState } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  FileText,
  Copy,
  PencilLine,
  History,
  LoaderCircle,
  Mic,
  Settings2,
  Square,
  X,
} from "lucide-react";
import { defaults, type Config } from "./config";
export type { Config } from "./config";
import {
  type QuestionResult,
  type PendingQuestions,
  type AnsweredTurn,
} from "./Clarification";
import type { QuestionsSnapshot, QuestionAction } from "./QuestionsWindow";
import type { HistoryAction, HistorySnapshot } from "./HistoryWindow";
import WindowControls from "./WindowControls";
import { emitTo } from "@tauri-apps/api/event";
import { completedContext } from "./conversation";
import { normalizePromptConfig, validatePromptConfig } from "./prompts";
import { MAX_RECORDING_SECONDS, VoiceRecorder } from "./audio";

type Version = { id: string; source: string; output: string; date: string };
type Conversation = {
  id: string;
  title: string;
  source: string;
  output: string;
  versions: Version[];
  updated: string;
  complete: boolean;
  pending?: PendingQuestions;
  recovery?: { id: string; source: string; previous: string };
};
type Workspace = {
  conversations: Conversation[];
  selected: string;
  config: Config;
};
type Progress = { type: "phase" | "transcript" | "delta"; value: string };
const newConversation = (): Conversation => ({
  id: crypto.randomUUID(),
  title: "New conversation",
  source: "",
  output: "",
  versions: [],
  updated: new Date().toISOString(),
  complete: false,
});
const initial = newConversation();
const desktop = isTauri();
let saveQueue = Promise.resolve();
function readable(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>({
    conversations: [initial],
    selected: initial.id,
    config: defaults,
  });
  const [loaded, setLoaded] = useState(false),
    [storageFailed, setStorageFailed] = useState(false);
  const latestWorkspace = useRef(workspace);
  latestWorkspace.current = workspace;
  const [phase, setPhase] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [recording, setRecording] = useState(false),
    [starting, setStarting] = useState(false);
  const [seconds, setSeconds] = useState(0),
    [level, setLevel] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [voice, setVoice] = useState({
    ready: false,
    model: "",
    loaded: false,
    models: [] as string[],
  });
  const [windowReady, setWindowReady] = useState(false);
  const [retry, setRetry] = useState(false);
  const completedAudio = useRef(new Set<string>());
  const unsavedAudio = useRef(new Map<string, string>());
  const [captureMode, setCaptureMode] = useState<"new" | "refine">("new");
  const captureTarget = useRef<Conversation | null>(null);
  const captureStarting = useRef(false);
  const historyAction = useRef<(action: HistoryAction) => void>(() => {});
  const recorder = useRef<VoiceRecorder | null>(null),
    activeRequest = useRef("");
  const recordingStart = useRef(0),
    stopRef = useRef<() => void>(() => {}),
    busyRef = useRef(false);
  const conversation =
    workspace.conversations.find((c) => c.id === workspace.selected) ??
    workspace.conversations[0];
  const questionAction = useRef<(action: QuestionAction) => void>(() => {});
  const lastQuestionRound = useRef("");
  const locked =
    busy || recording || starting || !loaded || Boolean(conversation.pending);
  const config = workspace.config;
  useEffect(() => {
    if (!desktop || !loaded) return;
    void getCurrentWindow()
      .setAlwaysOnTop(true)
      .catch((e) =>
        setError(`Could not keep the window on top: ${readable(e)}`),
      );
  }, [loaded, config.alwaysOnTop]);
  const update = (
    id: string,
    change:
      Partial<Conversation> | ((c: Conversation) => Partial<Conversation>),
  ) =>
    setWorkspace((w) => ({
      ...w,
      conversations: w.conversations.map((c) =>
        c.id === id
          ? {
              ...c,
              ...(typeof change === "function" ? change(c) : change),
              updated: new Date().toISOString(),
            }
          : c,
      ),
    }));

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const stored = desktop
          ? await invoke<Workspace | null>("load_workspace")
          : JSON.parse(localStorage.getItem("voice-prompt-preview") ?? "null");
        if (!alive) return;
        if (stored) {
          if (
            !Array.isArray(stored.conversations) ||
            !stored.conversations.every(
              (c: Conversation) =>
                typeof c.id === "string" &&
                typeof c.source === "string" &&
                typeof c.output === "string" &&
                Array.isArray(c.versions),
            )
          )
            throw new Error(
              "Incompatible history. The original file was preserved.",
            );
          const fresh = newConversation();
          setWorkspace({
            ...stored,
            selected: fresh.id,
            conversations: [
              fresh,
              ...stored.conversations
                .filter(
                  (c: Conversation) =>
                    c.source ||
                    c.output ||
                    c.versions.length ||
                    c.pending ||
                    c.recovery,
                )
                .map((c: Conversation) => ({
                  ...c,
                  title:
                    c.title === "Nova conversa" ? "New conversation" : c.title,
                  pending: c.pending
                    ? {
                        ...c.pending,
                        settings: {
                          ...c.pending.settings,
                          ...normalizePromptConfig(c.pending.settings),
                          alwaysOnTop: true,
                        },
                      }
                    : undefined,
                })),
            ],
            config: {
              ...defaults,
              ...stored.config,
              ...normalizePromptConfig(stored.config),
              autoOptimize: true,
              alwaysOnTop: true,
            },
          });
        }
      } catch (e) {
        setError(readable(e));
        setStorageFailed(true);
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    if (desktop)
      invoke<{ ready: boolean; model: string; models: string[] }>(
        "voice_status",
      )
        .then((status) => {
          if (!alive) return;
          setVoice({ ...status, loaded: false });
        })
        .catch((e) => {
          if (alive) setError(readable(e));
        });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!desktop || !loaded || !voice.ready) return;
    let alive = true;
    setVoice((v) => ({ ...v, loaded: false }));
    invoke("warm_voice", { model: config.voiceModel })
      .then(() => {
        if (alive) setVoice((v) => ({ ...v, loaded: true }));
      })
      .catch((e) => {
        if (alive) setError(readable(e));
      });
    return () => {
      alive = false;
    };
  }, [loaded, voice.ready, config.voiceModel]);
  useEffect(() => {
    if (!loaded || storageFailed) return;
    const timer = setTimeout(
      () => {
        if (desktop)
          saveQueue = saveQueue
            .then(async () => {
              await invoke<void>("save_workspace", { data: workspace });
              for (const id of completedAudio.current) {
                if (workspace.conversations.some((c) => c.recovery?.id === id))
                  continue;
                await invoke("delete_recording", { id });
                completedAudio.current.delete(id);
              }
            })
            .catch((e) => {
              setError(`Could not save: ${readable(e)}`);
            });
        else {
          try {
            localStorage.setItem(
              "voice-prompt-preview",
              JSON.stringify(workspace),
            );
          } catch {
            setError("Browser storage is unavailable.");
          }
        }
      },
      busy ? 600 : 100,
    );
    return () => clearTimeout(timer);
  }, [workspace, loaded, storageFailed, busy]);
  useEffect(() => {
    if (!loaded) return;
    if (!desktop) {
      const flush = () => {
        if (!storageFailed) {
          try {
            localStorage.setItem(
              "voice-prompt-preview",
              JSON.stringify(latestWorkspace.current),
            );
          } catch {
            /* Existing save errors are surfaced by the regular save path. */
          }
        }
      };
      window.addEventListener("pagehide", flush);
      return () => window.removeEventListener("pagehide", flush);
    }
    let disposed = false;
    let closing = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing) return;
        closing = true;
        try {
          recorder.current?.dispose();
          recorder.current = null;
          const requestId = activeRequest.current;
          activeRequest.current = "";
          if (requestId) await invoke("cancel_request", { id: requestId });
          await saveQueue;
          if (!storageFailed)
            await invoke("save_workspace", { data: latestWorkspace.current });
          await getCurrentWindow().destroy();
        } catch (e) {
          closing = false;
          setRecording(false);
          setError(`Could not save and close: ${readable(e)}`);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else {
          unlisten = fn;
          setWindowReady(true);
        }
      })
      .catch((e) => setError(readable(e)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [loaded, storageFailed]);
  useEffect(() => {
    const refresh = () =>
      navigator.mediaDevices
        ?.enumerateDevices()
        .then((list) => setDevices(list.filter((d) => d.kind === "audioinput")))
        .catch(() => {});
    void refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", refresh);
      recorder.current?.dispose();
    };
  }, []);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStart.current) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_RECORDING_SECONDS) stopRef.current();
    }, 200);
    return () => clearInterval(timer);
  }, [recording]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 4000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let off: (() => void) | undefined;
    void getCurrentWindow()
      .listen<{ id: string; config: Config }>(
        "settings-save",
        async ({ payload }) => {
          let failure = "";
          try {
            const validation = validatePromptConfig(payload.config);
            if (validation) throw new Error(validation);
            if (storageFailed)
              throw new Error(
                "History could not be loaded; settings were not changed.",
              );
            const next = {
              ...latestWorkspace.current,
              config: {
                ...payload.config,
                alwaysOnTop: true,
              },
            };
            latestWorkspace.current = next;
            setWorkspace(next);
            await saveQueue;
            await invoke("save_workspace", { data: latestWorkspace.current });
          } catch (e) {
            failure = readable(e);
            setError(failure);
          }
          await emitTo("settings", "settings-saved", {
            id: payload.id,
            error: failure,
          });
        },
      )
      .then((fn) => {
        if (disposed) fn();
        else off = fn;
      })
      .catch((e) => setError(readable(e)));
    return () => {
      disposed = true;
      off?.();
    };
  }, [storageFailed]);

  function questionsSnapshot(): QuestionsSnapshot | null {
    const pending = conversation.pending;
    if (!pending) return null;
    return {
      conversationId: conversation.id,
      roundId: JSON.stringify(pending.assistant),
      pending: { questions: pending.questions, answers: pending.answers },
      busy,
      error,
    };
  }
  async function syncQuestions(show: boolean) {
    if (!desktop) return;
    try {
      await invoke("sync_questions", { data: questionsSnapshot(), show });
    } catch (e) {
      setError(readable(e));
    }
  }
  questionAction.current = (event) => {
    const pending = conversation.pending;
    if (
      !pending ||
      event.conversationId !== conversation.id ||
      event.roundId !== JSON.stringify(pending.assistant)
    )
      return;
    if (event.action === "stop") {
      void cancel();
      return;
    }
    if (busyRef.current) return;
    if (event.action === "discard") {
      if (conversation.recovery)
        completedAudio.current.add(conversation.recovery.id);
      update(conversation.id, { pending: undefined, recovery: undefined });
      setError("");
      setRetry(false);
      return;
    }
    if (
      event.answers.length !== pending.questions.length ||
      event.answers.some((a) => typeof a !== "string" || a.length > 2000)
    )
      return;
    const nextPending = { ...pending, answers: event.answers };
    update(conversation.id, { pending: nextPending });
    if (event.action === "submit")
      void run(null, { ...conversation, pending: nextPending }, [
        ...pending.turns,
        { assistant: pending.assistant, answers: event.answers },
      ]);
  };
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let off: (() => void) | undefined;
    void getCurrentWindow()
      .listen<QuestionAction>("question-action", ({ payload }) =>
        questionAction.current(payload),
      )
      .then((fn) => {
        if (disposed) fn();
        else off = fn;
      })
      .catch((e) => setError(readable(e)));
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const round = conversation.pending
      ? conversation.id + JSON.stringify(conversation.pending.assistant)
      : "";
    const show = Boolean(round && round !== lastQuestionRound.current);
    lastQuestionRound.current = round;
    void syncQuestions(show);
  }, [loaded, conversation.pending, conversation.id, busy, error]);

  async function openSettings() {
    try {
      if (desktop)
        await invoke("open_settings", {
          config,
          devices: devices.map((d) => ({
            deviceId: d.deviceId,
            label: d.label,
          })),
          models: voice.models,
        });
      else {
        localStorage.setItem(
          "voice-prompt-settings-preview",
          JSON.stringify({ config, devices: [], models: ["small"] }),
        );
        window.open(
          "/#settings",
          "voice-prompt-settings",
          "width=480,height=680",
        );
      }
    } catch (e) {
      setError(readable(e));
    }
  }

  async function run(
    audio: string | null = null,
    targetConversation: Conversation = conversation,
    answers?: AnsweredTurn[],
  ) {
    if (busyRef.current) return;
    if (!desktop) {
      setError(
        "Open the desktop app to use local transcription and the API. This page is an interface preview.",
      );
      return;
    }
    const recovery = audio
      ? {
          id: crypto.randomUUID(),
          source: "",
          previous: completedContext(targetConversation),
        }
      : targetConversation.recovery;
    if (!audio && !recovery && !targetConversation.source.trim()) return;
    if (audio && recovery) unsavedAudio.current.set(recovery.id, audio);
    busyRef.current = true;
    setBusy(true);
    setError("");
    setRetry(false);
    const pending = targetConversation.pending;
    const requestSettings = pending?.settings ?? config;
    const id = crypto.randomUUID(),
      target = targetConversation.id,
      previous =
        pending?.previous ??
        recovery?.previous ??
        completedContext(targetConversation);
    activeRequest.current = id;
    let source =
      pending?.source ??
      recovery?.source ??
      (audio ? "" : targetConversation.source);
    setPhase(audio ? "Preparing audio…" : "Connecting to the model…");

    const channel = new Channel<Progress>();
    channel.onmessage = (event) => {
      if (activeRequest.current !== id) return;
      if (event.type === "phase") setPhase(event.value);
      if (event.type === "transcript") {
        source = event.value;
        update(target, (c) => ({
          source,
          recovery: recovery ? { ...recovery, source } : undefined,
          title: c.title === "New conversation" ? source.slice(0, 42) : c.title,
        }));
      }
    };
    try {
      if (recovery) {
        update(target, { recovery });
        const bytes = unsavedAudio.current.get(recovery.id);
        if (bytes) {
          await invoke("save_recording", { id: recovery.id, audio: bytes });
          unsavedAudio.current.delete(recovery.id);
        }
        // Persist the recovery pointer before starting expensive work.
        const snapshot = {
          ...latestWorkspace.current,
          conversations: latestWorkspace.current.conversations.map((c) =>
            c.id === target ? { ...c, recovery } : c,
          ),
        };
        const checkpointSave = saveQueue.then(() =>
          invoke("save_workspace", { data: snapshot }),
        );
        saveQueue = checkpointSave.then(
          () => {},
          () => {},
        );
        await checkpointSave;
      }
      // Context is implicit. Only completed results become the next context.
      const result = await invoke<string | QuestionResult>("run_request", {
        id,
        audio: null,
        audioId: recovery && !source ? recovery.id : null,
        text: source,
        previous,
        settings: requestSettings,
        clarificationTurns: answers ?? null,
        channel,
        transcribeOnly: false,
      });
      if (typeof result !== "string") {
        update(target, {
          pending: {
            ...result,
            turns: answers ?? [],
            answers: result.questions.map(() => ""),
            settings: requestSettings,
            previous,
            source,
          },
        });
        return;
      }
      if (recovery) completedAudio.current.add(recovery.id);
      update(target, (c) => ({
        pending: undefined,
        recovery: undefined,
        output: result,
        complete: true,
        versions: [
          ...c.versions,
          { id, source, output: result, date: new Date().toISOString() },
        ],
      }));
    } catch (e) {
      setError(readable(e));
      setRetry(!pending && Boolean(recovery || source.trim()));
    } finally {
      activeRequest.current = "";
      busyRef.current = false;
      setBusy(false);
      setPhase("");
    }
  }
  async function toggleRecording(mode: "new" | "refine" = "new") {
    if (recording) {
      await stopRecording();
      return;
    }
    if (locked || captureStarting.current) return;
    if (
      mode === "refine" &&
      (!completedContext(conversation) || conversation.recovery)
    )
      return;
    if (!desktop || !voice.ready) {
      setError(
        desktop
          ? "Local speech is not installed. Run npm run setup:voice and reopen the app."
          : "Use the desktop app to record and transcribe locally.",
      );
      return;
    }
    captureStarting.current = true;
    captureTarget.current = mode === "new" ? newConversation() : conversation;
    setCaptureMode(mode);
    setStarting(true);
    setError("");
    setNotice("");
    setRetry(false);
    setSeconds(0);
    const instance = new VoiceRecorder();
    recorder.current = instance;
    try {
      await instance.start(config.deviceId, setLevel, () => {
        setNotice("Microphone disconnected. Saving the captured audio…");
        stopRef.current();
      });
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "audioinput"));
      recordingStart.current = Date.now();
      setRecording(true);
    } catch (e) {
      instance.dispose();
      recorder.current = null;
      captureTarget.current = null;
      setError(`Could not use the microphone: ${readable(e)}`);
    } finally {
      captureStarting.current = false;
      setStarting(false);
    }
  }
  async function stopRecording() {
    const instance = recorder.current;
    if (!instance) return;
    recorder.current = null;
    setRecording(false);
    setStarting(true);
    setLevel(0);
    try {
      const audio = await instance.stop();
      const target = captureTarget.current ?? conversation;
      captureTarget.current = null;
      if (captureMode === "new")
        setWorkspace((w) => ({
          ...w,
          selected: target.id,
          conversations: [target, ...w.conversations],
        }));
      setStarting(false);
      await run(audio, target);
    } catch (e) {
      setError(readable(e));
      setStarting(false);
    }
  }
  stopRef.current = () => {
    void stopRecording();
  };
  async function cancel() {
    if (recording) {
      recorder.current?.dispose();
      recorder.current = null;
      captureTarget.current = null;
      setRecording(false);
      setLevel(0);
      return;
    }
    if (activeRequest.current) {
      setPhase("Cancelling…");
      try {
        await invoke("cancel_request", { id: activeRequest.current });
      } catch (e) {
        setError(readable(e));
      }
    }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === "Space") {
        e.preventDefault();
        void toggleRecording();
      }
      if (
        e.ctrlKey &&
        e.key === "Enter" &&
        !locked &&
        (retry || conversation.recovery)
      ) {
        e.preventDefault();
        void run();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  function addConversation() {
    const c = newConversation();
    setWorkspace((w) => ({
      ...w,
      selected: c.id,
      conversations: [c, ...w.conversations],
    }));
    setError("");
    setRetry(false);
  }
  async function openDocument() {
    try {
      if (desktop)
        await invoke("open_document", {
          text: completedContext(conversation),
          alwaysOnTop: config.alwaysOnTop,
        });
      else {
        localStorage.setItem(
          "voice-prompt-document-preview",
          conversation.output,
        );
        window.open(
          "/#document",
          "voice-prompt-document",
          "width=680,height=720",
        );
      }
    } catch (e) {
      setError(readable(e));
    }
  }
  function historySnapshot(): HistorySnapshot {
    return {
      selected: conversation.id,
      locked: busy || recording || starting || !loaded,
      conversations: workspace.conversations
        .filter(
          (c) =>
            c.source ||
            c.output ||
            c.versions.length ||
            c.pending ||
            c.recovery,
        )
        .map((c) => ({
          id: c.id,
          title: c.title,
          updated: c.updated,
          searchText: c.source,
        })),
    };
  }
  async function openHistory() {
    try {
      if (desktop)
        await invoke("sync_history", { data: historySnapshot(), show: true });
      else {
        localStorage.setItem(
          "voice-prompt-history-preview",
          JSON.stringify(historySnapshot()),
        );
        window.open(
          "/#history",
          "voice-prompt-history",
          "width=380,height=480",
        );
      }
    } catch (e) {
      setError(readable(e));
    }
  }
  historyAction.current = (action) => {
    if (busyRef.current || recording || starting || !loaded) return;
    if (action.action === "new") addConversation();
    else if (action.action === "select") {
      if (!workspace.conversations.some((c) => c.id === action.id)) return;
      setWorkspace((w) => ({ ...w, selected: action.id }));
      setError("");
      setRetry(false);
    } else if (action.action === "delete") {
      const item = workspace.conversations.find((c) => c.id === action.id);
      if (!item) return;
      if (item.recovery) completedAudio.current.add(item.recovery.id);
      setWorkspace((w) => {
        const remaining = w.conversations.filter((c) => c.id !== action.id);
        const next = remaining.length ? remaining : [newConversation()];
        return {
          ...w,
          conversations: next,
          selected: w.selected === action.id ? next[0].id : w.selected,
        };
      });
      setError("");
      setRetry(false);
    }
  };
  useEffect(() => {
    if (!desktop || !loaded) return;
    void invoke("sync_history", { data: historySnapshot(), show: false }).catch(
      (e) => setError(readable(e)),
    );
  }, [workspace, loaded, busy, recording, starting]);
  useEffect(() => {
    if (!desktop) {
      const onMessage = (event: MessageEvent) => {
        if (
          event.origin === window.location.origin &&
          event.data?.type === "history-action"
        )
          historyAction.current(event.data.action);
      };
      window.addEventListener("message", onMessage);
      return () => window.removeEventListener("message", onMessage);
    }
    let disposed = false;
    let off: (() => void) | undefined;
    void getCurrentWindow()
      .listen<HistoryAction>("history-action", ({ payload }) =>
        historyAction.current(payload),
      )
      .then((fn) => {
        if (disposed) fn();
        else off = fn;
      })
      .catch((e) => setError(readable(e)));
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  return (
    <div className="tool-shell">
      <header className="toolbar">
        <strong
          className="window-drag"
          onMouseDown={(e) => {
            if (desktop && e.button === 0 && e.detail === 1)
              void getCurrentWindow()
                .startDragging()
                .catch((err) => setError(readable(err)));
          }}
          aria-label="Voice Prompt"
          title="Voice Prompt"
        >
          <img
            src="/app-icon.svg"
            width="22"
            height="22"
            alt=""
            draggable={false}
          />
        </strong>
        <div className="toolbar-actions">
          <button
            className="icon-button"
            title="History"
            aria-label="History"
            disabled={locked}
            onClick={() => void openHistory()}
          >
            <History size={17} />
          </button>
          <button
            className="icon-button"
            title="Settings"
            aria-label="Settings"
            disabled={locked}
            onClick={() => void openSettings()}
          >
            <Settings2 size={17} />
          </button>
          <WindowControls
            hideMinimize
            closeLabel="Close app"
            closeDisabled={desktop && !windowReady}
            onError={setError}
          />
        </div>
      </header>
      {(error || notice) && (
        <div
          className={`message ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
        >
          <span>{error || notice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            title="Dismiss message"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {conversation.pending ? (
        <main className="compact-stage" aria-busy={busy}>
          <section className="voice-stage">
            {busy && <LoaderCircle size={27} className="spin" />}
            <h1>{busy ? "Processing your answers" : "A few questions"}</h1>
            <button
              className="primary"
              onClick={() => void syncQuestions(true)}
            >
              Open questions
            </button>
          </section>
        </main>
      ) : (
        <main className="compact-stage" aria-busy={busy || starting}>
          <section className="voice-stage">
            <div
              className={`voice-orbit ${recording ? "is-recording" : ""} ${busy || starting ? "is-working" : ""}`}
              style={{ "--voice-level": level } as React.CSSProperties}
            >
              <button
                className="voice-button"
                aria-label={
                  recording ? "Finish recording" : "Record new prompt"
                }
                title={
                  recording
                    ? "Finish recording (Ctrl+Shift+Space)"
                    : "Record a new prompt (Ctrl+Shift+Space)"
                }
                disabled={busy || starting || !loaded}
                onClick={() => void toggleRecording()}
              >
                {busy || starting || !loaded ? (
                  <LoaderCircle size={27} className="spin" />
                ) : recording ? (
                  <Square size={24} fill="currentColor" />
                ) : (
                  <Mic size={30} strokeWidth={1.5} />
                )}
              </button>
              {completedContext(conversation) &&
                !recording &&
                !busy &&
                !starting && (
                  <button
                    className="refine-button"
                    aria-label="Refine current prompt"
                    title={`Refine: ${conversation.title}`}
                    onClick={() => void toggleRecording("refine")}
                    disabled={!loaded || Boolean(conversation.recovery)}
                  >
                    <PencilLine size={19} />
                  </button>
                )}
            </div>
            <div className="voice-caption" role="status" aria-live="polite">
              <h1>
                {recording
                  ? captureMode === "refine"
                    ? "Recording refinement…"
                    : "Recording new prompt…"
                  : busy
                    ? "Preparing your prompt"
                    : starting
                      ? "One moment…"
                      : "New prompt"}
              </h1>
              {busy && phase && <p>{phase}</p>}
              {recording && (
                <p>
                  {Math.floor(seconds / 60)}:
                  {String(seconds % 60).padStart(2, "0")} · Click to finish
                </p>
              )}
            </div>
            {(busy || recording) && (
              <button className="quiet-button" onClick={() => void cancel()}>
                {recording ? "Discard" : "Cancel"}
              </button>
            )}
            {(retry || conversation.recovery) && !locked && (
              <button className="secondary" onClick={() => void run()}>
                Try again
              </button>
            )}
          </section>
          {completedContext(conversation) && !locked && (
            <div className="prompt-actions">
              <button
                className="primary open-prompt"
                title="Open the prompt as Markdown"
                onClick={() => void openDocument()}
              >
                <FileText size={16} /> Open prompt
              </button>
              <button
                className="secondary"
                title="Copy the prompt as raw Markdown"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(completedContext(conversation))
                    .then(() => setNotice("Copied"))
                    .catch(() =>
                      setError("Could not copy the prompt. Please try again."),
                    );
                }}
              >
                <Copy size={16} /> Copy
              </button>
            </div>
          )}
        </main>
      )}
    </div>
  );
}
