use std::path::{Path, PathBuf};

pub fn speech_worker(runtime: &Path, gpu: bool) -> PathBuf {
    if cfg!(windows) {
        runtime.join(if gpu {
            "voice-prompt-whisper-vulkan.exe"
        } else {
            "voice-prompt-whisper.exe"
        })
    } else {
        // The macOS binary embeds Metal; the cpu argument selects its CPU fallback.
        runtime.join("voice-prompt-whisper")
    }
}

pub fn gpu_available(runtime: &Path) -> bool {
    #[cfg(windows)]
    {
        std::env::var_os("SystemRoot")
            .is_some_and(|root| PathBuf::from(root).join("System32/vulkan-1.dll").exists())
            && speech_worker(runtime, true).is_file()
    }
    #[cfg(not(windows))]
    {
        cfg!(target_os = "macos") && speech_worker(runtime, true).is_file()
    }
}

pub fn backend(runtime: &Path) -> &'static str {
    if gpu_available(runtime) {
        if cfg!(target_os = "macos") {
            "Metal / CPU fallback"
        } else {
            "Vulkan / CPU fallback"
        }
    } else {
        "CPU"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_paths_match_packaged_binaries() {
        let dir = Path::new("runtime");
        if cfg!(windows) {
            assert_eq!(
                speech_worker(dir, false),
                dir.join("voice-prompt-whisper.exe")
            );
            assert_eq!(
                speech_worker(dir, true),
                dir.join("voice-prompt-whisper-vulkan.exe")
            );
        } else {
            assert_eq!(speech_worker(dir, false), dir.join("voice-prompt-whisper"));
            assert_eq!(speech_worker(dir, true), speech_worker(dir, false));
        }
    }
}
