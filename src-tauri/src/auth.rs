// src-tauri/src/auth.rs

// --- 依赖 ---
use once_cell::sync::Lazy; // 用于惰性静态初始化
use rand::distr::Alphanumeric; // `distr` 才是正确的
use rand::{thread_rng, Rng};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex}; // 对 PendingAuthState 使用 StdMutex
use tauri::{AppHandle, Emitter, Manager, Runtime, State}; // 确保 Manager 已导入
use thiserror::Error;
use tokio::sync::{oneshot, Mutex as TokioMutex}; // TokioMutex 用于异步服务器状态
use urlencoding; // 用于 URL 编码参数

// --- 开发服务器的条件导入 ---
#[cfg(debug_assertions)]
use axum::{
    extract::{Query, State as AxumState},
    http, // 确保 http 被导入
    response::Html,
    routing::get,
    Router,
};
#[cfg(debug_assertions)]
use std::net::SocketAddr;

// --- 配置结构体 ---
#[derive(Clone, Debug, PartialEq)] // 为方便测试添加 PartialEq
struct EnvConfig {
    github_client_id: String,
    github_client_secret: String,
    worker_api_url: String,
    worker_api_key: String,
}

// --- 新增：为解析逻辑定义的错误类型 ---
#[derive(Debug, PartialEq)]
pub enum ConfigParseError {
    MissingKey(String),
    EmptyValue(String),
    MalformedLine(usize, String), // 行号, 行内容
}

impl std::fmt::Display for ConfigParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigParseError::MissingKey(key) => write!(f, "缺少必要的键: {}", key),
            ConfigParseError::EmptyValue(key) => write!(f, "键 {} 的值不能为空", key),
            ConfigParseError::MalformedLine(num, line) => {
                write!(f, "无法解析第 {} 行 (缺少 '='?): {}", num, line)
            }
        }
    }
}
impl std::error::Error for ConfigParseError {}

pub(crate) fn parse_env_content(env_content: &str) -> Result<EnvConfig, ConfigParseError> {
    // println!("Auth: [parse_env_content] 开始解析内容...");
    let mut vars = HashMap::new();
    for (line_num, line) in env_content.lines().enumerate() {
        let trimmed_line = line.trim();
        if trimmed_line.is_empty() || trimmed_line.starts_with('#') {
            continue; // 跳过空行和以 # 开头的注释行
        }

        if let Some((key, value_raw)) = trimmed_line.split_once('=') {
            let key_trimmed = key.trim();

            // --- START: 更简化的行内注释处理 ---
            let value_without_comment_trimmed_end =
                if let Some(comment_start_index) = value_raw.find('#') {
                    // 检查 '#' 是否在引号内是高级功能，这里简化处理。
                    // 假设非引号内的 '#' 及其后的内容为注释。
                    let mut part_before_comment = &value_raw[..comment_start_index];

                    // 一个尝试性的检查，如果 `#` 前面看起来像一个结束的引号，那么注释是合理的
                    // 例子: MY_VAR="value" # comment
                    // 而不是: MY_VAR="value#inside"
                    // 这个逻辑可以非常复杂，这里我们只处理最简单的情况
                    let mut potential_val = part_before_comment.trim_end(); // 去掉注释前，值和 # 之间的空格

                    // 检查被截断的部分是否以引号结束，如果是，可能需要特殊处理
                    // 但对于 `.env` 通常简单地以第一个 `#` 分割就够了（如果它不在开头的引号内）

                    potential_val // 返回修剪了尾部空格的注释前部分
                } else {
                    value_raw // 没有注释，使用原始值部分
                };
            // --- END: 更简化的行内注释处理 ---

            let value_initially_trimmed = value_without_comment_trimmed_end.trim(); // 1. 首先修剪两端空白

            let final_value = // 2. 检查并剥离包围的引号
                if value_initially_trimmed.starts_with('"') && value_initially_trimmed.ends_with('"') && value_initially_trimmed.len() >= 2 {
                    &value_initially_trimmed[1..value_initially_trimmed.len() - 1]
                } else if value_initially_trimmed.starts_with('\'') && value_initially_trimmed.ends_with('\'') && value_initially_trimmed.len() >= 2 {
                    &value_initially_trimmed[1..value_initially_trimmed.len() - 1]
                } else {
                    value_initially_trimmed
                };

            if key_trimmed.is_empty() {
                // println!("Auth: [parse_env_content] 警告 - 在第 {} 行解析到空键: {}", line_num + 1, line);
                continue;
            }

            // 在实际运行时打印这个可能比较有用，但在测试中可能会产生大量输出
            // if cfg!(not(test)){ // 只在非测试时打印
            println!(
                "Auth: [parse_env_content] 解析KeyValue: KEY='{}', FINAL_VALUE='{}' (原始行: '{}')",
                key_trimmed, final_value, line
            );
            // }

            vars.insert(key_trimmed.to_string(), final_value.to_string());
        } else {
            if !trimmed_line.is_empty() {
                // 只对非空且无 '=' 的行报错
                // println!("Auth: [parse_env_content] 警告 - 无法解析第 {} 行 (缺少 '='?): {}", line_num + 1, line);
                return Err(ConfigParseError::MalformedLine(
                    line_num + 1,
                    line.to_string(),
                ));
            }
        }
    }
    // println!("Auth: [parse_env_content] 完成解析. 找到 {} 个潜在变量.", vars.len());

    // --- 提取逻辑，使用解析出的 'vars' map ---
    // (后续的提取逻辑保持不变，但现在它们会收到更干净的 value)
    // println!("Auth: [parse_env_content] 提取 GITHUB_CLIENT_ID...");
    let github_client_id = vars
        .get("GITHUB_CLIENT_ID")
        .ok_or_else(|| ConfigParseError::MissingKey("GITHUB_CLIENT_ID".to_string()))?
        .clone();
    if github_client_id.is_empty() {
        // println!("Auth: [parse_env_content] 错误 - GITHUB_CLIENT_ID 为空.");
        return Err(ConfigParseError::EmptyValue("GITHUB_CLIENT_ID".to_string()));
    }
    // println!("Auth: [parse_env_content] GITHUB_CLIENT_ID = '{}'", github_client_id);

    // println!("Auth: [parse_env_content] 提取 GITHUB_CLIENT_SECRET...");
    let github_client_secret = vars
        .get("GITHUB_CLIENT_SECRET")
        .ok_or_else(|| ConfigParseError::MissingKey("GITHUB_CLIENT_SECRET".to_string()))?
        .clone();
    if github_client_secret.is_empty() {
        // println!("Auth: [parse_env_content] 错误 - GITHUB_CLIENT_SECRET 为空.");
        return Err(ConfigParseError::EmptyValue(
            "GITHUB_CLIENT_SECRET".to_string(),
        ));
    }
    // let secret_len = github_client_secret.len();
    // let masked_secret = if secret_len > 4 { /* ... */ } else { /* ... */ };
    // println!("Auth: [parse_env_content] GITHUB_CLIENT_SECRET = '{}'", masked_secret);

    // println!("Auth: [parse_env_content] 提取 WORKER_API_URL...");
    let worker_api_url = vars
        .get("WORKER_API_URL")
        .ok_or_else(|| ConfigParseError::MissingKey("WORKER_API_URL".to_string()))?
        .clone();
    if worker_api_url.is_empty() {
        // println!("Auth: [parse_env_content] 错误 - WORKER_API_URL 为空.");
        return Err(ConfigParseError::EmptyValue("WORKER_API_URL".to_string()));
    }
    // println!("Auth: [parse_env_content] WORKER_API_URL = '{}'", worker_api_url);

    // println!("Auth: [parse_env_content] 提取 WORKER_API_KEY...");
    let worker_api_key = vars
        .get("WORKER_API_KEY")
        .ok_or_else(|| ConfigParseError::MissingKey("WORKER_API_KEY".to_string()))?
        .clone();
    if worker_api_key.is_empty() {
        // println!("Auth: [parse_env_content] 错误 - WORKER_API_KEY 为空.");
        return Err(ConfigParseError::EmptyValue("WORKER_API_KEY".to_string()));
    }
    // let key_len = worker_api_key.len();
    // let masked_key = if key_len > 4 { /* ... */ } else { /* ... */ };
    // println!("Auth: [parse_env_content] WORKER_API_KEY = '{}'", masked_key);

    // println!("Auth: [parse_env_content] 成功构建 EnvConfig.");
    Ok(EnvConfig {
        github_client_id,
        github_client_secret,
        worker_api_url,
        worker_api_key,
    })
}

