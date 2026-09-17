#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine as _;
use eventsource_stream::Eventsource;
mod clarification;
mod models;
mod platform;
mod prompts;
mod recordings;
mod streaming;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};
use tauri::{ipc::Channel, Emitter, Manager, State};
use tokio_util::sync::CancellationToken;

struct Engine {
    child: Child,
    url: String,
    model: String,
    gpu: bool,
}
impl Drop for Engine {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
#[derive(Default)]
struct AppState {
    engine: tokio::sync::Mutex<Option<Engine>>,
    model_operations: tokio::sync::Mutex<()>,
    gpu_failed: std::sync::atomic::AtomicBool,
    jobs: Mutex<HashMap<String, CancellationToken>>,
    storage: Mutex<()>,
    document: Mutex<String>,
    settings_snapshot: Mutex<Value>,
    history_snapshot: Mutex<Value>,
    questions_snapshot: Mutex<Value>,
}
#[derive(Deserialize, Serialize, Clone, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
enum ThinkingEffort {
    #[default]
    Default,
    None,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}
fn apply_thinking_effort(payload: &mut Value, base: &str, effort: &ThinkingEffort) {
    if *effort == ThinkingEffort::Default {
        return;
    }
    let openrouter = reqwest::Url::parse(base)
        .ok()
        .is_some_and(|url| url.host_str() == Some("openrouter.ai"));
    if openrouter {
        payload["reasoning"] = json!({"effort": effort});
    } else {
        payload["reasoning_effort"] = json!(effort);
    }
}
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Settings {
    base_url: String,
    model: String,
    #[serde(default)]
    thinking_effort: ThinkingEffort,
    style: String,
    language: String,
    voice_model: String,
    #[serde(default)]
    ask_questions: bool,
    #[serde(default = "prompts::default_mode")]
    prompt_type: String,
    #[serde(default = "prompts::default_instructions")]
    editor_instructions: String,
    #[serde(default = "prompts::default_profiles")]
    prompt_profiles: Vec<prompts::Profile>,
}
#[derive(Serialize, Clone)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
enum Progress {
    Phase(String),
    Transcript(String),
    Delta(String),
}

fn api_url(base: &str, suffix: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(base.trim()).map_err(|_| "Invalid API URL.")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("Use HTTPS or HTTP on localhost.".into());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("The URL must not contain credentials, query parameters or fragments.".into());
    }
    Ok(format!("{}/{}", url.as_str().trim_end_matches('/'), suffix))
}
fn credential(base: &str) -> Result<keyring::Entry, String> {
    let normalized = api_url(base, "")?;
    keyring::Entry::new("VoicePrompt", &normalized)
        .map_err(|_| "Could not access the system credential store.".into())
}
#[tauri::command]
fn save_key(base_url: String, key: String) -> Result<(), String> {
    let entry = credential(&base_url)?;
    if key.trim().is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("Could not remove the key.".into()),
        }
    } else {
        entry
            .set_password(key.trim())
            .map_err(|_| "Could not save the key in the system credential store.".into())
    }
}
#[tauri::command]
fn has_key(base_url: String) -> Result<bool, String> {
    match credential(&base_url)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(_) => Err("Could not read the system credential store.".into()),
    }
}
fn data_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("workspace.json"))
}
#[tauri::command]
fn load_workspace(app: tauri::AppHandle, state: State<AppState>) -> Result<Value, String> {
    let _guard = state.storage.lock().map_err(|e| e.to_string())?;
    let path = data_file(&app)?;
    if !path.exists() {
        return Ok(Value::Null);
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes)
        .map_err(|_| "Invalid history. The original file was preserved.".into())
}
#[tauri::command]
fn save_workspace(
    app: tauri::AppHandle,
    state: State<AppState>,
    data: Value,
) -> Result<(), String> {
    let _guard = state.storage.lock().map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec(&data).map_err(|e| e.to_string())?;
    if bytes.len() > 20_000_000 {
        return Err(
            "History exceeds the 20 MB limit. Export and remove older conversations.".into(),
        );
    }
    let path = data_file(&app)?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(tmp, path).map_err(|e| e.to_string())
}
fn runtime_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("runtime"));
    }
    Ok(app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("runtime"))
}
#[tauri::command]
async fn voice_status(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    let _guard = state.model_operations.lock().await;
    let dir = models::directory(&app)?;
    models::migrate(&app, &dir).await?;
    let installed = models::installed(&dir).await;
    let runtime = runtime_dir(&app)?;
    Ok(
        json!({"ready": platform::speech_server(&runtime, false).is_file() && !installed.is_empty(),
        "model": installed.first(), "models": installed,
        "backend": platform::backend(&runtime)}),
    )
}
async fn ensure_engine(
    app: &tauri::AppHandle,
    state: &AppState,
    selected: &str,
) -> Result<String, String> {
    let spec = models::spec(selected)?;
    {
        let mut engine = state.engine.lock().await;
        if let Some(engine) = engine.as_mut() {
            if engine.model == format!("ggml-{selected}.bin")
                && engine
                    .child
                    .try_wait()
                    .map_err(|e| e.to_string())?
                    .is_none()
            {
                return Ok(engine.url.clone());
            }
        }
    }
    let path = models::path(&models::directory(app)?, spec);
    models::verify(&path, spec)
        .await
        .map_err(|_| "Model unavailable or corrupted. Download it in Settings / Audio.")?;
    ensure_engine_at(&runtime_dir(app)?, &path, state, selected).await
}
async fn ensure_engine_at(
    dir: &std::path::Path,
    model_path: &std::path::Path,
    state: &AppState,
    selected: &str,
) -> Result<String, String> {
    if !matches!(selected, "small" | "large-v3-turbo-q5_0") {
        return Err("Invalid speech model.".into());
    }
    let model = format!("ggml-{selected}.bin");
    let mut guard = state.engine.lock().await;
    if let Some(engine) = guard.as_mut() {
        if engine.model == model
            && engine
                .child
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_none()
        {
            return Ok(engine.url.clone());
        }
    }
    *guard = None;
    if !model_path.exists() {
        return Err(format!(
            "Model {selected} is not installed. Download it in Settings / Audio."
        ));
    }
    if platform::gpu_available(dir) && !state.gpu_failed.load(std::sync::atomic::Ordering::Relaxed)
    {
        match start_engine(&dir, model_path, &model, true).await {
            Ok(engine) => {
                let url = engine.url.clone();
                *guard = Some(engine);
                return Ok(url);
            }
            Err(_) => state
                .gpu_failed
                .store(true, std::sync::atomic::Ordering::Relaxed),
        }
    }
    let engine = start_engine(&dir, model_path, &model, false).await?;
    let url = engine.url.clone();
    *guard = Some(engine);
    Ok(url)
}
async fn start_engine(
    dir: &std::path::Path,
    model_path: &std::path::Path,
    model: &str,
    gpu: bool,
) -> Result<Engine, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener);
    let route = format!("/{}", uuid::Uuid::new_v4().simple());
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().saturating_sub(2).clamp(1, 8))
        .unwrap_or(4);
    let server = platform::speech_server(dir, gpu);
    let mut cmd = Command::new(&server);
    cmd.current_dir(server.parent().unwrap_or(dir))
        .args([
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "--request-path",
            &route,
            "-m",
            &model_path.to_string_lossy(),
            "-t",
            &threads.to_string(),
            "-nt",
            "-l",
            "pt",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if !gpu {
        cmd.arg("-ng");
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("Could not start local Whisper: {e}"))?;
    let mut engine = Engine {
        child,
        url: format!("http://127.0.0.1:{port}{route}"),
        model: model.to_owned(),
        gpu,
    };
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(1))
        .build()
        .map_err(|e| e.to_string())?;
    for _ in 0..180 {
        if engine
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_some()
        {
            return Err(
                "Whisper exited while loading. Check available memory and reinstall local speech."
                    .into(),
            );
        }
        if client
            .get(format!("{}/health", engine.url))
            .send()
            .await
            .is_ok_and(|r| r.status().is_success())
        {
            return Ok(engine);
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    Err("The model took too long to load.".into())
}
#[tauri::command]
async fn warm_voice(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    model: String,
) -> Result<(), String> {
    ensure_engine(&app, &state, &model).await.map(|_| ())
}
#[tauri::command]
fn cancel_request(id: String, state: State<AppState>) -> Result<(), String> {
    let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
    jobs.entry(id).or_default().cancel();
    Ok(())
}
fn validate_wav(bytes: &[u8]) -> Result<(), String> {
    recordings::validate(bytes)
}
fn recording_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = data_file(app)?.with_file_name("recordings");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}
#[tauri::command]
fn save_recording(app: tauri::AppHandle, id: String, audio: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio)
        .map_err(|_| "Invalid audio.")?;
    validate_wav(&bytes)?;
    let path = recordings::path(&recording_dir(&app)?, &id)?;
    let tmp = path.with_extension("partial");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(tmp, path).map_err(|e| e.to_string())
}
#[tauri::command]
fn delete_recording(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = recordings::path(&recording_dir(&app)?, &id)?;
    for file in [path.clone(), path.with_extension("json")] {
        match std::fs::remove_file(file) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}
fn completion_payload(model: &str, ask_questions: bool, messages: Value) -> Value {
    let mut payload = json!({"model":model,"stream":!ask_questions,"messages":messages});
    if ask_questions {
        payload["tools"] = json!([clarification::tool()]);
        payload["tool_choice"] = json!("auto");
        payload["parallel_tool_calls"] = json!(false);
    }
    payload
}
async fn process(
    app: &tauri::AppHandle,
    state: &AppState,
    audio: Option<String>,
    audio_id: Option<String>,
    text: String,
    previous: String,
    settings: Settings,
    channel: Channel<Progress>,
    transcribe_only: bool,
    clarification_turns: Option<Vec<clarification::AnsweredTurn>>,
) -> Result<Value, String> {
    if !matches!(settings.language.as_str(), "pt" | "en" | "es" | "auto") {
        return Err("Invalid language.".into());
    }
    let transcript = if audio.is_some() || audio_id.is_some() {
        let cache_path = audio_id
            .as_ref()
            .map(|id| recordings::path(&recording_dir(app)?, id).map(|p| p.with_extension("json")))
            .transpose()?;
        let bytes = if let Some(id) = &audio_id {
            std::fs::read(recordings::path(&recording_dir(app)?, id)?)
                .map_err(|_| "Could not read the saved recording. Check local storage.")?
        } else {
            base64::engine::general_purpose::STANDARD
                .decode(audio.unwrap())
                .map_err(|_| "Invalid audio.")?
        };
        let chunks = recordings::chunks(&bytes)?;
        let mut done = cache_path
            .as_ref()
            .map(|p| {
                recordings::load_checkpoint(
                    p,
                    &settings.voice_model,
                    &settings.language,
                    chunks.len(),
                )
            })
            .unwrap_or_default();
        let client = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(600))
            .build()
            .map_err(|e| e.to_string())?;
        for chunk in chunks.iter().skip(done.len()) {
            let url = ensure_engine(app, state, &settings.voice_model).await?;
            let _ = channel.send(Progress::Phase(format!(
                "Transcribing part {} of {}…",
                done.len() + 1,
                chunks.len()
            )));
            let part = reqwest::multipart::Part::bytes(chunk.clone())
                .file_name("recording.wav")
                .mime_str("audio/wav")
                .map_err(|e| e.to_string())?;
            let form = reqwest::multipart::Form::new()
                .part("file", part)
                .text("response_format", "json")
                .text("language", settings.language.clone())
                .text("temperature", "0.0");
            let response = client
                .post(format!("{url}/inference"))
                .multipart(form)
                .send()
                .await;
            let response = match response {
                Ok(r) if r.status().is_success() => r,
                other => {
                    let mut engine = state.engine.lock().await;
                    if engine.as_ref().is_some_and(|e| e.gpu) {
                        state
                            .gpu_failed
                            .store(true, std::sync::atomic::Ordering::Relaxed);
                    }
                    *engine = None;
                    let reason = match other {
                        Ok(r) => format!("HTTP {}", r.status()),
                        Err(_) => "connection failure or timeout".into(),
                    };
                    return Err(format!("Local transcription stopped ({reason}). Your recording and completed parts are saved. Click Try again."));
                }
            };
            let value: Value = response
                .json()
                .await
                .map_err(|_| "Invalid local response. Your recording is saved; click Try again.")?;
            let text = value["text"]
                .as_str()
                .ok_or("Local response has no transcript. Click Try again.")?
                .trim()
                .to_owned();
            done.push(text);
            if let Some(path) = &cache_path {
                recordings::save_checkpoint(
                    path,
                    &settings.voice_model,
                    &settings.language,
                    &done,
                )?;
            }
        }
        done.join("\n")
    } else {
        text.trim().to_owned()
    };
    if transcript.is_empty() {
        return Err("No speech detected. Check the microphone and try again.".into());
    }
    let _ = channel.send(Progress::Transcript(transcript.clone()));
    if transcribe_only {
        return Ok(json!(transcript));
    }
    if transcript.len() > 240_000 || previous.len() > 240_000 {
        return Err(
            "Text too long; limit of 240,000 bytes per field. Your input was preserved.".into(),
        );
    }
    let endpoint = api_url(&settings.base_url, "chat/completions")?;
    let mut messages = prompts::build_messages(
        &settings.prompt_type,
        &settings.editor_instructions,
        &settings.prompt_profiles,
        &transcript,
        &previous,
        &settings.style,
    )?;
    if settings.ask_questions {
        let system = messages[0]["content"].as_str().unwrap_or("").to_owned();
        messages[0]["content"] = json!(format!("{system}\n\n{}", clarification::INSTRUCTIONS));
        clarification::append_turns(&mut messages, &clarification_turns.unwrap_or_default())?;
    } else if clarification_turns.is_some_and(|t| !t.is_empty()) {
        return Err("Clarification mode is disabled.".into());
    }
    let key = credential(&settings.base_url)?
        .get_password()
        .map_err(|_| "Configure the key in Settings and click Try again.".to_string())?;
    if settings.model.trim().is_empty() {
        return Err("Enter the model in Settings.".into());
    }
    let _ = channel.send(Progress::Phase("Structuring your prompt…".into()));
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    let mut payload = completion_payload(&settings.model, settings.ask_questions, messages);
    apply_thinking_effort(&mut payload, &settings.base_url, &settings.thinking_effort);
    let response = client
        .post(endpoint)
        .bearer_auth(key)
        .header("X-Title", "Voice Prompt")
        .json(&payload)
        .send()
        .await
        .map_err(|_| "Could not connect to the API. Your transcript was preserved.")?;
    let status = response.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            400 | 422 => "The API rejected the parameters. Check the model's tool support if clarification is enabled.".into(),
            401 | 403 => "Invalid key or access denied. Check the API settings.".into(),
            413 => "The provider rejected the input size. Your recording and transcript are preserved. Choose a model with a larger context window.".into(),
            402 => "Insufficient provider balance.".into(),
            404 => "Model or endpoint not found. Check the URL and model ID."
                .into(),
            429 => "Usage limit reached. Wait and try again.".into(),
            _ => format!("The provider returned HTTP {status}. Please try again."),
        });
    }
    if settings.ask_questions {
        let value: Value = response
            .json()
            .await
            .map_err(|_| "Invalid response from the clarification API.")?;
        return clarification::parse(value);
    }
    streaming::collect(response.bytes_stream().eventsource(), |delta| {
        let _ = channel.send(Progress::Delta(delta));
    })
    .await
    .map(|text| json!(text))
}
#[tauri::command]
async fn run_request(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    audio: Option<String>,
    audio_id: Option<String>,
    text: String,
    previous: String,
    settings: Settings,
    channel: Channel<Progress>,
    transcribe_only: bool,
    clarification_turns: Option<Vec<clarification::AnsweredTurn>>,
) -> Result<Value, String> {
    let token = {
        state
            .jobs
            .lock()
            .map_err(|e| e.to_string())?
            .entry(id.clone())
            .or_default()
            .clone()
    };
    let result = tokio::select! { biased;
        _ = token.cancelled() => { *state.engine.lock().await = None; Err("Operation cancelled. Received text was preserved.".into()) },
        result = process(&app, &state, audio, audio_id, text, previous, settings, channel, transcribe_only, clarification_turns) => result,
    };
    state.jobs.lock().map_err(|e| e.to_string())?.remove(&id);
    result
}
#[tauri::command]
fn get_document(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.document.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
async fn open_document(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    text: String,
    always_on_top: bool,
) -> Result<(), String> {
    *state.document.lock().map_err(|e| e.to_string())? = text.clone();
    let window = if let Some(window) = app.get_webview_window("document") {
        window
    } else {
        tauri::WebviewWindowBuilder::new(
            &app,
            "document",
            tauri::WebviewUrl::App("index.html#document".into()),
        )
        .title("Your prompt — Voice Prompt")
        .inner_size(680.0, 720.0)
        .min_inner_size(420.0, 400.0)
        .decorations(false)
        .resizable(true)
        .maximizable(false)
        .minimizable(true)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?
    };
    window
        .set_always_on_top(always_on_top)
        .map_err(|e| e.to_string())?;
    window
        .emit("prompt-document", &text)
        .map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<Value, String> {
    Ok(state
        .settings_snapshot
        .lock()
        .map_err(|e| e.to_string())?
        .clone())
}
#[tauri::command]
async fn open_settings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    config: Value,
    devices: Value,
    models: Value,
) -> Result<(), String> {
    let window = if let Some(window) = app.get_webview_window("settings") {
        window
    } else {
        *state.settings_snapshot.lock().map_err(|e| e.to_string())? =
            json!({"config": config, "devices": devices, "models": models});
        tauri::WebviewWindowBuilder::new(
            &app,
            "settings",
            tauri::WebviewUrl::App("index.html#settings".into()),
        )
        .title("Settings")
        .inner_size(480.0, 680.0)
        .min_inner_size(420.0, 480.0)
        .decorations(false)
        .resizable(true)
        .maximizable(false)
        .minimizable(true)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?
    };
    window
        .set_always_on_top(config["alwaysOnTop"].as_bool().unwrap_or(false))
        .map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_history(state: State<'_, AppState>) -> Result<Value, String> {
    Ok(state
        .history_snapshot
        .lock()
        .map_err(|e| e.to_string())?
        .clone())
}
#[tauri::command]
async fn sync_history(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    data: Value,
    show: bool,
) -> Result<(), String> {
    *state.history_snapshot.lock().map_err(|e| e.to_string())? = data.clone();
    let window = if let Some(window) = app.get_webview_window("history") {
        Some(window)
    } else if show {
        Some(
            tauri::WebviewWindowBuilder::new(
                &app,
                "history",
                tauri::WebviewUrl::App("index.html#history".into()),
            )
            .title("History")
            .inner_size(380.0, 480.0)
            .min_inner_size(300.0, 300.0)
            .decorations(false)
            .resizable(true)
            .maximizable(false)
            .minimizable(true)
            .always_on_top(data["alwaysOnTop"].as_bool().unwrap_or(true))
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?,
        )
    } else {
        None
    };
    if let Some(window) = window {
        window
            .set_always_on_top(data["alwaysOnTop"].as_bool().unwrap_or(true))
            .map_err(|e| e.to_string())?;
        window
            .emit("history-state", &data)
            .map_err(|e| e.to_string())?;
        if show {
            window.unminimize().map_err(|e| e.to_string())?;
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn get_questions(state: State<'_, AppState>) -> Result<Value, String> {
    Ok(state
        .questions_snapshot
        .lock()
        .map_err(|e| e.to_string())?
        .clone())
}
#[tauri::command]
async fn sync_questions(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    data: Value,
    show: bool,
) -> Result<(), String> {
    *state.questions_snapshot.lock().map_err(|e| e.to_string())? = data.clone();
    if data.is_null() {
        if let Some(window) = app.get_webview_window("questions") {
            window.destroy().map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let window = if let Some(window) = app.get_webview_window("questions") {
        Some(window)
    } else if show {
        let mut builder = tauri::WebviewWindowBuilder::new(
            &app,
            "questions",
            tauri::WebviewUrl::App("index.html#questions".into()),
        )
        .title("Questions")
        .inner_size(420.0, 520.0)
        .min_inner_size(360.0, 400.0)
        .decorations(false)
        .resizable(true)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .visible(false);
        if let Some(main) = app.get_webview_window("main") {
            if let (Ok(pos), Ok(size), Ok(Some(monitor))) = (
                main.outer_position(),
                main.outer_size(),
                main.current_monitor(),
            ) {
                let scale = monitor.scale_factor();
                let width = (420.0 * scale) as i32;
                let height = (520.0 * scale) as i32;
                let left = monitor.position().x;
                let top = monitor.position().y;
                let right = left + monitor.size().width as i32;
                let bottom = top + monitor.size().height as i32;
                let preferred = pos.x + size.width as i32 + 12;
                let x = if preferred + width <= right {
                    preferred
                } else {
                    pos.x - width - 12
                }
                .clamp(left, (right - width).max(left));
                let y = pos.y.clamp(top, (bottom - height).max(top));
                builder = builder.position(x as f64 / scale, y as f64 / scale);
            }
        }
        Some(builder.build().map_err(|e| e.to_string())?)
    } else {
        None
    };
    if let Some(window) = window {
        window
            .emit("questions-state", &data)
            .map_err(|e| e.to_string())?;
        if show {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            save_recording,
            delete_recording,
            save_key,
            has_key,
            load_workspace,
            save_workspace,
            voice_status,
            warm_voice,
            models::download_model,
            models::delete_model,
            cancel_request,
            get_document,
            open_document,
            open_settings,
            get_settings,
            run_request,
            get_history,
            sync_history,
            get_questions,
            sync_questions
        ])
        .build(tauri::generate_context!())
        .expect("Failed to start Voice Prompt");
    app.run(|app, event| {
        if let tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } = &event
        {
            if label == "main" {
                app.exit(0);
            }
        }
        if matches!(event, tauri::RunEvent::Exit) {
            tauri::async_runtime::block_on(async {
                *app.state::<AppState>().engine.lock().await = None;
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "Requires installed local CPU and Vulkan runtimes and a compatible GPU; no API calls"]
    async fn local_vulkan_and_cpu_fallback() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("runtime");
        let state = AppState::default();
        ensure_engine_at(
            &dir,
            &dir.join("ggml-large-v3-turbo-q5_0.bin"),
            &state,
            "large-v3-turbo-q5_0",
        )
        .await
        .unwrap();
        assert!(state.engine.lock().await.as_ref().unwrap().gpu);
        *state.engine.lock().await = None;
        // Same fallback state set when Vulkan fails during initialization/inference.
        state
            .gpu_failed
            .store(true, std::sync::atomic::Ordering::Relaxed);
        ensure_engine_at(
            &dir,
            &dir.join("ggml-large-v3-turbo-q5_0.bin"),
            &state,
            "large-v3-turbo-q5_0",
        )
        .await
        .unwrap();
        assert!(!state.engine.lock().await.as_ref().unwrap().gpu);
        *state.engine.lock().await = None;
    }
    #[tokio::test]
    #[ignore = "Uses the locally saved OpenRouter key and may incur API charges"]
    async fn live_prompt_profiles() {
        let key = match credential("https://openrouter.ai/api/v1")
            .unwrap()
            .get_password()
        {
            Ok(key) => key,
            Err(_) => {
                println!("LIVE_EVAL_SKIPPED: no saved OpenRouter key available");
                return;
            }
        };
        let d = prompts::defaults();
        for (mode, input, previous) in [
            ("code", "Quero uma tela de cadastro com três campos, não, dois: nome e e-mail. O botão deve dizer Save. Não adicione bibliotecas. Só um plano, sem implementar.", ""),
            ("auto", "Na verdade tira o telefone e adiciona um botão Cancel. Mantém o resto.", "Implement a registration form with name, email and phone fields. Use a button labeled Save. Do not add libraries."),
            ("auto", "Escreve um e-mail curtinho em português para pedir uma reunião amanhã, sem inventar horário.", ""),
        ] {
            let messages = prompts::build_messages(mode, &d.editor_instructions, &d.prompt_profiles, input, previous, "conciso").unwrap();
            let response = reqwest::Client::builder().timeout(Duration::from_secs(120)).redirect(reqwest::redirect::Policy::none()).build().unwrap()
                .post("https://openrouter.ai/api/v1/chat/completions").bearer_auth(&key)
                .json(&json!({"model":"openai/gpt-5.6-luna","stream":true,"messages":messages}))
                .send().await.expect("Live evaluation request failed");
            assert!(response.status().is_success(), "Live evaluation HTTP {}", response.status());
            let output = streaming::collect(response.bytes_stream().eventsource(), |_| {}).await.unwrap();
            println!("LIVE_EVAL mode={mode}\nINPUT: {input}\nOUTPUT: {output}\n");
        }
    }
    #[test]
    fn thinking_effort_uses_provider_format_without_changing_defaults() {
        for questions in [false, true] {
            let original = completion_payload("existing-model", questions, json!([]));
            let mut payload = original.clone();
            apply_thinking_effort(
                &mut payload,
                "https://openrouter.ai/api/v1",
                &ThinkingEffort::Default,
            );
            assert_eq!(payload, original);
            for effort in ["none", "minimal", "low", "medium", "high", "xhigh", "max"] {
                let setting: ThinkingEffort = serde_json::from_value(json!(effort)).unwrap();
                let mut router = original.clone();
                apply_thinking_effort(&mut router, "https://openrouter.ai/api/v1", &setting);
                assert_eq!(router["reasoning"]["effort"], effort);
                assert!(router.get("reasoning_effort").is_none());
                let mut compatible = original.clone();
                apply_thinking_effort(&mut compatible, "http://localhost:8080/v1", &setting);
                assert_eq!(compatible["reasoning_effort"], effort);
                assert!(compatible.get("reasoning").is_none());
            }
        }
        let old: Settings = serde_json::from_value(json!({"baseUrl":"https://openrouter.ai/api/v1","model":"existing-model","style":"conciso","language":"pt","voiceModel":"small"})).unwrap();
        assert!(old.thinking_effort == ThinkingEffort::Default);
        assert!(serde_json::from_value::<ThinkingEffort>(json!("invalid")).is_err());
    }
    #[test]
    fn request_format_preserves_model_and_optional_tools() {
        let plain = completion_payload(
            "openai/gpt-5.6-luna",
            false,
            json!([{"role":"user","content":"task"}]),
        );
        assert_eq!(plain["stream"], true);
        assert!(plain.get("tools").is_none());
        assert!(plain.get("temperature").is_none());
        let questions = completion_payload("openai/gpt-5.6-luna", true, json!([]));
        assert_eq!(questions["model"], plain["model"]);
        assert_eq!(questions["stream"], false);
        assert_eq!(questions["tool_choice"], "auto");
        assert_eq!(questions["parallel_tool_calls"], false);
        assert_eq!(
            questions["tools"][0]["function"]["name"],
            "ask_clarifying_questions"
        );
    }
    #[tokio::test]
    #[ignore = "Uses the locally saved OpenRouter key and may incur API charges"]
    async fn live_clarification() {
        let key = credential("https://openrouter.ai/api/v1")
            .unwrap()
            .get_password()
            .expect("Saved OpenRouter key required");
        let d = prompts::defaults();
        let mut messages=prompts::build_messages("code",&d.editor_instructions,&d.prompt_profiles,"Quero criar um aplicativo. Ainda não defini o objetivo nem a plataforma. Pergunte isso antes de montar meu prompt.","","conciso").unwrap();
        let system = messages[0]["content"].as_str().unwrap().to_owned();
        messages[0]["content"] = json!(format!("{system}\n\n{}", clarification::INSTRUCTIONS));
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(600))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let mut final_text = None;
        for round in 0..3 {
            let response = client
                .post("https://openrouter.ai/api/v1/chat/completions")
                .bearer_auth(&key)
                .header("X-Title", "Voice Prompt")
                .json(&completion_payload(
                    "openai/gpt-5.6-luna",
                    true,
                    messages.clone(),
                ))
                .send()
                .await
                .expect("Live request failed");
            assert!(response.status().is_success(), "HTTP {}", response.status());
            let outcome = clarification::parse(response.json().await.unwrap()).unwrap();
            if let Some(text) = outcome.as_str() {
                assert!(
                    round > 0,
                    "Expected clarification for deliberately incomplete input"
                );
                final_text = Some(text.to_owned());
                break;
            }
            let questions = clarification::questions(&outcome["assistant"]).unwrap();
            println!(
                "LIVE_CLARIFICATION round={} questions={}",
                round,
                questions.len()
            );
            let answers=questions.iter().map(|_| if round==0 {"Um aplicativo de notas pessoais para Windows. Apenas um plano, sem implementar, sem bibliotecas novas.".into()} else {String::new()}).collect();
            clarification::append_turns(
                &mut messages,
                &[clarification::AnsweredTurn {
                    assistant: outcome["assistant"].clone(),
                    answers,
                }],
            )
            .unwrap();
        }
        let text = final_text.expect("No final prompt after available answers");
        println!("LIVE_CLARIFICATION_FINAL: {text}");
        assert!(text.to_lowercase().contains("windows"));
    }
    #[test]
    fn api_endpoints() {
        assert_eq!(
            api_url("https://openrouter.ai/api/v1/", "chat/completions").unwrap(),
            "https://openrouter.ai/api/v1/chat/completions"
        );
        assert!(api_url("http://127.0.0.1:1234/v1", "models").is_ok());
        for bad in [
            "http://example.com/v1",
            "file:///tmp",
            "https://secret@example.com",
            "https://example.com?key=x",
        ] {
            assert!(api_url(bad, "models").is_err());
        }
    }
    #[test]
    fn rejects_invalid_audio() {
        assert!(validate_wav(&[0; 48]).is_err());
        assert!(validate_wav(&[]).is_err());
    }
}
