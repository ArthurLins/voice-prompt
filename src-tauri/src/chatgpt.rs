use serde_json::{json, Value};
use std::{collections::VecDeque, path::PathBuf, process::Stdio, time::Duration};
use tauri::{Manager, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout},
};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct AuthState {
    mutation: tokio::sync::Mutex<()>,
    login: std::sync::Mutex<Option<CancellationToken>>,
}

// Resolve a native executable; never run a shell command or npm .cmd shim.
fn codex_executable() -> Result<PathBuf, String> {
    let name = if cfg!(windows) { "codex.exe" } else { "codex" };
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            if !dir.is_absolute() {
                continue;
            }
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    #[cfg(windows)]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let root = PathBuf::from(local).join("OpenAI/Codex/bin");
        let mut candidates: Vec<_> = std::fs::read_dir(root)
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.path().join("codex.exe"))
            .filter(|path| path.is_file())
            .collect();
        candidates.sort_by_key(|path| std::fs::metadata(path).and_then(|m| m.modified()).ok());
        if let Some(candidate) = candidates.pop() {
            return Ok(candidate);
        }
    }
    #[cfg(target_os = "macos")]
    for path in ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"] {
        if std::path::Path::new(path).is_file() {
            return Ok(PathBuf::from(path));
        }
    }
    Err("Codex CLI was not found. Install the official native Codex CLI on PATH, then restart Voice Prompt.".into())
}

// One owned process per operation: dropping an operation (including cancellation)
// terminates its server. Tokens are managed only by Codex in a separate keyring namespace.
struct Server {
    _child: Child,
    input: ChildStdin,
    output: tokio::io::Lines<BufReader<ChildStdout>>,
    events: VecDeque<Value>,
    serial: u64,
    cwd: PathBuf,
}
impl Server {
    async fn start(app: &tauri::AppHandle) -> Result<Self, String> {
        let home = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("chatgpt");
        let cwd = home.join("workspace");
        std::fs::create_dir_all(&cwd).map_err(|_| "Could not prepare ChatGPT connection.")?;
        let mut cmd = tokio::process::Command::new(codex_executable()?);
        cmd.args([
            "-c",
            "cli_auth_credentials_store=\"keyring\"",
            "-c",
            "forced_login_method=\"chatgpt\"",
            "-c",
            "history.persistence=\"none\"",
            "-c",
            "features.shell_tool=false",
            "-c",
            "features.unified_exec=false",
            "-c",
            "features.shell_snapshot=false",
            "-c",
            "web_search=\"disabled\"",
            "app-server",
            "--listen",
            "stdio://",
        ])
        .env("CODEX_HOME", &home)
        .env_remove("OPENAI_API_KEY")
        .env_remove("CODEX_API_KEY")
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let mut child = cmd.spawn().map_err(|_| "Codex CLI was not found. Install the official Codex CLI, make it available on PATH, then restart Voice Prompt.")?;
        let mut server = Self {
            input: child.stdin.take().unwrap(),
            output: BufReader::new(child.stdout.take().unwrap()).lines(),
            _child: child,
            events: VecDeque::new(),
            serial: 0,
            cwd,
        };
        server.call("initialize", json!({"clientInfo":{"name":"voice_prompt","title":"Voice Prompt","version":env!("CARGO_PKG_VERSION")},"capabilities":{"experimentalApi":false}})).await?;
        server.send(json!({"method":"initialized"})).await?;
        Ok(server)
    }
    async fn send(&mut self, value: Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
        bytes.push(b'\n');
        self.input
            .write_all(&bytes)
            .await
            .map_err(|_| "Codex connection closed.".to_string())
    }
    async fn read(&mut self) -> Result<Value, String> {
        loop {
            let line = self
                .output
                .next_line()
                .await
                .map_err(|_| "Could not read Codex response.")?
                .ok_or("Codex stopped. Check the CLI installation and retry.")?;
            if line.len() > 2_000_000 {
                return Err("Codex response exceeded the size limit.".into());
            }
            let value: Value = serde_json::from_str(&line)
                .map_err(|_| "Invalid Codex protocol response. Update the official CLI.")?;
            if value.get("id").is_some() && value.get("method").is_some() {
                // This text-only integration never approves tools or executes server requests.
                self.send(json!({"id":value["id"],"error":{"code":-32601,"message":"Voice Prompt does not execute tools."}})).await?;
                continue;
            }
            return Ok(value);
        }
    }
    async fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.serial += 1;
        let id = self.serial;
        self.send(json!({"id":id,"method":method,"params":params}))
            .await?;
        tokio::time::timeout(Duration::from_secs(45), async {
            loop {
                let value = self.read().await?;
                if value["id"] == id {
                    if !value["error"].is_null() {
                        return Err(format!(
                            "Codex rejected {method}. Check your login, model and CLI version."
                        ));
                    }
                    return Ok(value["result"].clone());
                }
                if self.events.len() >= 256 {
                    return Err("Too many pending Codex events.".into());
                }
                self.events.push_back(value);
            }
        })
        .await
        .map_err(|_| "Codex did not respond in time. Please retry.".to_string())?
    }
    async fn event(&mut self) -> Result<Value, String> {
        if let Some(value) = self.events.pop_front() {
            return Ok(value);
        }
        self.read().await
    }
    async fn models(&mut self) -> Result<Value, String> {
        let mut models = Vec::new();
        let mut cursor = Value::Null;
        let mut seen = std::collections::HashSet::new();
        loop {
            let page = self
                .call(
                    "model/list",
                    json!({"limit":100,"includeHidden":false,"cursor":cursor}),
                )
                .await?;
            for model in page["data"]
                .as_array()
                .ok_or("Invalid model catalog from Codex.")?
            {
                if model["hidden"] == true {
                    continue;
                }
                let id = model["model"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .ok_or("Invalid model identifier from Codex.")?;
                if models.iter().any(|m: &Value| m["model"] == id) {
                    continue;
                }
                models.push(json!({"model":id,"displayName":model["displayName"].as_str().unwrap_or(id),"isDefault":model["isDefault"] == true}));
            }
            cursor = page["nextCursor"].clone();
            if cursor.is_null() {
                break;
            }
            let next = cursor.as_str().ok_or("Invalid model catalog cursor.")?;
            if !seen.insert(next.to_owned()) || seen.len() > 100 {
                return Err("Invalid model catalog pagination.".into());
            }
        }
        Ok(json!(models))
    }
    async fn account(&mut self) -> Result<Value, String> {
        let value = self
            .call("account/read", json!({"refreshToken":false}))
            .await?;
        let account = &value["account"];
        Ok(
            json!({"connected":account["type"] == "chatgpt", "email":account["email"], "plan":account["planType"]}),
        )
    }
}

