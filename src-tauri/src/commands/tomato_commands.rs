use crate::mcp::keychain;
use crate::repositories::settings_repository::SettingsRepository;
use crate::services::tomato::configured_client;
use crate::state::get_settings_repository;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::command;

const TOMATO_SETTING_KEY: &str = "tomatoWorkboard";
const TOMATO_KEYCHAIN_ID: &str = "tomato-workboard-pat";
const DEFAULT_TOMATO_HOST: &str = "https://osc.gitee.work";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TomatoConnectionConfig {
    #[serde(default = "default_tomato_host")]
    pub host: String,
    #[serde(default)]
    pub context_id: Option<String>,
}

impl Default for TomatoConnectionConfig {
    fn default() -> Self {
        Self {
            host: default_tomato_host(),
            context_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TomatoSession {
    pub configured: bool,
    pub host: String,
    pub context_id: Option<String>,
}

fn default_tomato_host() -> String {
    DEFAULT_TOMATO_HOST.to_string()
}

fn normalize_host(host: &str) -> Result<String, String> {
    let host = host.trim().trim_end_matches('/');
    let url = url::Url::parse(host).map_err(|_| "番茄服务器地址无效".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("番茄服务器地址必须是有效的 HTTP(S) 地址".to_string());
    }
    Ok(host.to_string())
}

async fn load_config() -> Result<TomatoConnectionConfig, String> {
    let setting = get_settings_repository()
        .get(TOMATO_SETTING_KEY)
        .await
        .map_err(|error| format!("读取番茄配置失败: {error}"))?;

    setting
        .map(|model| {
            serde_json::from_str(&model.value).map_err(|error| format!("番茄配置格式无效: {error}"))
        })
        .transpose()
        .map(|config| config.unwrap_or_default())
}

#[command]
pub async fn tomato_get_session() -> Result<TomatoSession, String> {
    let config = load_config().await?;
    Ok(TomatoSession {
        configured: keychain::has_token(TOMATO_KEYCHAIN_ID).await,
        host: config.host,
        context_id: config.context_id,
    })
}

#[command]
pub async fn tomato_save_connection(
    host: String,
    token: String,
    context_id: Option<String>,
) -> Result<TomatoSession, String> {
    let host = normalize_host(&host)?;
    let token = token.trim();
    if token.is_empty() {
        return Err("Personal Access Token 不能为空".to_string());
    }

    keychain::store_token_securely(TOMATO_KEYCHAIN_ID, token).await?;
    let config = TomatoConnectionConfig {
        host: host.clone(),
        context_id: context_id.filter(|value| !value.trim().is_empty()),
    };

    if let Err(error) = get_settings_repository()
        .set(TOMATO_SETTING_KEY, json!(config))
        .await
    {
        let _ = keychain::delete_token(TOMATO_KEYCHAIN_ID).await;
        return Err(format!("保存番茄配置失败: {error}"));
    }

    Ok(TomatoSession {
        configured: true,
        host,
        context_id: config.context_id,
    })
}

#[command]
pub async fn tomato_disconnect() -> Result<TomatoSession, String> {
    if keychain::has_token(TOMATO_KEYCHAIN_ID).await {
        keychain::delete_token(TOMATO_KEYCHAIN_ID).await?;
    }
    let config = load_config().await?;
    Ok(TomatoSession {
        configured: false,
        host: config.host,
        context_id: config.context_id,
    })
}

#[command]
pub async fn tomato_search_items(
    iql: String,
    page: Option<u32>,
    size: Option<u32>,
    fields: Option<Vec<String>>,
    excluded_types: Option<Vec<String>>,
    excluded_statuses: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    configured_client()
        .await?
        .search_items(
            iql.trim(),
            page.unwrap_or(1),
            size.unwrap_or(50),
            fields.as_deref().unwrap_or(&[]),
            excluded_types.as_deref().unwrap_or(&[]),
            excluded_statuses.as_deref().unwrap_or(&[]),
        )
        .await
}

#[command]
pub async fn tomato_get_item(item_id: String) -> Result<serde_json::Value, String> {
    if item_id.trim().is_empty() {
        return Err("番茄事项 ID 不能为空".to_string());
    }
    configured_client().await?.get_item(item_id.trim()).await
}

#[command]
pub async fn tomato_list_transitions(item_id: String) -> Result<serde_json::Value, String> {
    if item_id.trim().is_empty() {
        return Err("番茄事项 ID 不能为空".to_string());
    }
    configured_client()
        .await?
        .list_transitions(item_id.trim())
        .await
}

#[command]
pub async fn tomato_execute_transition(
    item_id: String,
    transition: String,
) -> Result<serde_json::Value, String> {
    let item_id = item_id.trim();
    let transition = transition.trim();
    if item_id.is_empty() {
        return Err("番茄事项 ID 不能为空".to_string());
    }
    if transition.is_empty() {
        return Err("番茄流转名称不能为空".to_string());
    }
    configured_client()
        .await?
        .execute_transition(item_id, transition)
        .await
}
