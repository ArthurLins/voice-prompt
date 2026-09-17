import { describe, expect, it } from "vitest";
import {
  defaultPromptConfig,
  normalizePromptConfig,
  validatePromptConfig,
} from "./prompts";

describe("prompt settings and migration", () => {
  it("adds defaults to old workspaces without prompt settings", () => {
    const migrated = normalizePromptConfig();
    expect(migrated.promptType).toBe("auto");
    expect(migrated.promptProfiles.find((p) => p.id === "code")).toMatchObject({
      language: "en",
      tone: "assertive",
    });
    expect(validatePromptConfig(migrated)).toBeNull();
  });
  it("preserves edited rules, languages, selected type and custom types across storage", () => {
    const config = defaultPromptConfig();
    config.editorInstructions = "Use short sections.";
    config.promptProfiles[0].language = "pt";
    config.promptProfiles[0].instructions = "Preserve identifiers.";
    config.promptProfiles.push({
      id: "custom",
      name: "Custom",
      description: "My specific task",
      instructions: "Produce a checklist prompt.",
      language: "en",
      tone: "neutral",
    });
    config.promptType = "custom";
    expect(normalizePromptConfig(JSON.parse(JSON.stringify(config)))).toEqual(
      config,
    );
  });
  it("restores valid selection and never shares mutable defaults", () => {
    const one = defaultPromptConfig();
    one.promptProfiles[0].name = "Changed";
    expect(defaultPromptConfig().promptProfiles[0].name).toBe("Code");
    expect(
      normalizePromptConfig({ ...one, promptType: "missing" }).promptType,
    ).toBe("auto");
  });
  it("blocks incomplete or oversized definitions before saving", () => {
    const config = defaultPromptConfig();
    config.promptProfiles[0].instructions = "";
    expect(validatePromptConfig(config)).not.toBeNull();
    config.promptProfiles[0].instructions = "x".repeat(6001);
    expect(validatePromptConfig(config)).not.toBeNull();
  });
});

it("migrates only untouched Portuguese defaults and preserves custom Portuguese instructions", async () => {
  const legacy = (await import("./prompt-defaults-pt.json")).default;
  const migrated = normalizePromptConfig({
    ...legacy,
    promptType: "auto",
  } as any);
  expect(migrated.promptProfiles[0].name).toBe("Code");
  expect(migrated.editorInstructions).toBe(
    defaultPromptConfig().editorInstructions,
  );
  const custom = normalizePromptConfig({
    ...legacy,
    editorInstructions: "Preserve minhas instruções em português.",
    promptProfiles: legacy.promptProfiles.map((p) => ({
      ...p,
      instructions: "Não altere meu texto.",
    })),
  } as any);
  expect(custom.editorInstructions).toBe(
    "Preserve minhas instruções em português.",
  );
  expect(custom.promptProfiles[0].instructions).toBe("Não altere meu texto.");
});