// Some CLI versions save OAuth credentials without delivering login/completed.
// Read the persisted session in a fresh server so its pre-login auth cache cannot
// keep the UI disconnected. An event alone never proves that an account is ready.
async fn wait_for_login<F, Fut>(
    server: &mut Server,
    login_id: &str,
    mut probe: F,
    interval: Duration,
) -> Result<Value, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<Value, String>>,
{
    let mut timer = tokio::time::interval(interval);
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            _ = timer.tick() => {},
            event = server.event() => {
                let event = match event {
                    Ok(event) => event,
                    Err(error) => {
                        if let Ok(Ok(account)) = tokio::time::timeout(Duration::from_secs(10), probe()).await {
                            if account["connected"] == true { return Ok(account); }
                        }
                        return Err(error);
                    }
                };
                match event["method"].as_str() {
                    Some("account/login/completed") if event["params"]["loginId"] == login_id => {
                        if event["params"]["success"] != true {
                            return Err("ChatGPT login failed or was cancelled. Please retry.".into());
                        }
                    },
                    Some("account/updated") if event["params"]["authMode"] == "chatgpt" => {},
                    _ => continue,
                }
            }
        }
        if let Ok(Ok(account)) = tokio::time::timeout(Duration::from_secs(10), probe()).await {
            if account["connected"] == true {
                return Ok(account);
            }
        }
    }
}

#[tauri::command]
pub async fn chatgpt_models(app: tauri::AppHandle) -> Result<Value, String> {
    let mut server = Server::start(&app).await?;
    if server.account().await?["connected"] != true {
        return Err("Connect your ChatGPT account to load models.".into());
    }
    server.models().await
}

fn open_login(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "Invalid login URL.")?;
    if parsed.scheme() != "https"
        || !matches!(
            parsed.host_str(),
            Some("auth.openai.com" | "chatgpt.com" | "auth.chatgpt.com")
        )
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Codex returned an unexpected login URL.".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", url])
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|_| "Could not open the login browser.")?;
    }
    #[cfg(not(windows))]
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map_err(|_| "Could not open the login browser.")?;
    Ok(())
}

