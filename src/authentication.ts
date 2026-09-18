export type AuthenticationMethod = "openai-protocol" | "chatgpt-oauth";

export type ChatGptAccount = {
  connected: boolean;
  email?: string | null;
  plan?: string | null;
};

// Missing values belong to settings saved before the selector was introduced.
export function validateAuthenticationMethod(method: unknown): string {
  return method === undefined ||
    method === "openai-protocol" ||
    method === "chatgpt-oauth"
    ? ""
    : "Unsupported authentication method. Select OpenAI Protocol in Settings.";
}
