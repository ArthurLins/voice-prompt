// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { commandKey, commandPressed } from "./platform";

afterEach(() => vi.restoreAllMocks());

test("Mac shortcuts use Command instead of Control", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  expect(commandKey()).toBe("Cmd");
  expect(commandPressed({ metaKey: true, ctrlKey: false })).toBe(true);
  expect(commandPressed({ metaKey: false, ctrlKey: true })).toBe(false);
});

test("Windows shortcuts retain Control", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  expect(commandKey()).toBe("Ctrl");
  expect(commandPressed({ metaKey: false, ctrlKey: true })).toBe(true);
  expect(commandPressed({ metaKey: true, ctrlKey: false })).toBe(false);
});
