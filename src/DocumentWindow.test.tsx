// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const mock = vi.hoisted(() => ({ copy: vi.fn() }));
const markdown =
  "# Prompt\n\nUse **bold** and `code`.\n\n```ts\nconst x = 1;\n```";
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: async () =>
    "# Prompt\n\nUse **bold** and `code`.\n\n```ts\nconst x = 1;\n```",
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ listen: async () => () => {} }),
}));
import DocumentWindow from "./DocumentWindow";
afterEach(cleanup);
test("document renders Markdown while copying the unmodified source", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mock.copy.mockResolvedValue(undefined) },
  });
  render(<DocumentWindow />);
  await screen.findByRole("heading", { name: "Prompt" });
  fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" }));
  await waitFor(() => expect(mock.copy).toHaveBeenCalledWith(markdown));
});
