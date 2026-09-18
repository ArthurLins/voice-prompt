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
test("legacy settings retain API-key authentication", async () => {
  const { authenticationMethod: _, ...legacy } = structuredClone(defaults);
  mock.invoke.mockImplementation(async (name: string) =>
    name === "get_settings"
      ? { config: legacy, devices: [], models: ["small"] }
      : name === "has_key",
  );
  render(<SettingsWindow />);
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("tab", { name: "Connection" }));
  const selector = screen.getByLabelText(
    "Authentication method",
  ) as HTMLSelectElement;
  expect(selector.value).toBe("openai-protocol");
  await screen.findByRole("button", { name: "Remove saved key" });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock.emit).toHaveBeenCalledOnce());
  const payload = mock.emit.mock.calls[0][2];
  expect(payload.config.authenticationMethod).toBe("openai-protocol");
  expect(payload.config.baseUrl).toBe(defaults.baseUrl);
  expect(mock.invoke.mock.calls.some(([name]) => name === "save_key")).toBe(
    false,
  );
  await act(async () =>
    mock.handlers["settings-saved"]({ payload: { id: payload.id, error: "" } }),
  );
});

test("unsupported saved authentication is rejected before credentials are written", async () => {
  mock.invoke.mockImplementation(async (name: string) =>
    name === "get_settings"
      ? {
          config: {
            ...structuredClone(defaults),
            authenticationMethod: "unsupported",
          },
          devices: [],
          models: ["small"],
        }
      : false,
  );
  render(<SettingsWindow />);
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("tab", { name: "Connection" }));
  fireEvent.change(screen.getByLabelText("API key"), {
    target: { value: "test-key" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(
    (await screen.findByRole("button", { name: "Retry save" })).title,
  ).toContain("Unsupported authentication method");
  expect(mock.emit).not.toHaveBeenCalled();
  expect(mock.invoke.mock.calls.some(([name]) => name === "save_key")).toBe(
    false,
  );
  fireEvent.change(screen.getByLabelText("Authentication method"), {
    target: { value: "openai-protocol" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(mock.emit).toHaveBeenCalledOnce());
  expect(mock.invoke).toHaveBeenCalledWith("save_key", {
    baseUrl: defaults.baseUrl,
    key: "test-key",
  });
  const payload = mock.emit.mock.calls[0][2];
  await act(async () =>
    mock.handlers["settings-saved"]({ payload: { id: payload.id, error: "" } }),
  );
});

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
  fireEvent.click(screen.getByRole("checkbox", { name: "Always on top" }));
  fireEvent.click(screen.getByRole("tab", { name: "Connection" }));
  fireEvent.change(screen.getByLabelText("Thinking effort"), {
    target: { value: "high" },
  });
  fireEvent.change(screen.getByLabelText("Model"), {
    target: { value: "example/model" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock.emit).toHaveBeenCalled());
  const [target, event, payload] = mock.emit.mock.calls[0];
  expect([target, event]).toEqual(["main", "settings-save"]);
  expect(payload.config.model).toBe("example/model");
  expect(payload.config.askQuestions).toBe(true);
  expect(payload.config.alwaysOnTop).toBe(false);
  expect(payload.config.thinkingEffort).toBe("high");
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

test("ChatGPT selection saves without touching an API key and restores protocol fields", async () => {
  mock.invoke.mockImplementation(async (name: string) =>
    name === "get_settings"
      ? { config: structuredClone(defaults), devices: [], models: ["small"] }
      : name === "chatgpt_status"
        ? { connected: true }
        : name === "chatgpt_models"
          ? [
              {
                model: "account-model",
                displayName: "Account model",
                isDefault: true,
              },
            ]
          : false,
  );
  render(<SettingsWindow />);
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("tab", { name: "Connection" }));
  fireEvent.change(screen.getByLabelText("API key"), {
    target: { value: "pending-key" },
  });
  fireEvent.change(screen.getByLabelText("Authentication method"), {
    target: { value: "chatgpt-oauth" },
  });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  expect(screen.queryByLabelText("API URL")).toBeNull();
  expect(screen.queryByLabelText("API key")).toBeNull();
  fireEvent.change(screen.getByLabelText("ChatGPT model"), {
    target: { value: "account-model" },
  });
  fireEvent.change(screen.getByLabelText("Authentication method"), {
    target: { value: "openai-protocol" },
  });
  expect((screen.getByLabelText("API URL") as HTMLInputElement).value).toBe(
    defaults.baseUrl,
  );
  expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe(
    "pending-key",
  );
  fireEvent.change(screen.getByLabelText("Authentication method"), {
    target: { value: "chatgpt-oauth" },
  });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock.emit).toHaveBeenCalledOnce());
  expect(mock.invoke.mock.calls.some(([name]) => name === "save_key")).toBe(
    false,
  );
  const payload = mock.emit.mock.calls[0][2];
  expect(payload.config.authenticationMethod).toBe("chatgpt-oauth");
  expect(payload.config.chatgptModel).toBe("account-model");
  expect(payload.config.model).toBe(defaults.model);
  await act(async () =>
    mock.handlers["settings-saved"]({ payload: { id: payload.id, error: "" } }),
  );
});