// --- 编译时嵌入和惰性解析 (使用详细日志) ---
// 使用 include_str! 在 *编译时* 读取相应的 .env 文件
// 在运行时首次访问时 *一次性* 解析内容。
// 警告：这会将密钥直接嵌入到二进制文件中。
static CONFIG: Lazy<EnvConfig> = Lazy::new(|| {
    println!("Auth: 初始化嵌入式配置...");
    let env_content = if cfg!(debug_assertions) {
        println!("Auth: 嵌入 .env.development 内容.");
        include_str!("../../.env.development") // 确保路径正确
    } else {
        println!("Auth: 嵌入 .env.production 内容.");
        include_str!("../../.env.production") // 确保路径正确
    };

    // println!("Auth: 解析嵌入式内容:\n---\n{}\n---", env_content); // 此日志移至 parse_env_content 内部
    // 现在使用重构的函数
    // .unwrap_or_else 会在解析失败时 panic，这与 Lazy 初始化的原始行为一致
    match parse_env_content(env_content) {
        Ok(config) => {
            println!("Auth: 嵌入式配置成功初始化。");
            config
        }
        Err(e) => {
            // 打印更详细的错误信息
            eprintln!("Auth: 严重错误 - 解析嵌入式 .env 内容失败: {}", e);
            eprintln!("Auth: 使用的内容:\n---\n{}\n---", env_content); // 打印导致错误的内容
            panic!("Auth: 严重错误 - 解析嵌入式 .env 内容失败: {}", e);
        }
    }
});

// --- 嵌入式配置的访问器函数 ---
// 这些函数提供了对惰性初始化的静态 CONFIG 的清晰访问
fn get_github_client_id() -> &'static str {
    &CONFIG.github_client_id
}

fn get_github_client_secret() -> &'static str {
    &CONFIG.github_client_secret
}

pub fn get_worker_api_url() -> &'static str {
    &CONFIG.worker_api_url
}

pub fn get_worker_api_key() -> &'static str {
    &CONFIG.worker_api_key
}

// --- 基于构建类型的动态重定向 URI (保持不变) ---
fn get_redirect_uri() -> &'static str {
    if cfg!(debug_assertions) {
        "http://127.0.0.1:54321/callback" // 开发: 本地服务器
    } else {
        "revision://github/callback" // 生产: 使用你的自定义 scheme "revision"
    }
}

const CSRF_STATE_EXPIRY_SECS: u64 = 300; // 5 分钟

