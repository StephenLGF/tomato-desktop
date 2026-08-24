use serde::Serialize;
use std::path::Path;
use std::process::Stdio;
use tokio::process::Command;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRepositoryInfo {
    path: String,
    name: String,
    is_git_repository: bool,
    branch: Option<String>,
    detached: bool,
    dirty: bool,
    remote_url: Option<String>,
}

async fn git(path: &Path, args: &[&str]) -> Option<(bool, String)> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
        .ok()?;
    Some((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).trim().to_string(),
    ))
}

#[tauri::command]
pub async fn inspect_local_repository(path: String) -> Result<LocalRepositoryInfo, String> {
    let raw_path = Path::new(path.trim());
    if path.trim().is_empty() || !raw_path.is_absolute() {
        return Err("仓库路径必须是绝对路径".to_string());
    }
    let canonical = tokio::fs::canonicalize(raw_path)
        .await
        .map_err(|error| format!("无法读取仓库目录: {error}"))?;
    if !canonical.is_dir() {
        return Err("请选择一个文件夹".to_string());
    }

    let name = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("仓库")
        .to_string();
    let is_git_repository = git(&canonical, &["rev-parse", "--is-inside-work-tree"])
        .await
        .is_some_and(|(success, value)| success && value == "true");
    let (branch, detached, dirty, remote_url) = if is_git_repository {
        let branch = git(&canonical, &["branch", "--show-current"])
            .await
            .filter(|(success, _)| *success)
            .map(|(_, value)| value)
            .filter(|value| !value.is_empty());
        let detached = branch.is_none();
        let dirty = git(&canonical, &["status", "--porcelain"])
            .await
            .is_some_and(|(success, value)| success && !value.is_empty());
        let remote_url = git(&canonical, &["remote", "get-url", "origin"])
            .await
            .filter(|(success, _)| *success)
            .map(|(_, value)| value)
            .filter(|value| !value.is_empty());
        (branch, detached, dirty, remote_url)
    } else {
        (None, false, false, None)
    };

    Ok(LocalRepositoryInfo {
        path: canonical.to_string_lossy().to_string(),
        name,
        is_git_repository,
        branch,
        detached,
        dirty,
        remote_url,
    })
}
