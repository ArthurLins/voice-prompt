use std::path::{Path, PathBuf};

pub fn speech_server(runtime: &Path, gpu: bool) -> PathBuf {
    if cfg!(windows) {
        runtime.join(if gpu {
            "vulkan/whisper-server.exe"
        } else {
            "whisper-server.exe"
        })
    } else {
        // The macOS binary embeds Metal; -ng selects its CPU fallback.
        runtime.join("whisper-server")
    }
}

pub fn gpu_available(runtime: &Path) -> bool {
    #[cfg(windows)]
    {
        std::env::var_os("SystemRoot")
            .is_some_and(|root| PathBuf::from(root).join("System32/vulkan-1.dll").exists())
            && speech_server(runtime, true).is_file()
    }
    #[cfg(not(windows))]
    {
        cfg!(target_os = "macos") && speech_server(runtime, true).is_file()
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
            assert_eq!(speech_server(dir, false), dir.join("whisper-server.exe"));
            assert_eq!(
                speech_server(dir, true),
                dir.join("vulkan/whisper-server.exe")
            );
        } else {
            assert_eq!(speech_server(dir, false), dir.join("whisper-server"));
            assert_eq!(speech_server(dir, true), speech_server(dir, false));
        }
    }
}
