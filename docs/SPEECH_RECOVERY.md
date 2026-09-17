# Long recordings, recovery and Vulkan

## Recording and retries

The recorder accepts up to 30 minutes, automatically finishes at that limit, and sends mono PCM16 at 16 kHz. Audio stays local. Once recording finishes, the application writes a UUID-named WAV under `%APPDATA%\com.voiceprompt.desktop\recordings`, then persists a recovery pointer and the original refinement context before starting transcription. If that disk write fails, a retry can reuse the captured audio in memory while the app remains open.

Whisper receives ordered chunks of at most 60 seconds. Boundaries prefer the lowest-energy 20 ms interval in the last 15 seconds of each chunk. No audio samples are dropped or duplicated. Each completed chunk, including empty text for silence, is checkpointed with the model and language. Changing those settings invalidates the checkpoint. A failed or cancelled transcription keeps the WAV and checkpoints; **Try again** resumes incomplete parts. Completed parts are not sent to the LLM individually: the full joined transcript is sent together to preserve the request's overall context.

If generation fails, retry uses the transcript without repeating transcription. It keeps the original completed prompt as refinement context, rather than using a partial result or an older dictation. Clarification answers continue through the existing tool-calling flow. Recovery pointers survive restart and selecting the item in History. A new prompt remains an independent conversation. Another refinement of the same item is disabled while it has an unfinished recovery request.

The generated result is committed only on success. After the updated workspace is saved, its recovery WAV/checkpoint is deleted. Deleting the history item or discarding questions also schedules cleanup. A crash in the narrow interval between saving the completed workspace and deleting its files can leave an orphan recovery file; there is no background retention cleanup.

## GPU and CPU

The existing whisper.cpp v1.9.2 models are retained. DirectML is not a backend of this runtime; Vulkan was selected instead. The application checks for the Vulkan loader and its separately bundled `runtime/vulkan/whisper-server.exe`. It tries this backend first, using the GPU selected by Whisper. If startup fails, the original CPU server is started automatically. After a GPU inference failure, the recording remains retryable and the next attempt uses CPU. That fallback is retained until the app restarts. A Vulkan server may also choose CPU internally if no suitable device is available.

The Vulkan executable lives in a separate directory to avoid loading the CPU distribution's dynamic ggml plugins into its statically linked ggml runtime. Model files are shared via absolute paths, not duplicated. Users need a compatible graphics driver, but no CUDA, NVIDIA SDK or Vulkan SDK.

`npm run setup:vulkan` builds the extra backend using CMake/MSVC. The release workflow runs the same script. It pins whisper.cpp source commit `306c88f4d1286aec1bf96e544632897886af5501` and LunarG SDK `1.4.357.0`, verifies download SHA256 hashes, and uses the SDK's documented `copy_only=1` extraction mode. Tooling lives in a short temporary directory to avoid MSVC path-length failures. The SDK is not packaged. A preconfigured `VULKAN_SDK` with `glslc` can also be used for development.

## Bounds and validation

- Each local chunk has a 10-minute request deadline. A failed connection resets the resident process, preventing retry from waiting behind a stale inference. The API request deadline is also 10 minutes.
- Dictation and previous prompt each accept up to 240,000 UTF-8 bytes, without silently truncating them. The provider's actual context/output limits still apply. The existing clarification-history limit is 200 KB and workspace storage limit is 20 MB. There is no claim of unlimited conversation length.
- Active capture remains buffered in memory. A process crash or forced exit before finishing the recording can lose it. Long captures require more RAM. Finishing after microphone disconnection or a missing worklet acknowledgement salvages frames already received.
- Pause-based boundaries reduce mid-word cuts but cannot guarantee transcription accuracy. No semantic summarization or automatic translation is applied before prompt generation.
- Automated checks: 27 frontend tests; 17 Rust tests, including lossless ordering of a 601-second WAV, duration/header validation, checkpoint restart/settings invalidation, restored retry state and long-text preservation. Live API tests are not required or run for these changes.
- Local hardware validation: the large-v3-turbo-q5_0 model used Vulkan0 on an NVIDIA RTX 3080 Ti. A synthetic 240-second Portuguese recording completed, and the actual engine-selection test passed both Vulkan startup and the CPU fallback state. AMD/Intel hardware, driver absence and GPU out-of-memory were not physically exercised. Synthetic repeated speech is a reliability check, not a transcription-accuracy benchmark.

Useful local checks:

```powershell
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml tests::local_vulkan_and_cpu_fallback -- --ignored --exact
python scripts/smoke-voice.py path.wav pt --gpu --model large-v3-turbo-q5_0
```

Sources: [Whisper Vulkan support](https://github.com/ggml-org/whisper.cpp/tree/v1.9.2#vulkan-gpu-support), [LunarG unattended/copy-only installation](https://vulkan.lunarg.com/doc/view/latest/windows/getting_started.html), [official SDK hashes](https://vulkan.lunarg.com/sdk/files.json).
