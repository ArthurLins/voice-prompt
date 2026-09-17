# Voice Prompt

A compact Windows assistant built with Tauri 2, Rust and React. Record a request, transcribe it locally, refine it with the configured OpenRouter model, and copy the final prompt.

## Version 0.7.1

- The main window stays visible and always on top while the app is open. Minimize and unpin actions are removed from the main window. Close explicitly exits the app; switching to another application does not steal keyboard focus back.
- **Copy**, beside **Open prompt**, copies the completed prompt as raw Markdown without opening the document window. **Open prompt** retains the separate rendered Markdown view.
- Optional clarification uses a separate, always-on-top **Questions** window. The main window remains available. Answers can be free text or choices, including multiple questions together. After each submission the model processes the answers and asks further questions only when necessary.
- App-owned interface text, status/error messages, default profile descriptions, system instructions and installer UI are English. New clarification questions and alternatives are requested in English.
- Portuguese speech and typed answers reach processing in their original language. There is no preliminary translation step. The selected output profile still controls the final prompt language; the Code profile remains English and assertive.
- Existing conversations, identifiers, model/provider settings, custom rules and output profiles are preserved. Only untouched built-in Portuguese defaults are migrated to equivalent English text.

## Run

To publish an installer ZIP, run **Actions → Release Windows → Run workflow** on `main`. The workflow tests, builds and publishes the version declared in the project. Download the ZIP from Releases, extract it, and run the installer inside. See [RELEASING.md](docs/RELEASING.md) for version updates, artifacts and failure recovery.

After a local release build, the installer is written to `src-tauri/target/release/bundle/nsis/Voice Prompt_0.7.1_x64-setup.exe`. Binaries and speech models are not included in the Git repository.
Executable: `src-tauri/target/release/voice-prompt.exe`.

Close any older instance before opening the new version: they share history and credentials. The standalone executable requires its `runtime` folder beside it. The installer includes the available local speech models.

## Use

The large recording button starts a **new prompt** immediately. The smaller pencil button refines the current completed prompt. Discarding a recording preserves the existing result. **Ctrl+Shift+Space** starts a new recording or finishes the current recording; **Ctrl+Enter** retries a failed generation.

Enable **Settings → Prompts → Clarify uncertainties before generating** to use questions. It is off by default. Answer in Portuguese or another supported language, select an option, or leave unavailable information blank. **Continue** submits the available answers together. A final result is accepted only when the model completes the prompt. The input, previous prompt and settings for that request stay attached to it throughout all rounds.

Closing the Questions window does not discard the request; **Open questions** brings it back. **Discard questions** ends clarification and preserves the last completed prompt. Pending questions and answers are saved with the workspace and resume after restarting. Error recovery retains the answers.

Settings remain in a separate window with custom scrolling. History remains in the main window and deletes the selected conversation directly. Profiles, output language, tone and editor rules remain editable in Settings → Prompts. Settings → Audio selects the microphone, transcription language and local model. Settings → Connection configures the API URL, model and key.

## Processing and storage

- Speech uses bundled whisper.cpp v1.9.2 on CPU, with `small` and optional `large-v3-turbo-q5_0`. No NVIDIA SDK, CUDA Toolkit or GPU dependency. DirectML/GPU execution is not implemented.
- Audio stays local. A resident process handles WAV PCM mono, 16 kHz, 16-bit audio over loopback with a dynamic port and random route. Readiness uses `/health`. Recordings are limited to five minutes.
- The original transcript, relevant previous prompt and clarification answers are sent to the configured API. The default remains OpenRouter and `openai/gpt-5.6-luna`. There is no preliminary translation API call, telemetry or web research during generation.
- History, pending answers and preferences are stored without encryption in `%APPDATA%\com.voiceprompt.desktop\workspace.json`. API keys stay separately in Windows Credential Manager. Recorded audio is not deliberately saved in history.
- Failed or incomplete generation does not replace a completed prompt. The transcript and pending answers are preserved; incomplete generated text is not presented as final.
- The standard flow uses streaming. Optional tool-calling clarification uses asynchronous non-streaming responses. Cancelling stops local waiting, but the provider may still complete and charge for a non-streaming request.

## Validation

25 frontend tests and 13 Rust tests passed, covering copy, mandatory topmost state, separate question-window messaging, repeated rounds, Portuguese answers, stale events, error recovery and migration of built-in defaults without changing custom instructions. The existing live OpenRouter/Luna test passed with synthetic Portuguese input, two clarification questions and a final prompt after answers.

Visual previews were checked at 360 × 400 (main), 420 × 520 (questions) and 480 × 680 (settings). Native topmost ordering, multi-monitor placement and a physical microphone were not visually exercised in this change. Normal Windows topmost behavior cannot override secure desktop or lock-screen surfaces. The model's decision to ask questions is still probabilistic.

See [the API review](docs/API_REVIEW.md) for protocol details and the previous verification evidence. The 0.7.0 window/language behavior described here supersedes its 0.6.0 interface description.

## Development

Build requirements: Windows x64, Node.js 22 or later, stable Rust with MSVC, Visual Studio Build Tools with C++/Windows SDK, and WebView2. Using the packaged app does not require Node or Rust.

```powershell
git clone https://github.com/ArthurLins/voice-prompt.git
cd voice-prompt
npm ci
npm run setup:voice
# Optional higher-accuracy model
npm run setup:voice -- -Model large-v3-turbo-q5_0
npm run desktop
```

The speech setup script downloads official binaries, licenses and models with SHA256 verification. Close the app before running it. Install `small` even when adding the larger model.

```powershell
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run package
```

`npm run dev` provides an interface preview only. Full local speech and AI integration run in the desktop app. Runtime models and build artifacts are ignored; lockfiles should be versioned.

Optional live integration test (requires the existing saved key and may consume balance):

```powershell
cargo test --manifest-path src-tauri/Cargo.toml live_clarification -- --ignored --nocapture
```

## Project information

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Local API keys, recordings, workspace data, test results and generated files are excluded from version control. The npm package stays private to prevent accidental npm publication; this does not affect GitHub visibility.

## License

[MIT](LICENSE), copyright © 2026 Arthur Lins. Third-party components retain their own licenses.
