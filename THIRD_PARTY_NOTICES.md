# Third-party components

Dependencies retain their own licenses. The npm and Cargo lockfiles identify the versions used; consult the license files distributed with each dependency.

Local speech setup downloads these components separately; their binaries and models are not stored in this Git repository:

- **whisper.cpp**: https://github.com/ggml-org/whisper.cpp — MIT. The setup script downloads the license for the pinned runtime version and verifies its SHA256.
- **OpenAI Whisper**: https://github.com/openai/whisper — MIT. The setup script downloads and verifies the Whisper license alongside the model files.
- Converted model files are downloaded from https://huggingface.co/ggerganov/whisper.cpp and checked against the hashes in `scripts/setup-voice.ps1`.

The Vulkan server is statically built from the pinned whisper.cpp v1.9.2 source (including ggml) under the same MIT license. The LunarG Vulkan SDK is build tooling only and is not bundled with the application. Its installer is SHA256-verified using the value published in https://vulkan.lunarg.com/sdk/files.json. The graphics driver supplies the Vulkan loader at runtime.

Packaged desktop builds include the downloaded speech licenses through the Tauri `runtime/LICENSE*` resource configuration. Keep these notices with redistributed speech components.

OpenRouter and other configured API providers are external services with their own terms and charges; publishing this source code does not include API access or credit.
