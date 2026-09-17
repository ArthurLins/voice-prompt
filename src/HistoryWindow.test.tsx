// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const mock = vi.hoisted(() => ({
  emit: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  update: (_: any) => {},
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: async () => ({
    selected: "a",
    locked: false,
    conversations: [
      {
        id: "a",
        title: "Timer",
        searchText: "dark mode",
        updated: "2026-09-17",
      },
      {
        id: "b",
        title: "Website",
        searchText: "portfolio",
        updated: "2026-09-17",
      },
    ],
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: mock.emit }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: mock.close,
    minimize: async () => {},
    startDragging: async () => {},
    listen: async (_: string, fn: any) => {
      mock.update = fn;
      return () => {};
    },
  }),
}));
import HistoryWindow from "./HistoryWindow";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
test("history searches source text, selects through the main window and closes", async () => {
  render(<HistoryWindow />);
  await screen.findByText("Timer");
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search conversations" }),
    { target: { value: "dark" } },
  );
  expect(screen.queryByText("Website")).toBeNull();
  fireEvent.click(screen.getByText("Timer"));
  await waitFor(() =>
    expect(mock.emit).toHaveBeenCalledWith("main", "history-action", {
      action: "select",
      id: "a",
    }),
  );
  expect(mock.close).toHaveBeenCalled();
});
test("deletion stays in history and synchronized busy state disables edits", async () => {
  render(<HistoryWindow />);
  const button = await screen.findByRole("button", { name: "Delete Timer" });
  expect(button.getAttribute("title")).toBe("Delete Timer");
  fireEvent.click(button);
  await waitFor(() =>
    expect(mock.emit).toHaveBeenCalledWith("main", "history-action", {
      action: "delete",
      id: "a",
    }),
  );
  expect(mock.close).not.toHaveBeenCalled();
  await act(async () =>
    mock.update({ payload: { selected: "", locked: true, conversations: [] } }),
  );
  expect(
    (screen.getByRole("button", { name: "New" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Close history" }));
  expect(mock.close).toHaveBeenCalled();
});
