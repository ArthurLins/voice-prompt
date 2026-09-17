// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { defaultPromptConfig } from "./prompts";
import { completedContext } from "./conversation";

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  copy: vi.fn(),
  top: vi.fn(),
  close: vi.fn(),
  minimize: vi.fn(),
  listeners: {} as Record<string, (event: any) => Promise<void>>,
}));
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: mock.invoke,
  Channel: class {
    onmessage = (_event: unknown) => {};
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setAlwaysOnTop: mock.top,
    onCloseRequested: async () => () => {},
    close: mock.close,
    minimize: mock.minimize,
    listen: async (name: string, handler: any) => {
      mock.listeners[name] = handler;
      return () => {};
    },
    destroy: async () => {},
    startDragging: async () => {},
  }),
}));
vi.mock("./audio", () => ({
  MAX_RECORDING_SECONDS: 1800,
  VoiceRecorder: class {
    start = async () => {};
    stop = async () => "local-wav";
    dispose = () => {};
  },
}));
import App from "./App";

const original = "# Original\n\nImplement a timer.\n\n- Keep it local.";
const generated =
  "# Updated\n\nImplement a timer with **dark mode**.\n\n```ts\nconst theme = 'dark';\n```";
let request: Record<string, any>;
let resolveRequest: (text: any) => void;
let rejectRequest: (error: Error) => void;
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  mock.top.mockResolvedValue(undefined);
  mock.copy.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mock.copy },
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: async () => [],
      addEventListener() {},
      removeEventListener() {},
    },
  });
  mock.invoke.mockImplementation(
    async (name: string, args: Record<string, any>) => {
      if (name === "load_workspace")
        return {
          selected: "a",
          config: {
            ...defaultPromptConfig(),
            autoOptimize: false,
            alwaysOnTop: false,
          },
          conversations: [
            {
              id: "a",
              title: "Existing",
              source: "private raw dictation",
              output: original,
              versions: [],
              complete: true,
              updated: new Date().toISOString(),
            },
          ],
        };
      if (name === "voice_status")
        return { ready: true, models: ["small"], model: "small" };
      if (name === "run_request") {
        request = args;
        args.channel.onmessage({ type: "transcript", value: "Add dark mode" });
        return new Promise<string>((resolve, reject) => {
          resolveRequest = resolve;
          rejectRequest = reject;
        });
      }
      return null;
    },
  );
});
afterEach(cleanup);

