import defaults from "./prompt-defaults.json";
import legacy from "./prompt-defaults-pt.json";
export type PromptProfile = {
  id: string;
  name: string;
  description: string;
  language: "en" | "pt" | "source";
  tone: "assertive" | "neutral";
  instructions: string;
};
export type PromptConfig = {
  promptType: string;
  editorInstructions: string;
  promptProfiles: PromptProfile[];
};
export const defaultPromptConfig = (): PromptConfig => ({
  promptType: "auto",
  editorInstructions: defaults.editorInstructions,
  promptProfiles: structuredClone(defaults.promptProfiles) as PromptProfile[],
});
export function normalizePromptConfig(
  value: Partial<PromptConfig> = {},
): PromptConfig {
  const fallback = defaultPromptConfig();
  const profiles = Array.isArray(value.promptProfiles)
    ? value.promptProfiles.filter(
        (p) =>
          p &&
          typeof p.id === "string" &&
          typeof p.name === "string" &&
          typeof p.description === "string" &&
          typeof p.instructions === "string" &&
          ["en", "pt", "source"].includes(p.language) &&
          ["assertive", "neutral"].includes(p.tone),
      )
    : [];
  const unique = profiles.filter(
    (p, i) => profiles.findIndex((other) => other.id === p.id) === i,
  );
  const promptProfiles = unique.length
    ? unique.map((profile) => {
        const old = legacy.promptProfiles.find((p) => p.id === profile.id);
        const current = fallback.promptProfiles.find(
          (p) => p.id === profile.id,
        );
        if (!old || !current) return profile;
        return {
          ...profile,
          ...Object.fromEntries(
            (["name", "description", "instructions"] as const).map((key) => [
              key,
              profile[key] === old[key] ? current[key] : profile[key],
            ]),
          ),
        };
      })
    : fallback.promptProfiles;
  return {
    promptProfiles,
    editorInstructions:
      typeof value.editorInstructions === "string" &&
      value.editorInstructions !== legacy.editorInstructions
        ? value.editorInstructions
        : fallback.editorInstructions,
    promptType:
      value.promptType === "auto" ||
      promptProfiles.some((p) => p.id === value.promptType)
        ? value.promptType!
        : "auto",
  };
}
export function validatePromptConfig(config: PromptConfig): string | null {
  if (
    !config.editorInstructions.trim() ||
    config.editorInstructions.length > 12000
  )
    return "Enter the general instructions (up to 12,000 characters).";
  if (!config.promptProfiles.length || config.promptProfiles.length > 16)
    return "Use between 1 and 16 prompt types.";
  if (
    config.promptType !== "auto" &&
    !config.promptProfiles.some((p) => p.id === config.promptType)
  )
    return "Select a valid prompt type.";
  for (const p of config.promptProfiles) {
    if (!p.name.trim() || !p.description.trim() || !p.instructions.trim())
      return "Enter a name, purpose and instructions for each type.";
    if (
      p.name.length > 60 ||
      p.description.length > 1000 ||
      p.instructions.length > 6000
    )
      return "A prompt type exceeded the size limit.";
  }
  return null;
}