// --- 状态管理 ---
// 待处理请求的共享状态 (开发服务器和深层链接处理器都使用)
pub type PendingAuthState =
    Arc<StdMutex<HashMap<String, oneshot::Sender<Result<String, AuthError>>>>>;

// --- 开发服务器特定状态 ---
#[cfg(debug_assertions)]
#[derive(Default)]
pub struct ServerHandle {
    pub shutdown_tx: Option<oneshot::Sender<()>>,
    pub join_handle: Option<tokio::task::JoinHandle<()>>,
}
#[cfg(debug_assertions)]
pub type AuthServerState = Arc<TokioMutex<ServerHandle>>; // TokioMutex 需要用于围绕启动/停止的异步锁定

// --- 数据结构 ---
#[derive(Deserialize, Debug)]
struct CallbackParams {
    code: String,
    state: String,
}

#[derive(Deserialize, Debug)]
struct GithubTokenResponse {
    access_token: String,
    // scope: String, // 如果需要，保留
    // token_type: String, // 如果需要，保留
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GithubUserProfile {
    login: String,
    id: u64,
    name: Option<String>,
    avatar_url: String,
    email: Option<String>, // 确保请求了 'user:email' 作用域
}

#[derive(Serialize, Debug)]
struct BackendSyncPayload<'a> {
    profile: &'a GithubUserProfile,
}

#[derive(Deserialize, Debug)]
struct BackendSyncResponse {
    success: bool,
    message: Option<String>,
}

// --- 错误处理 ---
#[derive(Serialize, Debug, Clone, Error)]
pub enum AuthError {
    #[error("网络请求失败: {0}")]
    ReqwestError(String),
    #[cfg(debug_assertions)]
    #[error("启动本地回调服务器失败: {0}")]
    ServerStartError(String),
    #[error("收到无效的 CSRF state")]
    InvalidState,
    #[error("GitHub 返回错误: {0}")]
    GitHubError(String),
    #[error("回调超时或已取消")]
    CallbackTimeout,
    #[error("解析响应失败: {0}")]
    ParseError(String),
    #[error("内部错误: {0}")]
    InternalError(String),
    #[error("用户或系统取消了身份验证")]
    Cancelled,
    #[error("将用户数据同步到后端失败: {0}")]
    BackendSyncFailed(String),
    #[error("深层链接错误: {0}")]
    DeepLinkError(String),
    #[error("Tauri 操作失败: {0}")] // <--- 新增变体
    TauriError(String),
    // #[error("配置错误: {0}")]
    // ConfigError(String),
}

// 转换 reqwest 错误
impl From<reqwest::Error> for AuthError {
    fn from(err: reqwest::Error) -> Self {
        AuthError::ReqwestError(err.to_string())
    }
}

// 转换 tauri 错误
impl From<tauri::Error> for AuthError {
    fn from(err: tauri::Error) -> Self {
        AuthError::TauriError(err.to_string())
    }
}

