use crate::{runtime_dir, AppState};
use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{ipc::Channel, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub struct Model {
    pub id: &'static str,
    pub size: u64,
    pub hash: &'static str,
}
pub const MODELS: [Model; 2] = [
    Model {
        id: "small",
        size: 487601967,
        hash: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    },
    Model {
        id: "large-v3-turbo-q5_0",
        size: 574041195,
        hash: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    },
];
pub fn spec(id: &str) -> Result<&'static Model, String> {
    MODELS
        .iter()
        .find(|m| m.id == id)
        .ok_or("Invalid speech model.".into())
}
pub fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models"))
}
pub fn path(dir: &Path, model: &Model) -> PathBuf {
    dir.join(format!("ggml-{}.bin", model.id))
}
fn verify_digest(size: u64, digest: &str, model: &Model) -> Result<(), String> {
    if size != model.size || digest != model.hash {
        return Err(
            "Model verification failed (SHA-256). The file was not installed. Please retry.".into(),
        );
    }
    Ok(())
}
pub async fn verify(file: &Path, model: &Model) -> Result<(), String> {
    let mut file = tokio::fs::File::open(file)
        .await
        .map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut size = 0;
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        let n = file.read(&mut buffer).await.map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        size += n as u64;
        if size > model.size {
            return Err("Invalid model size.".into());
        }
        hash.update(&buffer[..n]);
    }
    verify_digest(size, &format!("{:x}", hash.finalize()), model)
}
pub async fn installed(dir: &Path) -> Vec<&'static str> {
    let mut result = Vec::new();
    for model in &MODELS {
        if verify(&path(dir, model), model).await.is_ok() {
            result.push(model.id);
        }
    }
    result
}
pub async fn migrate(app: &tauri::AppHandle, dir: &Path) -> Result<(), String> {
    tokio::fs::create_dir_all(dir)
        .await
        .map_err(|e| e.to_string())?;
    let marker = dir.join(".migrated");
    if marker.exists() {
        return Ok(());
    }
    for model in &MODELS {
        let old = path(&runtime_dir(app)?, model);
        let target = path(dir, model);
        if !target.exists() && verify(&old, model).await.is_ok() {
            let partial = target.with_extension("partial");
            tokio::fs::copy(old, &partial)
                .await
                .map_err(|e| e.to_string())?;
            verify(&partial, model).await?;
            tokio::fs::rename(partial, target)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    tokio::fs::write(marker, b"1")
        .await
        .map_err(|e| e.to_string())
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub phase: &'static str,
}

#[tauri::command]
pub async fn download_model(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    model: String,
    channel: Channel<DownloadProgress>,
) -> Result<(), String> {
    let _guard = state
        .model_operations
        .try_lock()
        .map_err(|_| "Another model operation is in progress.")?;
    let model = spec(&model)?;
    let dir = directory(&app)?;
    let result = download_to(&dir, model, |progress| {
        let _ = channel.send(progress);
    })
    .await;
    let _ = app.emit("models-changed", ());
    result
}
async fn download_to(
    dir: &Path,
    model: &Model,
    report: impl Fn(DownloadProgress),
) -> Result<(), String> {
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;
    let target = path(&dir, model);
    if verify(&target, model).await.is_ok() {
        return Ok(());
    }
    let partial = target.with_extension("partial");
    let result = async {
        // Only this fixed catalog can choose the URL or expected digest. No remote manifest is trusted.
        let url = format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin",
            model.id
        );
        let client = reqwest::Client::builder()
            .https_only(true)
            .connect_timeout(Duration::from_secs(30))
            .read_timeout(Duration::from_secs(60))
            .timeout(Duration::from_secs(7200))
            .build()
            .map_err(|e| e.to_string())?;
        let response = client
            .get(url)
            .send()
            .await
            .map_err(|_| "Could not download the model. Check your connection and retry.")?
            .error_for_status()
            .map_err(|_| "The model server is unavailable. Please retry.")?;
        if response.content_length().is_some_and(|n| n != model.size) {
            return Err("Unexpected model size.".to_string());
        }
        let mut file = tokio::fs::File::create(&partial)
            .await
            .map_err(|e| e.to_string())?;
        let mut stream = response.bytes_stream();
        let mut size = 0u64;
        let mut hash = Sha256::new();
        let mut last = std::time::Instant::now();
        report(DownloadProgress {
            downloaded: 0,
            total: model.size,
            phase: "downloading",
        });
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "Download interrupted. Please retry.")?;
            size += chunk.len() as u64;
            if size > model.size {
                return Err("Unexpected model size.".into());
            }
            file.write_all(&chunk).await.map_err(|e| e.to_string())?;
            hash.update(&chunk);
            if last.elapsed() >= Duration::from_millis(150) {
                report(DownloadProgress {
                    downloaded: size,
                    total: model.size,
                    phase: "downloading",
                });
                last = std::time::Instant::now();
            }
        }
        report(DownloadProgress {
            downloaded: size,
            total: model.size,
            phase: "verifying",
        });
        verify_digest(size, &format!("{:x}", hash.finalize()), model)?;
        file.sync_all().await.map_err(|e| e.to_string())?;
        drop(file);
        // Re-read the actual saved bytes before making this model available.
        verify(&partial, model).await?;
        tokio::fs::rename(&partial, &target)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&partial).await;
    }
    result
}
fn can_delete(installed: &[&str], id: &str) -> Result<(), String> {
    if !installed.contains(&id) {
        return Err("Model is not installed.".into());
    }
    if installed.len() < 2 {
        return Err("Keep at least one installed model.".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn delete_model(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    model: String,
) -> Result<(), String> {
    let _guard = state
        .model_operations
        .try_lock()
        .map_err(|_| "Another model operation is in progress.")?;
    let model = spec(&model)?;
    let dir = directory(&app)?;
    can_delete(&installed(&dir).await, model.id)?;
    let mut engine = state.engine.lock().await;
    // Hold the jobs mutex through removal so a transcription cannot start between the check and deletion.
    let jobs = state.jobs.lock().map_err(|e| e.to_string())?;
    if !jobs.is_empty() {
        return Err("Finish the current request before deleting a model.".into());
    }
    if engine
        .as_ref()
        .is_some_and(|e| e.model == format!("ggml-{}.bin", model.id))
    {
        *engine = None;
    }
    std::fs::remove_file(path(&dir, model)).map_err(|e| e.to_string())?;
    let _ = app.emit("models-changed", ());
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_untrusted_ids_and_last_model_deletion() {
        assert!(spec("../../evil").is_err());
        assert!(can_delete(&["small"], "small").is_err());
        assert!(can_delete(&["small"], "large-v3-turbo-q5_0").is_err());
        assert!(can_delete(&["small", "large-v3-turbo-q5_0"], "small").is_ok());
    }
    #[tokio::test]
    #[ignore = "Downloads the real 488 MB small model from Hugging Face; no API key"]
    async fn download_official_small() {
        let dir = std::env::temp_dir().join(format!(
            "voice-prompt-download-test-{}",
            uuid::Uuid::new_v4()
        ));
        let model = &MODELS[0];
        let result = download_to(&dir, model, |_| {}).await;
        if result.is_ok() {
            assert!(verify(&path(&dir, model), model).await.is_ok());
            assert!(!path(&dir, model).with_extension("partial").exists());
            tokio::fs::remove_file(path(&dir, model)).await.unwrap();
        }
        let _ = tokio::fs::remove_dir(&dir).await;
        result.unwrap();
    }
    #[tokio::test]
    async fn rejects_corruption_and_truncation() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let file = dir.join("test.bin");
        let model = Model {
            id: "test",
            size: 3,
            hash: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        };
        tokio::fs::write(&file, b"abc").await.unwrap();
        assert!(verify(&file, &model).await.is_ok());
        tokio::fs::write(&file, b"abd").await.unwrap();
        assert!(verify(&file, &model).await.is_err());
        tokio::fs::write(&file, b"ab").await.unwrap();
        assert!(verify(&file, &model).await.is_err());
        tokio::fs::write(&file, b"abcd").await.unwrap();
        assert!(verify(&file, &model).await.is_err());
        tokio::fs::remove_file(file).await.unwrap();
        tokio::fs::remove_dir(dir).await.unwrap();
    }
}