#[tauri::command]
pub async fn chatgpt_status(app: tauri::AppHandle) -> Result<Value, String> {
    Server::start(&app).await?.account().await
}
#[tauri::command]
pub async fn chatgpt_login(
    app: tauri::AppHandle,
    state: State<'_, AuthState>,
) -> Result<Value, String> {
    let _mutation = state
        .mutation
        .try_lock()
        .map_err(|_| "Another account operation is in progress.")?;
    let token = CancellationToken::new();
    {
        let mut active = state.login.lock().map_err(|e| e.to_string())?;
        if active.is_some() {
            return Err("A ChatGPT login is already in progress.".into());
        }
        *active = Some(token.clone());
    }
    let result =
        async {
            let mut server = tokio::select! {
                _ = token.cancelled() => return Err("ChatGPT login cancelled.".into()),
                result = Server::start(&app) => result?,
            };
            let login = tokio::select! {
                _ = token.cancelled() => return Err("ChatGPT login cancelled.".into()),
                result = server.call("account/login/start", json!({"type":"chatgpt"})) => result?,
            };
            let login_id = login["loginId"]
                .as_str()
                .ok_or("Codex did not return a login identifier.")?
                .to_owned();
            let completion = async {
            open_login(login["authUrl"].as_str().ok_or("Codex did not return a login URL.")?)?;
            tokio::select! {
                _ = token.cancelled() => Err("ChatGPT login cancelled.".into()),
                result = tokio::time::timeout(Duration::from_secs(300), async {
                    wait_for_login(&mut server, &login_id, || async {
                        Server::start(&app).await?.account().await
                    }, Duration::from_secs(3)).await
                }) => result.unwrap_or_else(|_| Err("ChatGPT login expired. Please retry.".into())),
            }
        }.await;
            if completion.is_err() {
                let _ = tokio::time::timeout(
                    Duration::from_secs(2),
                    server.call("account/login/cancel", json!({"loginId":login_id})),
                )
                .await;
            }
            completion
        }
        .await;
    *state.login.lock().map_err(|e| e.to_string())? = None;
    result
}
#[tauri::command]
pub fn chatgpt_cancel_login(state: State<'_, AuthState>) {
    cancel_login(&state);
}
pub fn cancel_login(state: &AuthState) {
    if let Ok(active) = state.login.lock() {
        if let Some(token) = active.as_ref() {
            token.cancel();
        }
    }
}
#[tauri::command]
pub async fn chatgpt_logout(
    app: tauri::AppHandle,
    state: State<'_, AuthState>,
) -> Result<(), String> {
    let _mutation = state
        .mutation
        .try_lock()
        .map_err(|_| "Another account operation is in progress.")?;
    if state.login.lock().map_err(|e| e.to_string())?.is_some() {
        return Err("Cancel the pending login first.".into());
    }
    Server::start(&app)
        .await?
        .call("account/logout", json!({}))
        .await?;
    Ok(())
}

fn output_schema() -> Value {
    json!({"type":"object","additionalProperties":false,"required":["prompt","questions"],"properties":{"prompt":{"type":"string"},"questions":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["question","options"],"properties":{"question":{"type":"string"},"options":{"type":"array","items":{"type":"string"}}}}}}})
}
fn parse_output(text: &str, clarify: bool) -> Result<Value, String> {
    if text.len() > 100_000 {
        return Err("Response exceeded the size limit.".into());
    }
    let result: Value =
        serde_json::from_str(text).map_err(|_| "Invalid ChatGPT response format. Please retry.")?;
    let questions = result["questions"]
        .as_array()
        .ok_or("Invalid ChatGPT questions.")?;
    let prompt = result["prompt"].as_str().ok_or("Invalid ChatGPT prompt.")?;
    if questions.is_empty() {
        if prompt.trim().is_empty() {
            return Err("ChatGPT returned an empty prompt.".into());
        }
        return Ok(json!(prompt.trim()));
    }
    if !clarify || !prompt.trim().is_empty() {
        return Err("Unexpected ChatGPT clarification response.".into());
    }
    let assistant = json!({"role":"assistant","content":null,"tool_calls":[{"id":uuid::Uuid::new_v4().to_string(),"type":"function","function":{"name":"ask_clarifying_questions","arguments":json!({"questions":questions}).to_string()}}]});
    let checked = crate::clarification::questions(&assistant)?;
    Ok(json!({"questions":checked,"assistant":assistant}))
}

