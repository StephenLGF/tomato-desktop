use crate::mcp::schema::SchemaProperties;
use crate::mcp::types::MCPTool;
use crate::mcp::utils::schema_builder::*;

pub fn all_tools() -> Vec<MCPTool> {
    vec![search_cards(), get_card(), list_card_transitions()]
}

fn search_cards() -> MCPTool {
    let mut props = SchemaProperties::new();
    props.insert(
        "iql".to_string(),
        string_prop(
            None,
            Some(2000),
            Some("Team IQL filter; omit or use an empty string to list cards"),
        ),
    );
    props.insert(
        "page".to_string(),
        integer_prop(Some(1), Some(10000), Some("Page number starting at 1")),
    );
    props.insert(
        "size".to_string(),
        integer_prop(Some(1), Some(50), Some("Cards per page, maximum 50")),
    );
    MCPTool {
        name: "searchCards".to_string(),
        title: Some("Search Tomato Cards".to_string()),
        description: "Search Tomato/Gitee Team cards available in the configured enterprise context. Returns stable card IDs required by detail and transition tools.".to_string(),
        input_schema: object_schema(props, vec![]),
        output_schema: None,
        annotations: None,
    }
}

fn get_card() -> MCPTool {
    let mut props = SchemaProperties::new();
    props.insert(
        "itemId".to_string(),
        string_prop(Some(1), Some(200), Some("Card ID returned by searchCards")),
    );
    MCPTool {
        name: "getCard".to_string(),
        title: Some("Get Tomato Card".to_string()),
        description: "Get complete details for a Tomato card. Obtain the immutable card ID from searchCards first.".to_string(),
        input_schema: object_schema(props, vec!["itemId".to_string()]),
        output_schema: None,
        annotations: None,
    }
}

fn list_card_transitions() -> MCPTool {
    let mut props = SchemaProperties::new();
    props.insert(
        "itemId".to_string(),
        string_prop(Some(1), Some(200), Some("Card ID returned by searchCards")),
    );
    MCPTool {
        name: "listCardTransitions".to_string(),
        title: Some("List Card Transitions".to_string()),
        description: "List currently valid workflow transitions for a Tomato card. Use the exact transition returned here for a later state-changing operation.".to_string(),
        input_schema: object_schema(props, vec!["itemId".to_string()]),
        output_schema: None,
        annotations: None,
    }
}