// --- Tauri 命令 ---
#[tauri::command]
pub async fn login_with_github<R: Runtime>(
    app: AppHandle<R>,
    pending_auth_state: State<'_, PendingAuthState>,
) -> Result<String, String> {
    // 返回 GitHub Auth URL 或错误字符串
    println!("Auth: 启动 GitHub OAuth 流程...");

    // --- 确定重定向 URI ---
    let redirect_uri = get_redirect_uri();
    println!("Auth: 使用重定向 URI: {}", redirect_uri);

    // --- 获取 Client ID 并仔细记录 ---
    // 通过访问器函数访问嵌入式配置。
    // 这会在首次调用时触发 Lazy 初始化。
    let github_client_id = get_github_client_id();
    // 记录从配置中获取的原始 ID 值，以验证其是否正确且非空。
    println!("Auth: 使用配置中的 Client ID: '{}'", github_client_id);
    // 确保 client_id 在获取后不为空，否则 URL 将无效。
    if github_client_id.is_empty() {
        let err_msg = "严重错误: 初始化后嵌入的 GITHUB_CLIENT_ID 为空。".to_string();
        eprintln!("Auth: {}", err_msg);
        // 可选地发出错误事件
        let _ = app.emit(
            "github_auth_error",
            Some(AuthError::InternalError(err_msg.clone())),
        );
        return Err(err_msg); // 将错误返回给前端
    }
    // --- State 和 Channel 设置 ---
    let state: String = thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32) // 生成一个随机 state 字符串
        .map(char::from)
        .collect();
    let (code_tx, code_rx) = oneshot::channel::<Result<String, AuthError>>();

    // --- 条件性：启动开发服务器 ---
    #[cfg(debug_assertions)]
    {
        if let Some(server_state) = app.try_state::<AuthServerState>() {
            println!("Auth [Debug]: 尝试启动本地回调服务器...");
            let server_start_result = start_dev_server(
                app.clone(),
                pending_auth_state.inner().clone(), // 传递 Arc<StdMutex<...>>
                server_state.inner().clone(),       // 传递 Arc<TokioMutex<...>>
            )
            .await;

            if let Err(e) = server_start_result {
                eprintln!("Auth [Debug]: 启动服务器失败: {:?}", e);
                let _ = app.emit("github_auth_error", Some(e.clone())); // 发出特定错误
                return Err(e.to_string()); // 将错误返回给前端 invoke
            }
            println!("Auth [Debug]: 本地回调服务器正在运行或已启动。");
        } else {
            let err =
                AuthError::InternalError("AuthServerState 在 debug 构建中未被管理".to_string());
            eprintln!("Auth [Debug]: 错误 - {}", err);
            let _ = app.emit("github_auth_error", Some(err.clone()));
            return Err(err.to_string());
        }
    } // 结束 #[cfg(debug_assertions)] 块，用于启动服务器

    // --- 在返回 URL 之前存储 state 和 sender ---
    {
        let mut pending_map = pending_auth_state
            .lock()
            .expect("锁定 pending auth state 失败");
        pending_map.insert(state.clone(), code_tx);
        println!("Auth: State '{}' 已存储。准备好进行回调/深层链接。", state);
    }
    // --- 编码 URL 所需的参数 ---
    // 编码 redirect_uri
    let encoded_redirect_uri = urlencoding::encode(redirect_uri);
    println!("Auth: 编码后的 Redirect URI: {}", encoded_redirect_uri);

    // 编码 scope
    let scope = "read:user user:email"; // 请求基本个人资料和邮箱访问权限
    let encoded_scope = urlencoding::encode(scope);
    println!("Auth: 编码后的 Scope: {}", encoded_scope);

    // State 通常*不需要*编码，除非它包含特殊的 URL 字符，
    // 但如果你期望不寻常的 state 值，这样做更安全。标准的 Alphanumeric 是可以的。
    // let encoded_state = urlencoding::encode(&state);
    // --- 构建 GitHub 授权 URL ---
    let auth_url = format!(
        "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&scope={}&state={}",
        github_client_id,     // 使用经过验证的、非空的 client_id
        encoded_redirect_uri, // 使用编码后的 redirect URI
        encoded_scope,        // 使用编码后的 scope
        state.clone()         // 使用原始的 state 字符串
    );

    // --- !!! 打印最终的 URL 以进行调试 !!! ---
    println!("Auth: 生成的待打开 Auth URL: {}", auth_url);

    // --- 生成任务以等待回调/深层链接并处理流程 ---
    let task_app_handle = app.clone();
    let task_pending_auth_state = pending_auth_state.inner().clone();
    let task_state = state.clone(); // 为任务克隆 state

    tokio::spawn(async move {
        // 这是“身份验证处理任务”
        println!("Auth Task [{}]: 已生成。等待回调/深层链接...", task_state);

        // --- 等待回调/深层链接或超时 ---
        let code_result = match tokio::time::timeout(
            std::time::Duration::from_secs(CSRF_STATE_EXPIRY_SECS),
            code_rx, // 在 oneshot channel 的接收端等待
        )
        .await
        {
            Ok(Ok(code_res)) => {
                // 成功从 channel接收
                println!("Auth Task [{}]: 通过 channel 收到 Code。", task_state);
                code_res // 这是 Result<String, AuthError>
            }
            Ok(Err(_rx_err)) => {
                // Channel sender 被丢弃
                eprintln!(
                    "Auth Task [{}]: 回调/深层链接 sender 被丢弃 (state 可能已移除)。",
                    task_state
                );
                Err(AuthError::Cancelled) // 表示取消/中断
            }
            Err(_timeout_err) => {
                // 等待 channel 超时
                let removed = task_pending_auth_state
                    .lock()
                    .unwrap()
                    .remove(&task_state)
                    .is_some();
                if removed {
                    println!("Auth Task [{}]: 等待 code 超时。State 已移除。", task_state);
                } else {
                    println!("Auth Task [{}]: 超时，但 state 已被移除。", task_state);
                }
                Err(AuthError::CallbackTimeout)
            }
        };

        // --- 处理结果 (交换 code, 获取 Profile, 同步, 发出事件) ---
        let final_result: Result<(), AuthError> = async {
            let code = code_result?; // 传播错误
            println!("Auth Task [{}]: 正在用 code 交换 token...", task_state);
            let token_info = exchange_code_for_token(&code).await?;
            println!("Auth Task [{}]: 正在获取 GitHub profile...", task_state);
            let profile = fetch_github_user_profile(&token_info.access_token).await?;
            println!(
                "Auth Task [{}]: 已为 '{}' 获取 Profile",
                task_state, profile.login
            );
            println!("Auth Task [{}]: 正在将 profile 同步到后端...", task_state);
            sync_user_profile_to_backend(&profile).await?;
            println!("Auth Task [{}]: 身份验证成功。正在发出事件。", task_state);
            task_app_handle.emit(
                "github_auth_success",
                Some(serde_json::json!({
                    "profile": profile
                })),
            )?; // 使用 ? 传播 emit 错误
            Ok(())
        }
        .await;

        // --- 处理最终结果 (错误发出, State 移除) ---
        if let Err(final_err) = final_result {
            eprintln!(
                "Auth Task [{}]: 身份验证流程失败: {:?}",
                task_state, final_err
            );
            match final_err {
                AuthError::CallbackTimeout
                | AuthError::InvalidState
                | AuthError::DeepLinkError(_)
                | AuthError::Cancelled => (), // State 在别处处理或不适用
                _ => {
                    // 其他错误时移除 state
                    if task_pending_auth_state
                        .lock()
                        .unwrap()
                        .remove(&task_state)
                        .is_some()
                    {
                        println!(
                            "Auth Task [{}]: 由于错误 {:?}，State 已移除。",
                            task_state, final_err
                        );
                    }
                }
            }
            let _ = task_app_handle.emit("github_auth_error", Some(final_err));
        }
        // --- 条件性：关闭开发服务器 ---
        #[cfg(debug_assertions)]
        {
            if let Some(task_server_state) = task_app_handle.try_state::<AuthServerState>() {
                println!("Auth Task [{}]: 请求关闭开发服务器...", task_state);
                shutdown_dev_server(task_server_state.inner().clone()).await;
            } else {
                eprintln!(
                    "Auth Task [{}]: 无法获取 AuthServerState 来关闭服务器。",
                    task_state
                );
            }
        }
        println!("Auth Task [{}]: 完成。", task_state);
    }); // tokio::spawn 结束

    // --- 立即返回 Auth URL ---
    println!("Auth: 将 auth URL 返回给前端。");
    Ok(auth_url) // 返回 URL 供前端打开
}

