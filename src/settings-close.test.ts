// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { waitFor } from "@testing-library/react";
import { mockIPC, mockWindows, clearMocks } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import capability from "../src-tauri/capabilities/settings.json";

afterEach(clearMocks);
test("the real Tauri close listener can destroy the settings window", async () => {
  let destroyed = false;
  mockWindows("settings");
  mockIPC(
    (command) => {
      if (command === "plugin:window|destroy") {
        expect(capability.permissions).toContain("core:window:allow-destroy");
        destroyed = true;
      }
    },
    { shouldMockEvents: true },
  );
  const off = await getCurrentWindow().onCloseRequested(() => {});
  await emit("tauri://close-requested");
  await waitFor(() => expect(destroyed).toBe(true));
  off();
});