async function openExistingApp() {
  render(<App />);
  await waitFor(() =>
    expect(
      mock.invoke.mock.calls.some(([name]) => name === "sync_history"),
    ).toBe(true),
  );
  await act(async () =>
    mock.listeners["history-action"]({
      payload: { action: "select", id: "a" },
    }),
  );
}
async function record(action = "Refine current prompt") {
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: action,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: action }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Finish recording" }),
  );
  await screen.findByText("Preparing your prompt");
}
test("refinement stays explicit and the prompt is only passed to its separate window", async () => {
  await openExistingApp();
  await screen.findByRole("button", { name: "Open prompt" });
  expect(screen.queryByText("private raw dictation")).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Entrada" })).toBeNull();
  await record();
  expect(screen.queryByRole("region", { name: "Prompt gerado" })).toBeNull();
  expect(request.previous).toBe(original);
  expect(request.transcribeOnly).toBe(false);
  await act(async () => resolveRequest(generated));
  await screen.findByRole("button", { name: "Open prompt" });
  expect(screen.queryByRole("heading", { name: "Updated" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Original" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open prompt" }));
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith("open_document", {
      text: generated,
      alwaysOnTop: true,
    }),
  );
});
test("failed generation preserves the completed result and can retry without recording again", async () => {
  await openExistingApp();
  await screen.findByRole("button", { name: "Open prompt" });
  await record();
  await act(async () => rejectRequest(new Error("Connection interrupted")));
  expect(
    await screen.findByRole("button", { name: "Open prompt" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Preparing your prompt");
  expect(request.text).toBe("Add dark mode");
  expect(request.previous).toBe(original);
  await act(async () => resolveRequest(generated));
});
test("new conversation clears implicit context", async () => {
  await openExistingApp();
  await screen.findByRole("button", { name: "Open prompt" });
  await record("Record new prompt");
  expect(request.previous).toBe("");
  await act(async () => resolveRequest(generated));
});
test("legacy interrupted output is excluded from context", () => {
  expect(
    completedContext({
      complete: false,
      output: "incomplete",
      versions: [{ output: original }],
    }),
  ).toBe(original);
  expect(
    completedContext({ complete: false, output: "incomplete", versions: [] }),
  ).toBe("");
});

test("settings opens outside the main interface and minimizing uses the native command", async () => {
  await openExistingApp();
  await screen.findByRole("button", { name: "Open prompt" });
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith(
      "open_settings",
      expect.objectContaining({ config: expect.any(Object) }),
    ),
  );
  expect(screen.queryByRole("textbox", { name: "Model" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Minimize" })).toBeNull();
  expect(mock.top).toHaveBeenCalledWith(true);
});
test("saving settings preserves conversation and current pin preference", async () => {
  await openExistingApp();
  await screen.findByRole("button", { name: "Open prompt" });
  await act(async () =>
    mock.listeners["settings-save"]({
      payload: {
        id: "save",
        config: {
          ...defaultPromptConfig(),
          alwaysOnTop: true,
          model: "edited-model",
        },
      },
    }),
  );
  expect(mock.invoke).toHaveBeenCalledWith("save_workspace", {
    data: expect.objectContaining({
      config: expect.objectContaining({
        model: "edited-model",
        alwaysOnTop: true,
      }),
      conversations: expect.arrayContaining([
        expect.objectContaining({ output: original }),
      ]),
    }),
  });
});

test("first prompt starts recording in one click and refinement appears only after completion", async () => {
  render(<App />);
  await waitFor(() =>
    expect(
      mock.invoke.mock.calls.some(([name]) => name === "sync_history"),
    ).toBe(true),
  );
  expect(
    screen.queryByRole("button", { name: "Refine current prompt" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "New prompt" })).toBeNull();
  await record("Record new prompt");
  expect(request.previous).toBe("");
  await act(async () => resolveRequest(generated));
  expect(
    await screen.findByRole("button", { name: "Refine current prompt" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Record new prompt" }),
  ).toBeTruthy();
});
test("discarding a new recording keeps the current prompt available", async () => {
  await openExistingApp();
  await screen.findByRole("button", { name: "Open prompt" });
  fireEvent.click(screen.getByRole("button", { name: "Record new prompt" }));
  await screen.findByRole("button", { name: "Finish recording" });
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  fireEvent.click(await screen.findByRole("button", { name: "Open prompt" }));
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith("open_document", {
      text: original,
      alwaysOnTop: true,
    }),
  );
});

test("main remains topmost and copies the completed Markdown without opening a document", async () => {
  await openExistingApp();
  await screen.findByRole("button", { name: "Open prompt" });
  expect(mock.top).toHaveBeenCalledWith(true);
  expect(screen.queryByRole("button", { name: "Always on top" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Minimize" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(mock.copy).toHaveBeenCalledWith(original));
  expect(
    mock.invoke.mock.calls.some(([name]) => name === "open_document"),
  ).toBe(false);
});
const questionResult = {
  questions: [
    { question: "Who is this for?", options: [] },
    { question: "What format?", options: ["Plan", "Implementation"] },
  ],
  assistant: {
    role: "assistant",
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: { name: "ask_clarifying_questions", arguments: "{}" },
      },
    ],
  },
};
async function enableQuestions() {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const config = mock.invoke.mock.calls.find(
    ([name]) => name === "open_settings",
  )![1].config;
  await act(async () =>
    mock.listeners["settings-save"]({
      payload: { id: "questions", config: { ...config, askQuestions: true } },
    }),
  );
}
function questionSnapshot() {
  return mock.invoke.mock.calls
    .filter(([name]) => name === "sync_questions")
    .at(-1)![1].data;
}
async function answer(action: string, answers: string[]) {
  const snapshot = questionSnapshot();
  await act(async () =>
    mock.listeners["question-action"]({
      payload: {
        conversationId: snapshot.conversationId,
        roundId: snapshot.roundId,
        action,
        answers,
      },
    }),
  );
}
test("questions are external, Portuguese answers stay intact, subsequent rounds lead to final output", async () => {
  await openExistingApp();
  await screen.findByRole("button", { name: "Open prompt" });
  await enableQuestions();
  await record();
  expect(request.settings.askQuestions).toBe(true);
  await act(async () => resolveRequest(questionResult));
  await screen.findByRole("button", { name: "Open questions" });
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(questionSnapshot().pending.questions).toEqual(
    questionResult.questions,
  );
  await answer("submit", ["Para minha equipe brasileira", "Plan"]);
  expect(request.previous).toBe(original);
  expect(request.clarificationTurns[0].answers).toEqual([
    "Para minha equipe brasileira",
    "Plan",
  ]);
  const next = {
    questions: [{ question: "Any other constraints?", options: [] }],
    assistant: {
      ...questionResult.assistant,
      tool_calls: [{ ...questionResult.assistant.tool_calls[0], id: "call_2" }],
    },
  };
  await act(async () => resolveRequest(next));
  await answer("submit", ["Não adicione bibliotecas"]);
  expect(request.clarificationTurns).toHaveLength(2);
  expect(request.clarificationTurns[1].answers).toEqual([
    "Não adicione bibliotecas",
  ]);
  await act(async () => rejectRequest(new Error("Network unavailable")));
  expect(questionSnapshot().pending.answers).toEqual([
    "Não adicione bibliotecas",
  ]);
  await answer("submit", ["Não adicione bibliotecas"]);
  await act(async () => resolveRequest(generated));
  await screen.findByRole("button", { name: "Open prompt" });
  expect(questionSnapshot()).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(mock.copy).toHaveBeenCalledWith(generated));
});
test("question mode remains optional and clear requests can finish directly", async () => {
  await openExistingApp();
  await screen.findByRole("button", { name: "Open prompt" });
  await record();
  expect(request.settings.askQuestions).toBe(false);
  await act(async () => resolveRequest(generated));
  await enableQuestions();
  await record("Record new prompt");
  expect(request.previous).toBe("");
  await act(async () => resolveRequest(generated));
  expect(screen.queryByRole("button", { name: "Open questions" })).toBeNull();
});
test("pending answers persist and stale question-window events are ignored", async () => {
  await openExistingApp();
  await screen.findByRole("button", { name: "Open prompt" });
  await enableQuestions();
  await record();
  await act(async () => resolveRequest(questionResult));
  await answer("answers", ["Equipe interna", ""]);
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith("save_workspace", {
      data: expect.objectContaining({
        conversations: expect.arrayContaining([
          expect.objectContaining({
            pending: expect.objectContaining({
              answers: ["Equipe interna", ""],
            }),
          }),
        ]),
      }),
    }),
  );
  await act(async () =>
    mock.listeners["question-action"]({
      payload: {
        ...questionSnapshot(),
        roundId: "stale",
        action: "discard",
        answers: [],
      },
    }),
  );
  expect(screen.getByRole("button", { name: "Open questions" })).toBeTruthy();
  await answer("discard", []);
  fireEvent.click(await screen.findByRole("button", { name: "Copy" }));
  await waitFor(() => expect(mock.copy).toHaveBeenCalledWith(original));
});

test("transcription failure retries the saved audio and never reuses an old refinement source", async () => {
  const originalInvoke = mock.invoke.getMockImplementation()!;
  const requests: Record<string, any>[] = [];
  mock.invoke.mockImplementation(async (name, args) => {
    if (name === "run_request") {
      requests.push(args);
      if (requests.length === 1) throw new Error("Whisper timed out");
      args.channel.onmessage({
        type: "transcript",
        value: "Minha nova alteração",
      });
      return generated;
    }
    return originalInvoke(name, args);
  });
  await openExistingApp();
  await screen.findByRole("button", { name: "Open prompt" });
  fireEvent.click(
    screen.getByRole("button", { name: "Refine current prompt" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Finish recording" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[0].audioId).toBeTruthy();
  expect(requests[1].audioId).toBe(requests[0].audioId);
  expect(requests[1].text).toBe("");
  expect(requests[1].previous).toBe(original);
  expect(
    mock.invoke.mock.calls.filter(([name]) => name === "save_recording"),
  ).toHaveLength(1);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull(),
  );
});

test("a saved interrupted recording can resume after reopening", async () => {
  const originalInvoke = mock.invoke.getMockImplementation()!;
  const requests: Record<string, any>[] = [];
  mock.invoke.mockImplementation(async (name, args) => {
    if (name === "load_workspace") {
      const stored = await originalInvoke(name, args);
      stored.conversations[0].recovery = {
        id: "saved-recording",
        source: "",
        previous: original,
      };
      return stored;
    }
    if (name === "run_request") {
      requests.push(args);
      return generated;
    }
    return originalInvoke(name, args);
  });
  await openExistingApp();
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0].audioId).toBe("saved-recording");
  expect(requests[0].previous).toBe(original);
  expect(
    mock.invoke.mock.calls.some(([name]) => name === "save_recording"),
  ).toBe(false);
});

test("startup always selects a fresh conversation while preserving history and recovery", async () => {
  render(<App />);
  await waitFor(() =>
    expect(
      mock.invoke.mock.calls.some(([name]) => name === "sync_history"),
    ).toBe(true),
  );
  expect(screen.queryByRole("button", { name: "Open prompt" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Refine current prompt" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith("sync_history", {
      show: true,
      data: expect.objectContaining({
        selected: expect.not.stringMatching(/^a$/),
        conversations: expect.arrayContaining([
          expect.objectContaining({ id: "a", title: "Existing" }),
        ]),
      }),
    }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  for (const label of [
    "History",
    "Settings",
    "Close app",
    "Record new prompt",
  ]) {
    expect(
      screen.getByRole("button", { name: label }).getAttribute("title"),
    ).toBeTruthy();
  }
});

test("history deletion uses the separate window event and never a browser confirmation", async () => {
  await openExistingApp();
  const confirm = vi.spyOn(window, "confirm");
  await act(async () =>
    mock.listeners["history-action"]({
      payload: { action: "delete", id: "a" },
    }),
  );
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Open prompt" })).toBeNull();
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith("sync_history", {
      show: false,
      data: expect.objectContaining({ conversations: [] }),
    }),
  );
  confirm.mockRestore();
});
