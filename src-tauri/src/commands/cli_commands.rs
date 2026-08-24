use serde::{Deserialize, Serialize};
use std::{path::PathBuf, process::Stdio, sync::OnceLock, time::Duration};
use tauri::Emitter;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::Command,
};
use tokio_util::sync::CancellationToken;

const CLAUDE_TURN_TIMEOUT: Duration = Duration::from_secs(30 * 60);
static CLAUDE_REQUESTS: OnceLock<dashmap::DashMap<String, CancellationToken>> = OnceLock::new();

fn claude_requests() -> &'static dashmap::DashMap<String, CancellationToken> {
    CLAUDE_REQUESTS.get_or_init(dashmap::DashMap::new)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCapability {
    id: &'static str,
    name: &'static str,
    command: &'static str,
    description: &'static str,
    installed: bool,
    version: Option<String>,
    available: bool,
    status: String,
    capabilities: Vec<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeModelOption {
    value: &'static str,
    label: &'static str,
    configured_model: Option<String>,
}

const CLAUDE_MODEL_FAMILIES: [(&str, &str, &str, &str); 5] = [
    ("default", "默认模型", "ANTHROPIC_MODEL", "ANTHROPIC_MODEL"),
    (
        "opus",
        "Opus",
        "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
    ),
    (
        "fable",
        "Fable",
        "ANTHROPIC_DEFAULT_FABLE_MODEL_NAME",
        "ANTHROPIC_DEFAULT_FABLE_MODEL",
    ),
    (
        "sonnet",
        "Sonnet",
        "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
    ),
    (
        "haiku",
        "Haiku",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    ),
];

fn configured_claude_models() -> serde_json::Map<String, serde_json::Value> {
    let Some(settings_path) = dirs::home_dir().map(|home| home.join(".claude/settings.json"))
    else {
        return serde_json::Map::new();
    };
    let Ok(contents) = std::fs::read_to_string(settings_path) else {
        return serde_json::Map::new();
    };
    let Ok(settings) = serde_json::from_str::<serde_json::Value>(&contents) else {
        return serde_json::Map::new();
    };
    settings
        .get("env")
        .and_then(serde_json::Value::as_object)
        .cloned()
        .unwrap_or_default()
}

/// Lists Claude Code model aliases and their current CCSwitch display mappings.
///
/// Only model-related values are returned; credentials and endpoint settings are ignored.
#[tauri::command]
pub fn list_claude_code_models() -> Vec<ClaudeCodeModelOption> {
    let configured_models = configured_claude_models();
    CLAUDE_MODEL_FAMILIES
        .into_iter()
        .map(
            |(value, label, display_key, fallback_key)| ClaudeCodeModelOption {
                value,
                label,
                configured_model: configured_models
                    .get(display_key)
                    .or_else(|| configured_models.get(fallback_key))
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|model| !model.is_empty())
                    .map(str::to_string),
            },
        )
        .collect()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeRequest {
    request_id: String,
    prompt: String,
    workspace_path: String,
    session_id: Option<String>,
    model: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeCodeStreamEvent {
    request_id: String,
    kind: &'static str,
    text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeResponse {
    session_id: String,
    result: String,
    total_cost_usd: Option<f64>,
    duration_ms: Option<u64>,
    num_turns: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct ClaudeCodeOutput {
    session_id: String,
    result: String,
    #[serde(default)]
    is_error: bool,
    total_cost_usd: Option<f64>,
    duration_ms: Option<u64>,
    num_turns: Option<u64>,
}

fn validated_workspace_path(raw_path: &str) -> Result<PathBuf, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err("请选择 Claude Code 的工作目录".to_string());
    }

    let path =
        std::fs::canonicalize(trimmed).map_err(|error| format!("无法访问工作目录: {error}"))?;
    if !path.is_dir() {
        return Err("Claude Code 工作目录必须是文件夹".to_string());
    }
    Ok(path)
}

fn claude_skill_read_dirs() -> Vec<PathBuf> {
    [
        crate::services::skill_service::get_system_skills_directory(),
        crate::services::skill_service::get_user_skills_directory(),
    ]
    .into_iter()
    .filter_map(|result| match result {
        Ok(path) if path.is_dir() => match std::fs::canonicalize(&path) {
            Ok(path) => Some(path),
            Err(error) => {
                log::warn!(
                    "Failed to resolve Claude Code skill directory '{}': {}",
                    path.display(),
                    error
                );
                None
            }
        },
        Ok(_) => None,
        Err(error) => {
            log::warn!("Failed to locate Claude Code skill directory: {error}");
            None
        }
    })
    .collect()
}

#[tauri::command]
pub async fn claude_code_chat(
    window: tauri::Window,
    request: ClaudeCodeRequest,
) -> Result<ClaudeCodeResponse, String> {
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err("消息不能为空".to_string());
    }
    if prompt.len() > 200_000 {
        return Err("消息过长，请缩短后重试".to_string());
    }

    let workspace_path = validated_workspace_path(&request.workspace_path)?;
    let skill_read_dirs = claude_skill_read_dirs();
    let claude_executable = crate::utils::shell_runtime::resolve_cli_executable("claude");
    let mut command = Command::new(claude_executable);
    command
        .current_dir(workspace_path)
        .arg("--print")
        .arg(prompt)
        .arg("--output-format")
        .arg("stream-json")
        .arg("--include-partial-messages")
        .arg("--verbose")
        .arg("--disable-slash-commands")
        .arg("--permission-mode")
        .arg("acceptEdits")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    for skill_dir in &skill_read_dirs {
        command.arg("--add-dir").arg(skill_dir);
    }
    if !skill_read_dirs.is_empty() {
        let roots = skill_read_dirs
            .iter()
            .map(|path| format!("- {}", path.display()))
            .collect::<Vec<_>>()
            .join("\n");
        command.arg("--append-system-prompt").arg(format!(
            "Moark managed Agent Skills are available only in these skill roots:\n{roots}\nUse these roots as the authoritative skill source. Do not resolve skills through ~/.claude, ~/.cc-switch, symlinks into those directories, or another Claude installation. When a managed skill is relevant, read its SKILL.md and referenced files from the same managed skill directory, including its references subdirectory."
        ));
    }

    if let Some(model) = request.model.filter(|model| !model.trim().is_empty()) {
        command.arg("--model").arg(model);
    }

    if let Some(session_id) = request.session_id.filter(|id| !id.trim().is_empty()) {
        command.arg("--resume").arg(session_id);
    }

    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "未找到 Claude CLI，请先安装并确保 claude 在 PATH 中".to_string()
        } else {
            format!("启动 Claude CLI 失败: {error}")
        }
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 Claude CLI 输出".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 Claude CLI 错误输出".to_string())?;
    let stderr_task = tokio::spawn(async move {
        let mut buffer = String::new();
        let _ = stderr.read_to_string(&mut buffer).await;
        buffer
    });

    let request_id = request.request_id.clone();
    let cancellation_token = CancellationToken::new();
    claude_requests().insert(request_id.clone(), cancellation_token.clone());
    let event_request_id = request_id.clone();
    let execution = async move {
        let mut lines = BufReader::new(stdout).lines();
        let mut final_output: Option<ClaudeCodeOutput> = None;
        let mut received_text_delta = false;

        while let Some(line) = lines
            .next_line()
            .await
            .map_err(|error| format!("读取 Claude CLI 输出失败: {error}"))?
        {
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            let message_type = value.get("type").and_then(|item| item.as_str());

            if message_type == Some("system")
                && value.get("subtype").and_then(|item| item.as_str()) == Some("init")
            {
                if let Some(session_id) = value.get("session_id").and_then(|item| item.as_str()) {
                    let _ = window.emit(
                        "claude-code:stream",
                        ClaudeCodeStreamEvent {
                            request_id: event_request_id.clone(),
                            kind: "session_id",
                            text: session_id.to_string(),
                        },
                    );
                }
                continue;
            }

            if message_type == Some("stream_event") {
                let Some(event) = value.get("event") else {
                    continue;
                };
                let event_type = event.get("type").and_then(|item| item.as_str());
                if event_type == Some("content_block_delta") {
                    if let Some(text) = event
                        .get("delta")
                        .and_then(|delta| delta.get("text"))
                        .and_then(|item| item.as_str())
                    {
                        received_text_delta = true;
                        let _ = window.emit(
                            "claude-code:stream",
                            ClaudeCodeStreamEvent {
                                request_id: event_request_id.clone(),
                                kind: "text_delta",
                                text: text.to_string(),
                            },
                        );
                    }
                } else if event_type == Some("content_block_start") {
                    if let Some(tool_name) = event
                        .get("content_block")
                        .filter(|block| {
                            block.get("type").and_then(|item| item.as_str()) == Some("tool_use")
                        })
                        .and_then(|block| block.get("name"))
                        .and_then(|item| item.as_str())
                    {
                        let _ = window.emit(
                            "claude-code:stream",
                            ClaudeCodeStreamEvent {
                                request_id: event_request_id.clone(),
                                kind: "status",
                                text: format!("正在执行 {tool_name}"),
                            },
                        );
                    }
                }
                continue;
            }

            if message_type == Some("assistant") && !received_text_delta {
                if let Some(content) = value
                    .get("message")
                    .and_then(|message| message.get("content"))
                    .and_then(|item| item.as_array())
                {
                    for block in content {
                        if block.get("type").and_then(|item| item.as_str()) == Some("text") {
                            if let Some(text) = block.get("text").and_then(|item| item.as_str()) {
                                let _ = window.emit(
                                    "claude-code:stream",
                                    ClaudeCodeStreamEvent {
                                        request_id: event_request_id.clone(),
                                        kind: "text_delta",
                                        text: text.to_string(),
                                    },
                                );
                            }
                        }
                    }
                }
            } else if message_type == Some("result") {
                final_output = serde_json::from_value(value).ok();
            }
        }

        let status = child
            .wait()
            .await
            .map_err(|error| format!("等待 Claude CLI 结束失败: {error}"))?;
        let stderr = stderr_task.await.unwrap_or_default().trim().to_string();
        if !status.success() {
            if let Some(result) = final_output
                .as_ref()
                .filter(|output| output.is_error)
                .map(|output| output.result.trim())
                .filter(|result| !result.is_empty())
            {
                return Err(result.to_string());
            }
            return Err(if stderr.is_empty() {
                format!("Claude CLI 执行失败，退出码: {:?}", status.code())
            } else {
                stderr
            });
        }
        final_output.ok_or_else(|| "Claude CLI 未返回最终结果".to_string())
    };

    let result = tokio::select! {
        _ = cancellation_token.cancelled() => {
            Err("Claude Code 已暂停".to_string())
        }
        result = tokio::time::timeout(CLAUDE_TURN_TIMEOUT, execution) => {
            result
                .map_err(|_| "Claude Code 本轮执行超过 30 分钟，已终止".to_string())?
        }
    };
    claude_requests().remove(&request_id);
    let parsed = result?;
    if parsed.is_error {
        return Err(parsed.result);
    }

    Ok(ClaudeCodeResponse {
        session_id: parsed.session_id,
        result: parsed.result,
        total_cost_usd: parsed.total_cost_usd,
        duration_ms: parsed.duration_ms,
        num_turns: parsed.num_turns,
    })
}

