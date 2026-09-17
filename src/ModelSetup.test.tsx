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
  size: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: mock.invoke,
  Channel: class {
    onmessage = (_event: unknown) => {};
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setSize: mock.size }),
}));
import ModelSetup from "./ModelSetup";
import ModelManager from "./ModelManager";
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
test("first launch stays gated through download, verification and engine readiness", async () => {
  let installed = false;
  let finishDownload!: () => void;
  let finishWarm!: () => void;
  mock.invoke.mockImplementation(async (command, args) => {
    if (command === "voice_status")
      return {
        ready: installed,
        models: installed ? ["large-v3-turbo-q5_0"] : [],
      };
    if (command === "load_workspace")
      return { config: { voiceModel: "small" } };
    if (command === "download_model") {
      args.channel.onmessage({
        downloaded: 287020598,
        total: 574041195,
        phase: "downloading",
      });
      await new Promise<void>((r) => {
        finishDownload = () => {
          installed = true;
          r();
        };
      });
    }
    if (command === "warm_voice")
      await new Promise<void>((r) => {
        finishWarm = r;
      });
  });
  render(
    <ModelSetup>
      <div>Main screen</div>
    </ModelSetup>,
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Download Whisper large-v3-turbo",
    }),
  );
  expect(await screen.findByText(/50%/)).toBeTruthy();
  expect(screen.queryByText("Main screen")).toBeNull();
  await act(async () => finishDownload());
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith("warm_voice", {
      model: "large-v3-turbo-q5_0",
    }),
  );
  expect(screen.queryByText("Main screen")).toBeNull();
  await act(async () => finishWarm());
  expect(await screen.findByText("Main screen")).toBeTruthy();
});
test("a checksum failure leaves setup available for retry", async () => {
  mock.invoke.mockImplementation(async (command) => {
    if (command === "voice_status") return { ready: false, models: [] };
    if (command === "download_model")
      throw new Error("SHA-256 verification failed");
  });
  render(
    <ModelSetup>
      <div>Main screen</div>
    </ModelSetup>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Download Whisper small" }),
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("SHA-256"),
  );
  expect(screen.queryByText("Main screen")).toBeNull();
  expect(
    (
      screen.getByRole("button", {
        name: "Download Whisper small",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  expect(mock.invoke.mock.calls.some(([name]) => name === "warm_voice")).toBe(
    false,
  );
});
test("deletion is disabled for the last model and refreshes the catalog after removal", async () => {
  const changed = vi.fn();
  const view = render(
    <ModelManager installed={["small"]} onChanged={changed} />,
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Delete Whisper small",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  view.rerender(
    <ModelManager
      installed={["small", "large-v3-turbo-q5_0"]}
      onChanged={changed}
    />,
  );
  mock.invoke.mockImplementation(async (command) =>
    command === "voice_status"
      ? { ready: true, models: ["large-v3-turbo-q5_0"] }
      : undefined,
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete Whisper small" }));
  await waitFor(() =>
    expect(changed).toHaveBeenCalledWith({
      ready: true,
      models: ["large-v3-turbo-q5_0"],
    }),
  );
  expect(mock.invoke).toHaveBeenCalledWith("delete_model", { model: "small" });
});
