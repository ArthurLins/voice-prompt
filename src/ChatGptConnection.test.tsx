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
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import ChatGptConnection from "./ChatGptConnection";
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
test("login completion updates the account and logout clears it", async () => {
  invoke.mockImplementation(async (name) =>
    name === "chatgpt_models"
      ? [{ model: "test-model", displayName: "Test model", isDefault: true }]
      : name === "chatgpt_login"
        ? { connected: true, email: "test@example.com" }
        : { connected: false },
  );
  render(
    <ChatGptConnection
      model=""
      onModelChange={() => {}}
      desktop
      onBusy={() => {}}
    />,
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Connect ChatGPT",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Connect ChatGPT" }));
  await screen.findByText(/Connected as test@example.com/);
  fireEvent.click(screen.getByRole("button", { name: "Disconnect ChatGPT" }));
  await screen.findByRole("button", { name: "Connect ChatGPT" });
  expect(invoke).toHaveBeenCalledWith("chatgpt_logout");
});
test("pending login can be cancelled and errors allow retry", async () => {
  let rejectLogin!: (e: Error) => void;
  invoke.mockImplementation((name) => {
    if (name === "chatgpt_login")
      return new Promise((_, reject) => {
        rejectLogin = reject;
      });
    if (name === "chatgpt_cancel_login")
      rejectLogin(new Error("Login cancelled"));
    return Promise.resolve({ connected: false });
  });
  const view = render(
    <ChatGptConnection
      model=""
      onModelChange={() => {}}
      desktop
      onBusy={() => {}}
    />,
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Connect ChatGPT",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Connect ChatGPT" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel login" }));
  await screen.findByText(/Login cancelled/);
  fireEvent.click(screen.getByRole("button", { name: "Connect ChatGPT" }));
  await act(async () => view.unmount());
  expect(
    invoke.mock.calls.filter(([name]) => name === "chatgpt_cancel_login"),
  ).toHaveLength(2);
});
test("missing CLI is shown with a retry action and preview never invokes login", async () => {
  invoke.mockRejectedValue(new Error("Install the official Codex CLI"));
  const view = render(
    <ChatGptConnection
      model=""
      onModelChange={() => {}}
      desktop
      onBusy={() => {}}
    />,
  );
  await screen.findByText(/Install the official Codex CLI/);
  expect(
    (
      screen.getByRole("button", {
        name: "Refresh connection",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  view.unmount();
  invoke.mockClear();
  render(
    <ChatGptConnection
      model=""
      onModelChange={() => {}}
      desktop={false}
      onBusy={() => {}}
    />,
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Connect ChatGPT",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(invoke).not.toHaveBeenCalled();
});

test("loads account models, uses their identifiers and preserves an unavailable selection", async () => {
  invoke.mockImplementation(async (name) =>
    name === "chatgpt_models"
      ? [
          { model: "model-id", displayName: "Friendly model", isDefault: true },
          { model: "second-id", displayName: "Second model", isDefault: false },
        ]
      : { connected: true },
  );
  const change = vi.fn();
  render(
    <ChatGptConnection
      desktop
      model="retired-model"
      onModelChange={change}
      onBusy={() => {}}
    />,
  );
  await screen.findByRole("option", { name: "Friendly model" });
  const select = screen.getByRole("combobox", {
    name: "ChatGPT model",
  }) as HTMLSelectElement;
  expect(select.value).toBe("retired-model");
  expect(screen.getByText(/saved model is unavailable/)).toBeTruthy();
  fireEvent.change(select, { target: { value: "second-id" } });
  expect(change).toHaveBeenCalledWith("second-id");
  expect(invoke).toHaveBeenCalledWith("chatgpt_models");
});

test("catalog failure does not hide successful login and refresh retries", async () => {
  let attempts = 0;
  invoke.mockImplementation(async (name) => {
    if (name === "chatgpt_models") {
      if (++attempts === 1) throw new Error("Catalog temporarily unavailable");
      return [
        { model: "model-id", displayName: "Available model", isDefault: true },
      ];
    }
    return { connected: true, email: "test@example.com" };
  });
  render(
    <ChatGptConnection
      desktop
      model=""
      onModelChange={() => {}}
      onBusy={() => {}}
    />,
  );
  await screen.findByText(/Catalog temporarily unavailable/);
  expect(screen.getByText(/Connected as/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh connection" }));
  await screen.findByRole("option", { name: "Available model" });
  expect(screen.queryByText(/Catalog temporarily unavailable/)).toBeNull();
});

test("returning to the window reconciles a persisted connection and loads models", async () => {
  let connected = false;
  invoke.mockImplementation(async (name) =>
    name === "chatgpt_models"
      ? [{ model: "model-id", displayName: "Available model", isDefault: true }]
      : { connected },
  );
  render(
    <ChatGptConnection
      desktop
      model=""
      onModelChange={() => {}}
      onBusy={() => {}}
    />,
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Connect ChatGPT",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  connected = true;
  fireEvent(window, new Event("focus"));
  await screen.findByRole("option", { name: "Available model" });
  expect(
    screen.getByRole("button", { name: "Disconnect ChatGPT" }),
  ).toBeTruthy();
});
