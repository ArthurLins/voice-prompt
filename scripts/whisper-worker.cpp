// Voice Prompt's private, persistent Whisper worker.
// Requests: language byte, little-endian PCM byte count, mono 16 kHz i16 PCM.
// Replies: little-endian UTF-8 byte count and text. EOF signals worker failure.
#include "whisper.h"

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#include <shellapi.h>
#pragma comment(lib, "shell32.lib")
#endif

int main(int argc, char ** argv) {
    if (argc == 2 && std::strcmp(argv[1], "--help") == 0) {
        std::puts("Usage: voice-prompt-whisper MODEL THREADS cpu|gpu");
        return 0;
    }
    if (argc != 4) return 1;
    const int threads = std::atoi(argv[2]);
    if (threads < 1 || threads > 8) return 1;
#ifdef _WIN32
    if (_setmode(_fileno(stdin), _O_BINARY) == -1 ||
        _setmode(_fileno(stdout), _O_BINARY) == -1) return 1;
    // Rust passes UTF-16 arguments. Recover the model path without the ANSI code page.
    int wide_argc = 0;
    auto wide_argv = CommandLineToArgvW(GetCommandLineW(), &wide_argc);
    if (!wide_argv || wide_argc != argc) return 1;
    const auto length = WideCharToMultiByte(CP_UTF8, 0, wide_argv[1], -1, nullptr, 0, nullptr, nullptr);
    if (length <= 0) {
        LocalFree(wide_argv);
        return 1;
    }
    std::string model(length, '\0');
    WideCharToMultiByte(CP_UTF8, 0, wide_argv[1], -1, &model[0], length, nullptr, nullptr);
    LocalFree(wide_argv);
#else
    const std::string model = argv[1];
#endif
    auto context_params = whisper_context_default_params();
    context_params.use_gpu = std::strcmp(argv[3], "gpu") == 0;
    std::unique_ptr<whisper_context, decltype(&whisper_free)> context(
        whisper_init_from_file_with_params(model.c_str(), context_params), whisper_free);
    if (!context || std::fwrite("VPW1", 1, 4, stdout) != 4 || std::fflush(stdout) != 0) return 1;

    const char * languages[] = {"pt", "en", "es", "auto"};
    for (;;) {
        const int language = std::fgetc(stdin);
        if (language == EOF) return std::feof(stdin) ? 0 : 1;
        uint32_t size = 0;
        if (language >= 4 || std::fread(&size, sizeof(size), 1, stdin) != 1 ||
            size == 0 || size > 16000 * 2 * 60 || size % 2 != 0) return 1;
        std::vector<int16_t> pcm(size / 2);
        if (std::fread(pcm.data(), 1, size, stdin) != size) return 1;
        std::vector<float> samples(pcm.begin(), pcm.end());
        for (auto & sample : samples) sample /= 32768.0f;

        auto params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
        params.language = languages[language];
        params.detect_language = false;
        params.n_threads = threads;
        params.no_context = true;
        params.no_timestamps = true;
        params.print_progress = false;
        params.print_realtime = false;
        params.print_timestamps = false;
        if (whisper_full(context.get(), params, samples.data(), static_cast<int>(samples.size())) != 0) return 1;
        std::string text;
        for (int i = 0; i < whisper_full_n_segments(context.get()); ++i) {
            text += whisper_full_get_segment_text(context.get(), i);
            if (text.size() > 240000) return 1;
        }
        const auto length = static_cast<uint32_t>(text.size());
        if (std::fwrite(&length, sizeof(length), 1, stdout) != 1 ||
            std::fwrite(text.data(), 1, length, stdout) != length ||
            std::fflush(stdout) != 0) return 1;
    }
}
