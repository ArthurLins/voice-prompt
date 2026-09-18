# ChatGPT connection

In Settings → Connection, select **ChatGPT login (OAuth)** and click **Connect ChatGPT**. Complete the official OpenAI login in your browser, wait for the connected account to appear, then click **Save**. Login/logout take effect immediately; Cancel discards settings edits and cancels an unfinished login. Existing API keys are preserved when switching methods.

Voice Prompt uses the official Codex App Server over local stdio. Install the [official Codex CLI](https://developers.openai.com/codex/cli) if it is not present. The native `codex.exe` (Windows) or `codex` (macOS) must be on PATH; restart Voice Prompt after installation. On Windows, the app also detects the Codex executable in the desktop installation under `%LOCALAPPDATA%/OpenAI/Codex/bin`. On macOS, `/opt/homebrew/bin/codex` and `/usr/local/bin/codex` are also checked. The Voice Prompt installer does not bundle or download Codex. An npm `.cmd` shim alone is not a native executable; use the official native CLI distribution on Windows.

The **ChatGPT model** dropdown loads the authenticated account’s model catalog through `model/list`, including all pages. Choose a listed model or Codex default. Refresh connection reloads the catalog; a catalog failure leaves the connected account visible. A saved model missing from the catalog is retained with an unavailable label until you choose a replacement. This value is independent of the API model and URL. Thinking effort support and usage limits depend on the account/model; use Model default when unsure. A ChatGPT login is used only with Codex, never as a bearer token for the configured API URL.

Codex manages OAuth, refresh and credential storage. Voice Prompt requests the OS keyring and uses its own `chatgpt` directory inside the application data directory as `CODEX_HOME`. It does not read or reuse the desktop/CLI's existing login. No tokens cross into the frontend or workspace history. Disconnect signs out this separate connection.

Generation uses an ephemeral Codex conversation in a dedicated working directory, with read-only sandboxing, shell and web search disabled, and no client tool execution. Structured output is converted to the existing final-prompt/clarification contract. Previous clarification answers and prompt profiles remain available. The app waits for successful turn completion before accepting output. Cancel or timeout terminates the owned server process; failed output never replaces the previous prompt. Local speech transcription is unchanged.

Use **Refresh connection** to recheck account state. If the CLI is unavailable or incompatible, the connection panel shows an error and lets you retry. Login can be cancelled and expires after five minutes. Native generation runs time out after ten minutes.

## Validation

Automated frontend tests cover method persistence, preservation of API fields/keys, account login/logout, cancellation and retry. Rust tests cover protocol event ordering, rejection of server tool requests, disconnects, and conversion of structured questions into the existing answer history. The installed Codex CLI was checked with `initialize`, `account/read`, `account/login/start` and `account/login/cancel` using a separate test home, without completing sign-in or making model requests. End-to-end authenticated generation requires the user's browser login and account access.

## OAuth status repair

The observed login logs showed a valid callback, HTTP 200 token exchange and credential save, without a corresponding login-completed notification. A fresh account/read returned a connected ChatGPT account. The previous implementation waited exclusively for that notification and had no persisted-session reconciliation, leaving the UI waiting after browser success. Login now watches completion/account events and checks the persisted account in a fresh server every three seconds (within the existing five-minute timeout); it never returns a disconnected account as a successful login. Returning focus to Settings also refreshes the account and catalog. The fresh server avoids retaining the auth cache created before login.

Regression coverage includes missing completion notifications, delayed account readiness, failed login, paginated/hidden/duplicate models, model selection persistence, catalog retry and focus refresh. Connection controls use a dedicated wrapping layout instead of the profile toolbar’s negative margin.