#[tauri::command]
pub fn cancel_claude_code_chat(request_id: String) -> bool {
    let Some(request) = claude_requests().get(&request_id) else {
        return false;
    };
    request.cancel();
    true
}

async fn output(command: &str, args: &[&str]) -> Option<(bool, String)> {
    let executable = crate::utils::shell_runtime::resolve_cli_executable(command);
    let result = Command::new(executable)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .output()
        .await
        .ok()?;
    let stdout = String::from_utf8_lossy(&result.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&result.stderr).trim().to_string();
    Some((
        result.status.success(),
        if stdout.is_empty() { stderr } else { stdout },
    ))
}

async fn detect_gitee() -> CliCapability {
    let Some((_, version)) = output("gitee", &["version"]).await else {
        return CliCapability {
            id: "gitee",
            name: "Gitee CLI",
            command: "gitee",
            description: "Gitee、番茄卡片与代码协作命令行工具",
            installed: false,
            version: None,
            available: false,
            status: "未安装".to_string(),
            capabilities: vec!["番茄卡片查询", "卡片状态流转", "仓库与 Pull Request"],
        };
    };
    let auth = output("gitee", &["auth", "status", "--profile", "osc"]).await;
    let available = auth
        .as_ref()
        .is_some_and(|(success, text)| *success && text.contains("已登录"));
    CliCapability {
        id: "gitee",
        name: "Gitee CLI",
        command: "gitee",
        description: "Gitee、番茄卡片与代码协作命令行工具",
        installed: true,
        version: version.lines().next().map(str::to_string),
        available,
        status: auth
            .map(|(_, text)| text.lines().take(4).collect::<Vec<_>>().join(" · "))
            .unwrap_or_else(|| "无法检测登录状态".to_string()),
        capabilities: vec!["番茄卡片查询", "卡片状态流转", "仓库与 Pull Request"],
    }
}

