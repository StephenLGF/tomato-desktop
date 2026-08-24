use async_trait::async_trait;
use serde_json::{json, Value};

use crate::mcp::builtin::BuiltinMCPServer;
use crate::mcp::types::{
    BuiltinServerMetadata, ContextVolatility, MCPResult, MCPTool, ServiceContext,
};
use crate::services::tomato::configured_client;

pub mod tools;

pub const NAME: &str = "tomato";

#[derive(Debug)]
pub struct TomatoServer;

impl TomatoServer {
    pub fn new() -> Self {
        Self
    }

    pub fn tools_static() -> Vec<MCPTool> {
        tools::all_tools()
    }

    pub fn metadata_static() -> BuiltinServerMetadata {
        BuiltinServerMetadata {
            display_name: "番茄工作台".to_string(),
            description: "获取番茄卡片、查看详情和查询工作流流转".to_string(),
            icon: None,
        }
    }
}

fn required_item_id(args: &Value) -> Result<&str, String> {
    args.get("itemId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::trim)
        .ok_or_else(|| "itemId is required; use tomato__searchCards to obtain it".to_string())
}

fn result_with_data(label: &str, data: Value) -> MCPResult {
    MCPResult::success_with_data(
        &format!(
            "{label}\n\n{}",
            serde_json::to_string_pretty(&data).unwrap_or_default()
        ),
        data,
    )
}

#[async_trait]
impl BuiltinMCPServer for TomatoServer {
    fn name(&self) -> &str {
        NAME
    }
    fn description(&self) -> &str {
        "Native Tomato/Gitee Team card and workflow access"
    }
    fn display_name(&self) -> String {
        "番茄工作台".to_string()
    }
    fn tools(&self) -> Vec<MCPTool> {
        Self::tools_static()
    }

    async fn call_tool(
        &self,
        tool_name: &str,
        args: Value,
        _session_id: Option<String>,
    ) -> Result<MCPResult, String> {
        let client = configured_client().await?;
        match tool_name {
            "searchCards" => {
                let iql = args.get("iql").and_then(Value::as_str).unwrap_or("");
                let page = args
                    .get("page")
                    .and_then(Value::as_u64)
                    .unwrap_or(1)
                    .min(u32::MAX as u64) as u32;
                let size = args
                    .get("size")
                    .and_then(Value::as_u64)
                    .unwrap_or(50)
                    .min(50) as u32;
                let data = client.search_items(iql, page, size, &[], &[], &[]).await?;
                Ok(result_with_data(
                    "番茄卡片查询完成。卡片 ID 可用于 getCard 和 listCardTransitions。",
                    data,
                ))
            }
            "getCard" => {
                let item_id = required_item_id(&args)?;
                let data = client.get_item(item_id).await?;
                Ok(result_with_data(
                    &format!("已获取番茄卡片（ID: {item_id}）。"),
                    data,
                ))
            }
            "listCardTransitions" => {
                let item_id = required_item_id(&args)?;
                let data = client.list_transitions(item_id).await?;
                Ok(result_with_data(
                    &format!("已获取卡片可用流转（ID: {item_id}）。"),
                    data,
                ))
            }
            _ => Err(format!("Unknown Tomato tool: {tool_name}")),
        }
    }

    async fn get_service_context(&self, _options: Option<&Value>) -> ServiceContext {
        let configured = configured_client().await.is_ok();
        ServiceContext::new(if configured {
            "## 番茄工作台\n\n连接已配置。使用 `tomato__searchCards` 获取卡片。".to_string()
        } else {
            "## 番茄工作台\n\n尚未配置连接，请先在设置中填写服务器、PAT 和企业 Context。"
                .to_string()
        })
        .with_structured_state(json!({ "configured": configured }))
        .with_volatility(ContextVolatility::Volatile)
    }
}
