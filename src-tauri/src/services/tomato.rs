use serde_json::Value;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

const DEFAULT_PROFILE: &str = "osc";
const CLI_TIMEOUT: Duration = Duration::from_secs(120);
const MY_CARDS_IQL: &str = "负责人 = currentUser() and 所属空间 in ['Gitee-Team', 'Gitee-Test']";

#[derive(Debug, Clone)]
pub struct TomatoClient {
    executable: PathBuf,
    profile: String,
}

impl TomatoClient {
    pub fn new() -> Self {
        Self {
            executable: crate::utils::shell_runtime::resolve_cli_executable("gitee"),
            profile: DEFAULT_PROFILE.to_string(),
        }
    }

    async fn run(&self, args: &[String]) -> Result<std::process::Output, String> {
        let mut command = Command::new(&self.executable);
        command
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        for variable in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
        ] {
            command.env_remove(variable);
        }

        tokio::time::timeout(CLI_TIMEOUT, command.output())
            .await
            .map_err(|_| "Gitee CLI 请求超时".to_string())?
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    "找不到 Gitee CLI，请先安装并确保 gitee 在 PATH 中".to_string()
                } else {
                    format!("启动 Gitee CLI 失败: {error}")
                }
            })
    }

    async fn run_json(&self, args: Vec<String>) -> Result<Value, String> {
        let output = self.run(&args).await?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "Gitee CLI 请求失败: {}",
                stderr.trim().chars().take(1000).collect::<String>()
            ));
        }
        let stdout = String::from_utf8(output.stdout)
            .map_err(|_| "Gitee CLI 返回了非 UTF-8 内容".to_string())?;
        serde_json::from_str(stdout.trim())
            .map_err(|error| format!("Gitee CLI 返回了无效 JSON: {error}"))
    }

    pub async fn verify_session(&self) -> Result<(), String> {
        let output = self
            .run(&[
                "auth".to_string(),
                "status".to_string(),
                "--profile".to_string(),
                self.profile.clone(),
            ])
            .await?;
        if output.status.success() && String::from_utf8_lossy(&output.stdout).contains("已登录")
        {
            Ok(())
        } else {
            Err("Gitee CLI 尚未登录 osc profile，请先运行 gitee auth login".to_string())
        }
    }

    pub async fn search_items(
        &self,
        iql: &str,
        page: u32,
        size: u32,
        fields: &[String],
        excluded_types: &[String],
        excluded_statuses: &[String],
    ) -> Result<Value, String> {
        if iql.trim().is_empty() {
            return self
                .search_my_cards(excluded_types, excluded_statuses)
                .await;
        }
        self.search_page(iql, page, size, fields).await
    }

    async fn search_page(
        &self,
        iql: &str,
        page: u32,
        size: u32,
        fields: &[String],
    ) -> Result<Value, String> {
        let mut args = vec!["team", "item", "search"]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>();
        args.extend([
            "--profile".to_string(),
            self.profile.clone(),
            "--page".to_string(),
            page.max(1).to_string(),
            "--size".to_string(),
            size.clamp(1, 50).to_string(),
            "--iql".to_string(),
            iql.to_string(),
            "--output".to_string(),
            "json".to_string(),
        ]);
        if !fields.is_empty() {
            args.extend(["--fields".to_string(), fields.join(",")]);
        }
        self.run_json(args).await
    }

    async fn search_my_cards(
        &self,
        excluded_types: &[String],
        excluded_statuses: &[String],
    ) -> Result<Value, String> {
        let fields = vec!["priority".to_string(), "createdBy".to_string()];
        let mut filters = vec![MY_CARDS_IQL.to_string()];
        if !excluded_types.is_empty() {
            filters.push(format!("类型 not in [{}]", iql_string_list(excluded_types)));
        }
        if !excluded_statuses.is_empty() {
            filters.push(format!(
                "状态 not in [{}]",
                iql_string_list(excluded_statuses)
            ));
        }
        let iql = filters.join(" and ");
        let mut page = 1_u32;
        let mut items = Vec::new();
        let mut source_count = None;

        loop {
            let payload = self.search_page(&iql, page, 50, &fields).await?;
            let page_items = payload
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            source_count = source_count.or_else(|| payload.get("count").and_then(Value::as_u64));
            let page_len = page_items.len();
            items.extend(page_items);

            let next_page = payload
                .get("nextPageIndex")
                .and_then(Value::as_i64)
                .unwrap_or(-1);
            let has_more = next_page != -1
                || source_count.is_some_and(|count| items.len() < count as usize)
                || (source_count.is_none() && page_len == 50);
            if !has_more || page_len == 0 {
                break;
            }
            if items.len() >= 5000 {
                return Err("番茄事项超过 5000 条，同步未完成，未更新看板".to_string());
            }
            page = if next_page > 0 {
                next_page as u32
            } else {
                page.saturating_add(1)
            };
        }

        let fetched_count = items.len();

        Ok(serde_json::json!({
            "items": items,
            "count": fetched_count,
            "sourceCount": source_count.unwrap_or(fetched_count as u64),
            "fetchedCount": fetched_count,
            "excludedCount": 0,
            "nextPageIndex": -1,
            "truncated": false
        }))
    }

    pub async fn get_item(&self, item_id: &str) -> Result<Value, String> {
        self.run_json(vec![
            "team".to_string(),
            "item".to_string(),
            "view".to_string(),
            item_id.to_string(),
            "--profile".to_string(),
            self.profile.clone(),
            "--output".to_string(),
            "json".to_string(),
        ])
        .await
    }

    pub async fn list_transitions(&self, item_id: &str) -> Result<Value, String> {
        self.run_json(vec![
            "team".to_string(),
            "transition".to_string(),
            "list".to_string(),
            item_id.to_string(),
            "--profile".to_string(),
            self.profile.clone(),
            "--output".to_string(),
            "json".to_string(),
        ])
        .await
    }

    pub async fn execute_transition(
        &self,
        item_id: &str,
        transition: &str,
    ) -> Result<Value, String> {
        self.run_json(vec![
            "team".to_string(),
            "transition".to_string(),
            "execute".to_string(),
            item_id.to_string(),
            "--transition".to_string(),
            transition.to_string(),
            "--profile".to_string(),
            self.profile.clone(),
            "--output".to_string(),
            "json".to_string(),
        ])
        .await
    }
}

fn iql_string_list(values: &[String]) -> String {
    values
        .iter()
        .filter_map(|value| {
            let value = value.trim();
            (!value.is_empty()).then(|| format!("'{}'", value.replace('\'', "\\'")))
        })
        .collect::<Vec<_>>()
        .join(", ")
}

pub async fn configured_client() -> Result<TomatoClient, String> {
    let client = TomatoClient::new();
    client.verify_session().await?;
    Ok(client)
}