// --- === 开发服务器特定代码 (仅在 debug 构建时编译) === ---

#[cfg(debug_assertions)]
async fn start_dev_server<R: Runtime>(
    app_handle: AppHandle<R>,
    pending_state_clone: PendingAuthState, // Arc<StdMutex<...>>
    server_state_clone: AuthServerState,   // Arc<TokioMutex<...>>
) -> Result<(), AuthError> {
    let mut server_handle_guard = server_state_clone.lock().await; // 锁定服务器状态

    if server_handle_guard.join_handle.is_some() {
        println!("Auth [Debug]: 服务器已在运行。");
        return Ok(());
    }

    let addr_str = get_redirect_uri();
    let addr = match addr_str.parse::<http::Uri>() {
        Ok(uri) => {
            let host = uri.host().unwrap_or("127.0.0.1");
            let port = uri.port_u16().unwrap_or(54321);
            let ip = match host.parse::<std::net::IpAddr>() {
                Ok(ip_addr) => ip_addr,
                Err(_) => {
                    if host == "localhost" {
                        [127, 0, 0, 1].into()
                    } else {
                        eprintln!("Auth [Debug]: 解析主机 '{}' 失败, 默认为 127.0.0.1", host);
                        [127, 0, 0, 1].into()
                    }
                }
            };
            SocketAddr::new(ip, port)
        }
        Err(_) => {
            eprintln!(
                "Auth [Debug]: 解析重定向 URI '{}' 失败, 默认为 127.0.0.1:54321",
                addr_str
            );
            SocketAddr::from(([127, 0, 0, 1], 54321))
        }
    };

    println!("Auth [Debug]: 尝试将服务器绑定到 {}", addr);
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            let err_msg = format!("绑定到 {} 失败: {}", addr, e);
            eprintln!("Auth [Debug]: {}", err_msg);
            // 出于某种原因，在 start_dev_server 内部直接使用原始 app_handle 发出事件
            // 有时会导致奇怪的生命周期或借用问题，尤其是在复杂的异步场景或测试中。
            // 克隆 app_handle (或只克隆 emitter) 可以帮助解决这些问题。
            let emitter = app_handle.clone(); // 克隆 AppHandle 以便在错误路径中使用
            let _ = emitter.emit(
                // 使用克隆的 emitter
                "github_auth_error",
                Some(AuthError::ServerStartError(err_msg.clone())),
            );
            return Err(AuthError::ServerStartError(err_msg));
        }
    };

    let (internal_shutdown_tx, internal_shutdown_rx) = oneshot::channel::<()>();

    let app_router = Router::new()
        .route("/callback", get(github_callback_handler))
        .with_state(pending_state_clone); // 共享 pending state

    let server_config = axum::serve(listener, app_router.into_make_service())
        .with_graceful_shutdown(async {
            internal_shutdown_rx.await.ok();
            println!("Auth [Debug]: 回调服务器收到关闭信号。");
        });

    println!("Auth [Debug]: 回调服务器正在监听 {}", addr);

    let task_server_state_clone = server_state_clone.clone();
    let server_task = tokio::spawn(async move {
        if let Err(e) = server_config.await {
            eprintln!("Auth [Debug]: 服务器错误: {}", e);
        } else {
            println!("Auth [Debug]: 服务器任务优雅地完成。");
        }
        let mut guard = task_server_state_clone.lock().await;
        guard.shutdown_tx = None;
        guard.join_handle = None; // 清理状态
        println!("Auth [Debug]: 服务器句柄状态已清理。");
    });

    server_handle_guard.shutdown_tx = Some(internal_shutdown_tx);
    server_handle_guard.join_handle = Some(server_task);
    println!("Auth [Debug]: 服务器已启动，关闭 sender 和 join handle 已存储。");

    Ok(())
}

