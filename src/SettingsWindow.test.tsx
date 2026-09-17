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
import { defaults } from "./config";
const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  emit: vi.fn(),
  close: vi.fn(),
  handlers: {} as Record<string, (e: any) => void>,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mock.invoke,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: mock.emit }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: async (name: string, handler: any) => {
      mock.handlers[name] = handler;
      return () => {};
    },
    onCloseRequested: async () => () => {},
    close: mock.close,
  }),
}));
import SettingsWindow from "./SettingsWindow";
beforeEach(() => {
  vi.clearAllMocks();
  mock.close.mockResolvedValue(undefined);
  mock.emit.mockResolvedValue(undefined);
  mock.invoke.mockImplementation(async (name: string) =>
    name === "get_settings"
      ? { config: structuredClone(defaults), devices: [], models: ["small"] }
      : false,
  );
});
afterEach(cleanup);
test("settings are persisted by the main window and close only after acknowledgment", async () => {
  render(<SettingsWindow />);
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Clarify uncertainties before generating",
    }),
  );
  fireEvent.click(screen.getByRole("tab", { name: "Connection" }));
  fireEvent.change(screen.getByLabelText("Model"), {
    target: { value: "example/model" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock.emit).toHaveBeenCalled());
  const [target, event, payload] = mock.emit.mock.calls[0];
  expect([target, event]).toEqual(["main", "settings-save"]);
  expect(payload.config.model).toBe("example/model");
  expect(payload.config.askQuestions).toBe(true);
  expect(mock.close).not.toHaveBeenCalled();
  await act(async () =>
    mock.handlers["settings-saved"]({ payload: { id: payload.id, error: "" } }),
  );
  expect(mock.close).toHaveBeenCalledOnce();
});
test("cancel discards draft and a failed save remains visible", async () => {
  render(<SettingsWindow />);
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock.emit).toHaveBeenCalled());
  await act(async () =>
    mock.handlers["settings-saved"]({
      payload: { id: mock.emit.mock.calls[0][2].id, error: "Disk unavailable" },
    }),
  );
  expect(
    (await screen.findByRole("button", { name: "Retry save" })).getAttribute(
      "title",
    ),
  ).toContain("Disk unavailable");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(mock.close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(mock.close).toHaveBeenCalledOnce());
  expect(mock.emit).toHaveBeenCalledOnce();
});