async fn detect_lark() -> CliCapability {
    let Some((_, version)) = output("lark-cli", &["--version"]).await else {
        return CliCapability {
            id: "lark",
            name: "飞书 CLI",
            command: "lark-cli",
            description: "飞书开放平台与办公套件命令行工具",
            installed: false,
            version: None,
            available: false,
            status: "未安装".to_string(),
            capabilities: vec!["消息与群聊", "文档与云盘", "日历、任务与多维表格"],
        };
    };
    let whoami = output("lark-cli", &["whoami"]).await;
    let (available, status) = match whoami {
        Some((success, text)) => {
            let value = serde_json::from_str::<serde_json::Value>(&text).ok();
            let token_status = value
                .as_ref()
                .and_then(|item| item.get("tokenStatus"))
                .and_then(|item| item.as_str())
                .unwrap_or("unknown");
            let identity = value
                .as_ref()
                .and_then(|item| item.get("onBehalfOf"))
                .and_then(|item| item.get("userName"))
                .and_then(|item| item.as_str());
            let available = success
                && value
                    .as_ref()
                    .and_then(|item| item.get("available"))
                    .and_then(|item| item.as_bool())
                    .unwrap_or(false)
                && token_status != "needs_refresh";
            (
                available,
                format!(
                    "{}{}",
                    identity
                        .map(|name| format!("身份：{name} · "))
                        .unwrap_or_default(),
                    match token_status {
                        "needs_refresh" => "Token 需要刷新",
                        "valid" => "授权有效",
                        other => other,
                    }
                ),
            )
        }
        None => (false, "无法检测授权状态".to_string()),
    };
    CliCapability {
        id: "lark",
        name: "飞书 CLI",
        command: "lark-cli",
        description: "飞书开放平台与办公套件命令行工具",
        installed: true,
        version: version.lines().next().map(str::to_string),
        available,
        status,
        capabilities: vec!["消息与群聊", "文档与云盘", "日历、任务与多维表格"],
    }
}

async fn detect_claude() -> CliCapability {
    let Some((success, version)) = output("claude", &["--version"]).await else {
        return CliCapability {
            id: "claude-code",
            name: "Claude Code",
            command: "claude",
            description: "Anthropic 的编程代理命令行工具",
            installed: false,
            version: None,
            available: false,
            status: "未安装".to_string(),
            capabilities: vec!["代码理解", "文件编辑", "命令执行", "连续对话"],
        };
    };

    CliCapability {
        id: "claude-code",
        name: "Claude Code",
        command: "claude",
        description: "Anthropic 的编程代理命令行工具",
        installed: true,
        version: version.lines().next().map(str::to_string),
        available: success,
        status: if success {
            "可用于独立助手"
        } else {
            "版本检测失败"
        }
        .to_string(),
        capabilities: vec!["代码理解", "文件编辑", "命令执行", "连续对话"],
    }
}

#[tauri::command]
pub async fn detect_cli_capabilities() -> Vec<CliCapability> {
    let (gitee, lark, claude) = tokio::join!(detect_gitee(), detect_lark(), detect_claude());
    vec![gitee, lark, claude]
}