#[cfg(debug_assertions)]
async fn shutdown_dev_server(server_state: AuthServerState) {
    let server_task_join_handle: Option<tokio::task::JoinHandle<()>>;
    {
        let mut guard = server_state.lock().await;
        if let Some(tx) = guard.shutdown_tx.take() {
            println!("Auth [Debug]: 正在向服务器发送关闭信号...");
            let _ = tx.send(());
            server_task_join_handle = guard.join_handle.take();
            println!("Auth [Debug]: 关闭信号已发送。");
        } else {
            println!("Auth [Debug]: 服务器已关闭或句柄丢失。");
            return;
        }
    }

    if let Some(handle) = server_task_join_handle {
        println!("Auth [Debug]: 等待服务器任务完成...");
        match tokio::time::timeout(std::time::Duration::from_secs(5), handle).await {
            Ok(Ok(_)) => println!("Auth [Debug]: 服务器任务成功加入。"),
            Ok(Err(e)) => eprintln!("Auth [Debug]: 服务器任务 panicked 或以错误结束: {}", e),
            Err(_) => eprintln!("Auth [Debug]: 等待服务器任务完成超时。"),
        }
    } else {
        println!("Auth [Debug]: 未找到要加入的服务器任务句柄。");
    }
}
// Axum 回调处理器 (仅在 debug 构建中编译)
#[cfg(debug_assertions)]
async fn github_callback_handler(
    Query(params): Query<CallbackParams>,
    AxumState(pending_state): AxumState<PendingAuthState>,
) -> Html<String> {
    println!(
        "Auth [Debug] Callback: 已收到。State: {}, Code: [隐藏]",
        params.state
    );

    let sender = pending_state.lock().unwrap().remove(&params.state);

    match sender {
        Some(tx) => {
            println!("Auth [Debug] Callback: State 匹配。通过 channel 发送 code。");
            let send_result = tx.send(Ok(params.code));
            if send_result.is_err() {
                eprintln!(
                    "Auth [Debug] Callback: Receiver 被丢弃 (任务可能超时/出错)。State: {}",
                    params.state
                );
                return Html( "<html><body><h1>认证错误</h1><p>应用不再等待。超时或取消？关闭并重试。</p></body></html>".to_string() );
            }
            Html( "<html><body><h1>认证成功</h1><p>你可以关闭此窗口。</p><script>window.close();</script></body></html>".to_string() )
        }
        None => {
            eprintln!(
                "Auth [Debug] Callback: 收到无效或过期的 state: {}",
                params.state
            );
            Html(
                "<html><body><h1>认证失败</h1><p>无效/过期的 state。关闭并重试。</p></body></html>"
                    .to_string(),
            )
        }
    }
}
// --- === 核心 API 交互逻辑 (通过访问器使用嵌入式配置，带日志) === ---
// 用授权码交换访问令牌
async fn exchange_code_for_token(code: &str) -> Result<GithubTokenResponse, AuthError> {
    let client = reqwest::Client::new();
    let redirect_uri = get_redirect_uri();
    // 使用访问器获取编译时嵌入的值
    let github_client_id = get_github_client_id();
    let github_client_secret = get_github_client_secret();

    // 记录用于请求的参数
    println!(
        "Auth: 正在交换 code。使用的 Client ID: '{}'",
        github_client_id
    );
    let secret_len = github_client_secret.len();
    let masked_secret = if secret_len > 4 {
        format!("***{}", &github_client_secret[secret_len - 4..])
    } else {
        "***".to_string()
    };
    println!(
        "Auth: 正在交换 code。使用的 Client Secret: '{}'",
        masked_secret
    );
    println!(
        "Auth: 正在交换 code。使用的 Redirect URI: '{}'",
        redirect_uri
    );
    println!("Auth: 正在交换 code。使用的 Code: [隐藏]"); // 不要记录 code 本身

    let params = [
        ("client_id", github_client_id),
        ("client_secret", github_client_secret),
        ("code", code),
        ("redirect_uri", redirect_uri),
    ];

    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "Tauri GitHub Auth (Rust)")
        .form(&params)
        .send()
        .await?;

    if response.status().is_success() {
        let token_response = response
            .json::<GithubTokenResponse>()
            .await
            .map_err(|e| AuthError::ParseError(format!("解析 token 响应失败: {}", e)))?;
        if token_response.access_token.is_empty() {
            eprintln!("Auth: Token 交换成功但收到空的 access token。");
            Err(AuthError::GitHubError(
                "从 GitHub 收到空的 access token".to_string(),
            ))
        } else {
            println!("Auth: Token 交换成功。");
            Ok(token_response)
        }
    } else {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "读取错误体失败".to_string());
        eprintln!("Auth: GitHub token 交换错误 ({}): {}", status, error_text);
        Err(AuthError::GitHubError(format!(
            "交换 code 失败 (status {}): {}",
            status, error_text
        )))
    }
}
// 使用访问令牌从 GitHub API 获取用户个人资料
async fn fetch_github_user_profile(access_token: &str) -> Result<GithubUserProfile, AuthError> {
    let client = reqwest::Client::new();
    println!("Auth: 正在使用 token 获取 GitHub profile: Bearer ***"); // 不要记录 token

    let response = client
        .get("https://api.github.com/user")
        .header(AUTHORIZATION, format!("Bearer {}", access_token)) // 使用 Bearer token 认证
        .header(USER_AGENT, "Tauri GitHub Auth (Rust)")
        .send()
        .await?;

    if response.status().is_success() {
        let profile = response
            .json::<GithubUserProfile>()
            .await
            .map_err(|e| AuthError::ParseError(format!("解析 GitHub 用户 profile 失败: {}", e)))?;
        println!("Auth: 用户 profile 为 {} 获取成功。", profile.login);
        Ok(profile)
    } else {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "读取错误体失败".to_string());
        eprintln!("Auth: GitHub profile 获取错误 ({}): {}", status, error_text);
        Err(AuthError::GitHubError(format!(
            "获取用户 profile 失败 (status {}): {}",
            status, error_text
        )))
    }
}
// 将获取到的 GitHub profile 发送到你的后端 worker/API
async fn sync_user_profile_to_backend(profile: &GithubUserProfile) -> Result<(), AuthError> {
    println!("Auth: 尝试为用户 ID {} 进行后端同步", profile.id);
    let client = reqwest::Client::new();
    let payload = BackendSyncPayload { profile };

    // 使用访问器获取后端 API 的编译时嵌入值
    let temp_url = get_worker_api_url();
    let worker_api_url = format!("{}/sync-user", temp_url); // 假设后端同步端点是 /sync-user
    let worker_api_key = get_worker_api_key();

    println!("Auth: 同步到后端 URL: {}", worker_api_url);
    let key_len = worker_api_key.len();
    let masked_key = if key_len > 4 {
        format!("***{}", &worker_api_key[key_len - 4..])
    } else {
        "***".to_string()
    };
    println!("Auth: 使用后端 API Key 进行同步: {}", masked_key);

    let response = client
        .post(worker_api_url)
        .header(AUTHORIZATION, format!("Bearer {}", worker_api_key))
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, "Tauri Backend Sync (Rust)")
        .json(&payload)
        .send()
        .await?;

    let status = response.status();
    println!("Auth: 后端同步响应状态: {}", status);

    if status.is_success() {
        match response.json::<BackendSyncResponse>().await {
            Ok(sync_response) => {
                if sync_response.success {
                    println!("Auth: 后端同步报告成功。");
                    Ok(())
                } else {
                    let err_msg = format!(
                        "后端报告同步失败: {}",
                        sync_response.message.unwrap_or_default()
                    );
                    eprintln!("Auth: {}", err_msg);
                    Err(AuthError::BackendSyncFailed(err_msg))
                }
            }
            Err(e) => {
                let err_msg = format!("解析成功的后端同步响应失败: {}", e);
                eprintln!("Auth: {}", err_msg);
                Err(AuthError::ParseError(err_msg)) // 将解析错误视为后端失败
            }
        }
    } else {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| format!("HTTP 错误 {}", status));
        let err_msg = format!("后端 API 返回错误 (status {}): {}", status, error_text);
        eprintln!("Auth: {}", err_msg);
        Err(AuthError::BackendSyncFailed(err_msg))
    }
}

