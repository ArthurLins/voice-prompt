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
commit=306c88f4d1286aec1bf96e544632897886af5501
download "https://github.com/ggml-org/whisper.cpp/archive/$commit.zip" "$work/source.zip" \
  0f4b46f1ae9e26666139bfc15b61a3e77b43809da89e0072969144801c05db36
ditto -x -k "$work/source.zip" "$work"
source_dir="$work/whisper.cpp-$commit"
cmake -S "$source_dir" -B "$work/build" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 \
  -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_ACCELERATE=ON \
  -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DBUILD_SHARED_LIBS=OFF \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_CURL=OFF
cmake --build "$work/build" --target whisper-server --parallel "$(sysctl -n hw.ncpu)"
install -m 755 "$work/build/bin/whisper-server" "$runtime/whisper-server"
cp "$source_dir/LICENSE" "$runtime/LICENSE-whisper.cpp"
download 'https://raw.githubusercontent.com/openai/whisper/main/LICENSE' "$runtime/LICENSE-whisper" \
  b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d
cp "$source_dir/samples/jfk.wav" "$root/test-results/jfk.wav"

# Do not ship dependencies on Homebrew or the temporary build directory.
otool -L "$runtime/whisper-server"
if otool -L "$runtime/whisper-server" | tail -n +2 | awk '{print $1}' | grep -Ev '^(/usr/lib/|/System/Library/)' ; then
  echo 'Unexpected non-system dynamic dependency in speech runtime.' >&2
  exit 1
fi
codesign --force --sign - "$runtime/whisper-server"
codesign --verify --strict "$runtime/whisper-server"
"$runtime/whisper-server" --help
echo 'Apple Silicon speech runtime ready (Metal with CPU fallback).'
