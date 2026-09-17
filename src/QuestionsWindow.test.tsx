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
const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  emit: vi.fn(),
  close: vi.fn(),
  receive: (_e: any) => {},
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mock.invoke,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: mock.emit }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: mock.close,
    listen: async (_name: string, handler: any) => {
      mock.receive = handler;
      return () => {};
    },
  }),
}));
import QuestionsWindow from "./QuestionsWindow";
const initial = {
  conversationId: "a",
  roundId: "one",
  pending: {
    questions: [
      { question: "Who is it for?", options: [] },
      { question: "What format?", options: ["Plan", "Implementation"] },
    ],
    answers: ["", ""],
  },
  busy: false,
  error: "",
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.invoke.mockResolvedValue(structuredClone(initial));
  mock.emit.mockResolvedValue(undefined);
  mock.close.mockResolvedValue(undefined);
});
afterEach(cleanup);
test("floating form sends Portuguese text and choice answers together, then renders a new round", async () => {
  render(<QuestionsWindow />);
  fireEvent.change(
    await screen.findByRole("textbox", { name: "Who is it for?" }),
    { target: { value: "Para minha equipe" } },
  );
  fireEvent.click(screen.getByRole("radio", { name: "Plan" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() =>
    expect(mock.emit).toHaveBeenCalledWith("main", "question-action", {
      conversationId: "a",
      roundId: "one",
      action: "submit",
      answers: ["Para minha equipe", "Plan"],
    }),
  );
  await act(async () => mock.receive({ payload: { ...initial, busy: true } }));
  expect(
    (
      screen.getByRole("textbox", {
        name: "Who is it for?",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("Para minha equipe");
  await act(async () =>
    mock.receive({
      payload: {
        ...initial,
        roundId: "two",
        pending: {
          questions: [{ question: "What platform?", options: [] }],
          answers: [""],
        },
      },
    }),
  );
  expect(
    await screen.findByRole("textbox", { name: "What platform?" }),
  ).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Who is it for?" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Minimize" })).toBeNull();
});
test("close does not discard questions and older snapshots cannot overwrite an edited answer", async () => {
  render(<QuestionsWindow />);
  fireEvent.change(
    await screen.findByRole("textbox", { name: "Who is it for?" }),
    { target: { value: "Não sei ainda" } },
  );
  await act(async () => mock.receive({ payload: initial }));
  expect(
    (
      screen.getByRole("textbox", {
        name: "Who is it for?",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("Não sei ainda");
  fireEvent.click(screen.getByRole("button", { name: "Close questions" }));
  await waitFor(() => expect(mock.close).toHaveBeenCalledOnce());
  expect(mock.emit.mock.calls.some(([, , p]) => p.action === "discard")).toBe(
    false,
  );
});