// --- Rust 白盒测试模块 ---
#[cfg(test)]
mod tests {
    use super::*; // 导入父模块 (auth.rs) 中的项

    // 用于测试的辅助函数，创建预期的 EnvConfig
    fn create_expected_config(id: &str, secret: &str, url: &str, key: &str) -> EnvConfig {
        EnvConfig {
            github_client_id: id.to_string(),
            github_client_secret: secret.to_string(),
            worker_api_url: url.to_string(),
            worker_api_key: key.to_string(),
        }
    }

    #[test]
    fn test_parse_valid_env_content_no_quotes() {
        let content = "
GITHUB_CLIENT_ID=id123
GITHUB_CLIENT_SECRET=secretABC
WORKER_API_URL=http://localhost:8787
WORKER_API_KEY=workerkeyXYZ
# 这是一个注释
        ";
        let expected = create_expected_config(
            "id123",
            "secretABC",
            "http://localhost:8787",
            "workerkeyXYZ",
        );
        assert_eq!(
            parse_env_content(content).unwrap(),
            expected,
            "不带引号的有效内容解析失败"
        );
    }

    #[test]
    fn test_parse_valid_env_content_with_quotes() {
        let content = r#"
GITHUB_CLIENT_ID="id123"
GITHUB_CLIENT_SECRET='secretABC'
WORKER_API_URL="http://localhost:8787"
WORKER_API_KEY = " worker_key_with_spaces_inside " # 这个会被修剪然后去引号
EXTRA_VAR=some_other_value
        "#;
        // 注意: WORKER_API_KEY 引号内的前后空格会被保留
        // 提供的解析逻辑:
        // 1. 修剪值周围的空白: `value.trim()` -> `" worker_key_with_spaces_inside "`
        // 2. 剥离引号: `&value_initially_trimmed[1..len-1]` -> ` worker_key_with_spaces_inside `
        let expected = create_expected_config(
            "id123",
            "secretABC",
            "http://localhost:8787",
            " worker_key_with_spaces_inside ", // 引号内的空格被保留
        );
        assert_eq!(
            parse_env_content(content).unwrap(),
            expected,
            "带引号的有效内容解析失败"
        );
    }

    #[test]
    fn test_parse_env_content_strips_outer_whitespace_then_quotes() {
        let content = r#"
GITHUB_CLIENT_ID = "  id123  "
GITHUB_CLIENT_SECRET = ' secretABC '
WORKER_API_URL = http://localhost:8787
WORKER_API_KEY =    workerkeyXYZ
        "#;
        let expected = create_expected_config(
            "  id123  ",   // 引号内的空格被保留
            " secretABC ", // 引号内的空格被保留
            "http://localhost:8787",
            "workerkeyXYZ",
        );
        assert_eq!(
            parse_env_content(content).unwrap(),
            expected,
            "外部空格和引号处理不当"
        );
    }

    #[test]
    fn test_parse_missing_required_key() {
        let content = "
GITHUB_CLIENT_SECRET=secretABC
WORKER_API_URL=http://localhost:8787
WORKER_API_KEY=workerkeyXYZ
        ";
        match parse_env_content(content) {
            Err(ConfigParseError::MissingKey(key)) => {
                assert_eq!(key, "GITHUB_CLIENT_ID", "错误的缺失键报告")
            }
            Ok(_) => panic!("本应因缺少键而失败"),
            Err(e) => panic!("未预期的错误类型: {:?}", e),
        }
    }

    #[test]
    fn test_parse_empty_value_for_required_key() {
        let content = "
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=secretABC
WORKER_API_URL=http://localhost:8787
WORKER_API_KEY=workerkeyXYZ
        ";
        match parse_env_content(content) {
            Err(ConfigParseError::EmptyValue(key)) => {
                assert_eq!(key, "GITHUB_CLIENT_ID", "错误的空值键报告")
            }
            Ok(_) => panic!("本应因空值而失败"),
            Err(e) => panic!("未预期的错误类型: {:?}", e),
        }
    }

