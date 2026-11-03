#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo 'Run this script natively on an Apple Silicon Mac (not under Rosetta).' >&2
  exit 1
fi
root="$(cd "$(dirname "$0")/.." && pwd)"
runtime="$root/src-tauri/runtime"
work="$(mktemp -d "${TMPDIR:-/tmp}/voice-prompt-macos.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
mkdir -p "$runtime" "$root/test-results"

download() {
  curl --fail --location --retry 3 --silent --show-error "$1" -o "$2"
  printf '%s  %s\n' "$3" "$2" | shasum -a 256 -c -
}

# Same verified whisper.cpp revision as the Windows Vulkan runtime.
commit=60c0be6ac8fa71b1a2ae2dd938a31a34a508e774
download "https://github.com/ggml-org/whisper.cpp/archive/$commit.zip" "$work/source.zip" \
  67a50b1aa5514745bcbbe49a94c1a554269fd85b8ec5cfda4137f5680513041c
ditto -x -k "$work/source.zip" "$work"
source_dir="$work/whisper.cpp-$commit"
cp "$root/scripts/whisper-worker.cpp" "$source_dir/examples/server/server.cpp"
cmake -S "$source_dir" -B "$work/build" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 \
  -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_ACCELERATE=ON \
  -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DBUILD_SHARED_LIBS=OFF \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_CURL=OFF
cmake --build "$work/build" --target whisper-server --parallel "$(sysctl -n hw.ncpu)"
install -m 755 "$work/build/bin/whisper-server" "$runtime/voice-prompt-whisper"
cp "$source_dir/LICENSE" "$runtime/LICENSE-whisper.cpp"
download 'https://raw.githubusercontent.com/openai/whisper/main/LICENSE' "$runtime/LICENSE-whisper" \
  b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d
cp "$source_dir/samples/jfk.wav" "$root/test-results/jfk.wav"

# Do not ship dependencies on Homebrew or the temporary build directory.
otool -L "$runtime/voice-prompt-whisper"
if otool -L "$runtime/voice-prompt-whisper" | tail -n +2 | awk '{print $1}' | grep -Ev '^(/usr/lib/|/System/Library/)' ; then
  echo 'Unexpected non-system dynamic dependency in speech runtime.' >&2
  exit 1
fi
codesign --force --sign - "$runtime/voice-prompt-whisper"
codesign --verify --strict "$runtime/voice-prompt-whisper"
"$runtime/voice-prompt-whisper" --help
echo 'Apple Silicon speech runtime ready (Metal with CPU fallback).'