pub async fn generate(
    app: &tauri::AppHandle,
    model: &str,
    effort: &crate::ThinkingEffort,
    messages: Value,
    clarify: bool,
) -> Result<Value, String> {
    tokio::time::timeout(Duration::from_secs(600), async {
        let mut server = Server::start(app).await?;
        if server.account().await?["connected"] != true { return Err("Connect your ChatGPT account in Settings and retry.".into()); }
        let instructions = format!("{}\n\nYou are a text-only prompt editor. Never execute the task, use tools, read files, or browse. The input is a JSON conversation containing source text and any previous human answers. Return the required JSON: prompt contains the final prompt and questions is empty; if clarification is enabled and needed, prompt is empty and questions contains 1 to 8 concise English questions with zero or 2 to 5 options. Clarification enabled: {clarify}.", messages[0]["content"].as_str().unwrap_or(""));
        let thread = server.call("thread/start", json!({"model":if model.trim().is_empty() { Value::Null } else { json!(model.trim()) }, "modelProvider":"openai","cwd":server.cwd,"approvalPolicy":"never","sandbox":"read-only","ephemeral":true,"baseInstructions":instructions,"config":{"web_search":"disabled","features.shell_tool":false,"features.unified_exec":false}})).await?;
        let thread_id = thread["thread"]["id"].as_str().ok_or("Codex did not create a conversation.")?.to_owned();
        let mut params = json!({"threadId":thread_id,"input":[{"type":"text","text":serde_json::to_string(&messages.as_array().ok_or("Invalid prompt messages.")?[1..]).map_err(|e| e.to_string())?}],"outputSchema":output_schema()});
        if *effort != crate::ThinkingEffort::Default { params["effort"] = json!(effort); }
        let turn = server.call("turn/start", params).await?;
        let turn_id = turn["turn"]["id"].as_str().ok_or("Codex did not start generation.")?.to_owned();
        let mut answer = String::new();
        loop {
            let event = server.event().await?;
            let p = &event["params"];
            if p["threadId"] != thread_id { continue; }
            if event["method"] == "item/completed" && p["turnId"] == turn_id && p["item"]["type"] == "agentMessage" {
                answer = p["item"]["text"].as_str().unwrap_or("").to_owned();
            }
            if event["method"] == "turn/completed" && p["turn"]["id"] == turn_id {
                if p["turn"]["status"] != "completed" { return Err("ChatGPT generation failed or was interrupted. Your input is preserved; check account access and retry.".into()); }
                return parse_output(&answer, clarify);
            }
        }
    }).await.map_err(|_| "ChatGPT generation timed out. Your input is preserved.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn structured_final_and_questions_preserve_existing_contract() {
        assert_eq!(
            parse_output(r#"{"prompt":"Write a plan.","questions":[]}"#, false).unwrap(),
            "Write a plan."
        );
        let result = parse_output(
            r#"{"prompt":"","questions":[{"question":"Which audience?","options":[]}]}"#,
            true,
        )
        .unwrap();
        let mut messages = json!([]);
        crate::clarification::append_turns(
            &mut messages,
            &[crate::clarification::AnsweredTurn {
                assistant: result["assistant"].clone(),
                answers: vec!["Iniciantes".into()],
            }],
        )
        .unwrap();
        assert!(messages[1]["content"]
            .as_str()
            .unwrap()
            .contains("Iniciantes"));
        assert_eq!(
            crate::clarification::questions(&result["assistant"])
                .unwrap()
                .len(),
            1
        );
    }
    #[test]
    fn rejects_empty_mixed_malformed_and_unrequested_questions() {
        for text in [
            "not json",
            r#"{"prompt":"","questions":[]}"#,
            r#"{"prompt":"text","questions":[{"question":"Which?","options":[]}]}"#,
            r#"{"prompt":"","questions":[{"question":"Which?","options":["one"]}]}"#,
        ] {
            assert!(parse_output(text, true).is_err());
        }
        assert!(parse_output(
            r#"{"prompt":"","questions":[{"question":"Which?","options":[]}]}"#,
            false
        )
        .is_err());
    }
    #[tokio::test]
    async fn rpc_buffers_early_events_and_rejects_tool_requests() {
        let script = r#"
const rl = require('readline').createInterface({input:process.stdin});
const send = x => process.stdout.write(JSON.stringify(x)+'\n');
rl.on('line', line => {
 const m = JSON.parse(line);
 if(m.method === 'probe') {
   send({method:'item/completed',params:{item:{type:'agentMessage',text:'early'}}});
   send({id:'server-call',method:'item/commandExecution/requestApproval',params:{}});
 } else if(m.id === 'server-call' && m.error?.code === -32601) {
   send({id:1,result:{ok:true}});
 } else if(m.method === 'fail') { send({id:m.id,error:{code:-1,message:'private provider detail'}}); }
});
"#;
        let mut cmd = tokio::process::Command::new("node");
        cmd.args(["-e", script])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let mut child = cmd.spawn().unwrap();
        let mut server = Server {
            input: child.stdin.take().unwrap(),
            output: BufReader::new(child.stdout.take().unwrap()).lines(),
            _child: child,
            events: VecDeque::new(),
            serial: 0,
            cwd: PathBuf::new(),
        };
        assert_eq!(server.call("probe", json!({})).await.unwrap()["ok"], true);
        assert_eq!(
            server.event().await.unwrap()["params"]["item"]["text"],
            "early"
        );
        let error = server.call("fail", json!({})).await.unwrap_err();
        assert!(!error.contains("private provider detail"));
        server._child.kill().await.unwrap();
        assert!(server.event().await.is_err());
    }
}

#[cfg(test)]
mod connection_tests {
    use super::*;
    async fn fixture(script: &str) -> Server {
        let mut cmd = tokio::process::Command::new("node");
        cmd.args(["-e", script])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let mut child = cmd.spawn().unwrap();
        Server {
            input: child.stdin.take().unwrap(),
            output: BufReader::new(child.stdout.take().unwrap()).lines(),
            _child: child,
            events: VecDeque::new(),
            serial: 0,
            cwd: PathBuf::new(),
        }
    }
    #[tokio::test]
    async fn saved_login_is_detected_without_completion_notification() {
        let mut server = fixture("setInterval(()=>{},10000)").await;
        let mut probes = 0;
        let account = tokio::time::timeout(
            Duration::from_secs(2),
            wait_for_login(
                &mut server,
                "login-id",
                || {
                    probes += 1;
                    std::future::ready(Ok(json!({"connected":probes >= 2})))
                },
                Duration::from_millis(10),
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(account["connected"], true);
        assert_eq!(probes, 2);
    }
    #[tokio::test]
    async fn completion_does_not_return_a_stale_disconnected_account() {
        let mut server = fixture("setInterval(()=>{},10000)").await;
        server.events.push_back(json!({"method":"account/login/completed","params":{"loginId":"login-id","success":true}}));
        let mut probes = 0;
        let account = wait_for_login(
            &mut server,
            "login-id",
            || {
                probes += 1;
                std::future::ready(Ok(json!({"connected":probes >= 3})))
            },
            Duration::from_millis(10),
        )
        .await
        .unwrap();
        assert_eq!(account["connected"], true);
        assert_eq!(probes, 3);
    }
    #[tokio::test]
    async fn login_failure_is_not_reported_as_connected() {
        let mut server = fixture("setInterval(()=>{},10000)").await;
        server.events.push_back(json!({"method":"account/login/completed","params":{"loginId":"other-login","success":false}}));
        server.events.push_back(json!({"method":"account/login/completed","params":{"loginId":"login-id","success":false}}));
        assert!(wait_for_login(
            &mut server,
            "login-id",
            || std::future::ready(Ok(json!({"connected":false}))),
            Duration::from_millis(10)
        )
        .await
        .is_err());
    }
    #[tokio::test]
    async fn models_are_paginated_filtered_and_deduplicated() {
        let mut server = fixture(r#"
const rl=require('readline').createInterface({input:process.stdin});
rl.on('line',line=>{const m=JSON.parse(line);const page=m.params.cursor;
process.stdout.write(JSON.stringify({id:m.id,result:page===null?{data:[{model:'one',displayName:'One',isDefault:true},{model:'hidden',hidden:true}],nextCursor:'page2'}:{data:[{model:'one'},{model:'two',displayName:'Two'}],nextCursor:null}})+'\n');});
"#).await;
        let models = server.models().await.unwrap();
        assert_eq!(models.as_array().unwrap().len(), 2);
        assert_eq!(models[0]["model"], "one");
        assert_eq!(models[0]["isDefault"], true);
        assert_eq!(models[1]["displayName"], "Two");
    }
}
