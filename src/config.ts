import { defaultPromptConfig, type PromptConfig } from "./prompts";
import type { AuthenticationMethod } from "./authentication";
export type Config = PromptConfig & {
  authenticationMethod: AuthenticationMethod;
  chatgptModel: string;
  baseUrl: string;
  model: string;
  thinkingEffort:
    | "default"
    | "none"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max";
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
  authenticationMethod: "openai-protocol",
  chatgptModel: "",
  baseUrl: "https://openrouter.ai/api/v1",
  model: "openai/gpt-5.6-luna",
  thinkingEffort: "default",
  style: "equilibrado",
  language: "pt",
  deviceId: "",
  autoOptimize: true,
  voiceModel: "small",
  alwaysOnTop: true,
  askQuestions: false,
};
