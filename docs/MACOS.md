# macOS on Apple Silicon

Targets Apple Silicon (M1 and later), macOS 13+. Intel builds are not provided. New recordings, refinement, copy/open, history, clarification, profiles, model downloads, recovery, and preferences share their implementation with Windows.

- Speech: whisper.cpp v1.9.2, arm64, embedded Metal shaders, Accelerate, CPU fallback (`-ng`), and no Homebrew runtime dependencies. Models are downloaded and verified inside the app.
- Provider keys: macOS Keychain. History, recordings, and models: `~/Library/Application Support/com.voiceprompt.desktop/`.
- Microphone: the first recording requests permission. If denied, enable Voice Prompt in System Settings → Privacy & Security → Microphone.
- Shortcuts: Cmd+Shift+Space starts/finishes recording; Cmd+Enter retries. These remain window shortcuts, not global shortcuts.
- Appearance: native vibrancy on the main capture screen; auxiliary screens remain opaque.

## Local development and packaging

Install Xcode Command Line Tools (`xcode-select --install`), Node.js 22+, stable Rust, and CMake. Run natively on Apple Silicon, not through Rosetta:

```sh
npm ci
npm run setup:macos
npm run desktop
```

The setup script verifies the pinned source archive and licenses, compiles the speech server, checks dynamic dependencies, and applies an ad-hoc signature. Models are excluded from the installer.

```sh
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run package -- --ci --target aarch64-apple-darwin -- --locked
```

Tauri automatically merges `src-tauri/tauri.macos.conf.json`. Output: `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/`. Open the DMG and drag Voice Prompt into Applications before launching.

## GitHub Actions

**Build macOS Apple Silicon** uses a native ARM Mac runner. It runs frontend/Rust tests, transcribes a known sample on CPU, builds the DMG, and verifies bundle signatures, architecture, microphone metadata, and the speech executable. The `Voice-Prompt-macOS-Apple-Silicon` artifact contains the DMG and SHA256 checksum.

It runs on pushes to `codex/macos-support` and supports manual dispatch once on the default branch. It does not publish a GitHub release. Hosted runners cannot validate live microphone capture, native appearance, Keychain prompts, or physical GPU performance.

## Signing

The initial DMG is ad-hoc signed and is not notarized. macOS may require explicit approval in Privacy & Security when opening the downloaded app. For production distribution, configure an Apple Developer ID Application identity (`APPLE_SIGNING_IDENTITY`) and Tauri notarization credentials. Sign the speech executable with the same identity and hardened runtime before packaging. Keep all credentials outside the repository.

Native transparency uses Tauri's macOS private API feature. This build targets direct DMG distribution, not the Mac App Store.

## Manual acceptance on a physical Mac

1. Install, download a model, and accept microphone permission.
2. Save the provider key and verify persistence after restart.
3. Record, generate, refine, copy, and open a prompt.
4. Exercise clarification, cancellation, retry, history, profiles, and both models.
5. Check input-device selection, Command shortcuts, minimize/close, always-on-top, and light/dark appearance.
6. Confirm Metal inference; the same bundled server supports CPU with `-ng`.

References: [Tauri macOS bundles](https://v2.tauri.app/distribute/macos-application-bundle/), [signing](https://v2.tauri.app/distribute/sign/macos/), [whisper.cpp](https://github.com/ggml-org/whisper.cpp).
