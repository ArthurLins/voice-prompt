# Contributing

Voice Prompt targets Windows x64. See the README for prerequisites and local speech setup.

Keep changes focused, preserve existing workspace data and never commit API keys, transcripts, recordings, local workspace files or build artifacts. Use synthetic input in tests. Live integration tests are ignored by default because they use locally stored credentials and may consume provider credit.

Before submitting a pull request, run:

```powershell
npm ci
npm run setup:voice
npm run build
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Describe the problem, resulting behavior and validation. Changes to storage should include migration coverage. Changes to prompt generation should preserve the original input, constraints and selected output profile.

Use Issues for reproducible bugs and focused feature proposals. Remove personal information from screenshots and logs. Report security-sensitive issues according to SECURITY.md.
