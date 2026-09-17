import { defaultPromptConfig, type PromptConfig } from "./prompts";
export type Config = PromptConfig & {
  baseUrl: string;
  model: string;
  style: string;
  language: string;
  deviceId: string;
  autoOptimize: boolean;
  voiceModel: string;
  alwaysOnTop: boolean;
  askQuestions: boolean;
};
export const defaults: Config = {
  ...defaultPromptConfig(),
  baseUrl: "https://openrouter.ai/api/v1",
  model: "openai/gpt-5.6-luna",
  style: "equilibrado",
  language: "pt",
  deviceId: "",
  autoOptimize: true,
  voiceModel: "small",
  alwaysOnTop: true,
  askQuestions: false,
};