    #[test]
    fn test_parse_empty_value_with_quotes_for_required_key() {
        let content = r#"
GITHUB_CLIENT_ID="" 
GITHUB_CLIENT_SECRET=secretABC
WORKER_API_URL=http://localhost:8787
WORKER_API_KEY=workerkeyXYZ
        "#;
        // 当前逻辑会剥离引号，留下空字符串，然后空值检查失败。
        match parse_env_content(content) {
            Err(ConfigParseError::EmptyValue(key)) => {
                assert_eq!(key, "GITHUB_CLIENT_ID", "带引号的空值处理不当")
            }
            Ok(_) => panic!("本应因剥离引号后值为空而失败"),
            Err(e) => panic!("未预期的错误类型: {:?}", e),
        }
    }

    #[test]
    fn test_parse_malformed_line() {
        let content = "
GITHUB_CLIENT_ID id123_no_equals_sign
GITHUB_CLIENT_SECRET=secretABC
WORKER_API_URL=http://localhost:8787
WORKER_API_KEY=workerkeyXYZ
        ";
        match parse_env_content(content) {
            Err(ConfigParseError::MalformedLine(line_num, line_content)) => {
                assert_eq!(line_num, 2, "错误的行号报告"); // 行号在错误中是1开始的
                assert_eq!(
                    line_content, "GITHUB_CLIENT_ID id123_no_equals_sign",
                    "错误的行内容报告"
                );
            }
            Ok(_) => panic!("本应因格式错误的行而失败"),
            Err(e) => panic!("未预期的错误类型: {:?}", e),
        }
    }

    #[test]
    fn test_parse_empty_content() {
        let content = "";
        // 期望对它检查的第一个键报告 MissingKey
        match parse_env_content(content) {
            Err(ConfigParseError::MissingKey(key)) => {
                assert_eq!(key, "GITHUB_CLIENT_ID", "空内容应报告缺失键")
            }
            Ok(_) => panic!("本应因缺少键而失败"),
            Err(e) => panic!("未预期的错误类型: {:?}", e),
        }
    }

    #[test]
    fn test_parse_only_comments_and_empty_lines() {
        let content = "
# 这是一个注释
\n   \n
# 另一个注释
        ";
        match parse_env_content(content) {
            Err(ConfigParseError::MissingKey(key)) => {
                assert_eq!(key, "GITHUB_CLIENT_ID", "只有注释和空行应报告缺失键")
            }
            Ok(_) => panic!("本应因缺少键而失败"),
            Err(e) => panic!("未预期的错误类型: {:?}", e),
        }
    }

    #[test]
    fn test_config_accessor_functions_after_successful_parse() {
        // 这个测试依赖于 CONFIG 静态变量的初始化。
        // 它会使用实际的 .env.development 或 .env.production 文件。
        // 因此，请确保你的 .env.development (如果运行 `cargo test`) 具有有效值。
        // 这更像是一个针对访问器与静态 CONFIG 的集成测试，但有总比没有好。

        // 为了使这个测试更独立于实际的 .env 文件 (尽管 CONFIG 编译时仍需要它们)，
        // 我们实际上是测试访问器简单地返回 `CONFIG` 所持有的内容。

        // 当这些访问器函数首次被调用时，CONFIG 静态变量会基于你的实际 .env 文件进行初始化。
        // 我们无法轻易地为 *这个特定的测试函数* 更改 CONFIG 加载的内容。
        // 我们 *能够* 验证的是，如果 CONFIG 初始化了，访问器会返回其字段。
        // 这是一个简单的测试，因为访问器本身很简单。

        // 如果 .env.development 和 .env.production 不存在，或者为了控制测试值，可以创建虚拟文件。
        // 对于 CI，你可能需要在运行测试前创建这些文件。
        // 在这个例子中，我们假设它们存在且可解析。

        // 触发 CONFIG 的初始化 (如果尚未完成)
        // 如果 `parse_env_content` 失败 (例如，.env 文件缺失或格式错误)，这里会 panic。
        // 为了使测试更健壮，实际项目中你可能需要确保测试环境中有有效的 .env 文件，
        // 或者使用更复杂的 mocking/setup。
        if get_github_client_id().is_empty()
            && get_github_client_secret().is_empty()
            && get_worker_api_url().is_empty()
            && get_worker_api_key().is_empty()
        {
            // 这表明 CONFIG 可能由于某种原因未能成功加载任何值
            // (例如，真实的 .env 文件内容为空或者 include_str! 失败但编译通过)
            // 这种情况下，下面的断言会失败，这其实是期望的行为。
            // 另一种选择是，如果CONFIG初始化失败，Lazy会panic，测试根本不会执行到这里。
        }

        // 现在检查访问器
        // 如果你的 .env 文件能被 `parse_env_content` 解析，并且包含这些键的非空值，
        // 这些断言将会通过。
        assert!(
            !get_github_client_id().is_empty(),
            "GITHUB_CLIENT_ID 应该已加载且不为空"
        );
        assert!(
            !get_github_client_secret().is_empty(),
            "GITHUB_CLIENT_SECRET 应该已加载且不为空"
        );
        assert!(
            !get_worker_api_url().is_empty(),
            "WORKER_API_URL 应该已加载且不为空"
        );
        assert!(
            !get_worker_api_key().is_empty(),
            "WORKER_API_KEY 应该已加载且不为空"
        );

        // 如果你知道 .env.development (假设是 debug 构建进行测试) 中的预期值，
        // 你可以直接断言它们，但这会使测试在 .env 文件更改时变得脆弱。
        // 例如，如果 .env.development 中有 GITHUB_CLIENT_ID=test_dev_id
        // if cfg!(debug_assertions) {
        //     assert_eq!(get_github_client_id(), "test_dev_id");
        // }
    }
}
