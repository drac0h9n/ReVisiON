// src-tauri/src/auth.rs
// 移除 Lazy 导入，因为不再需要它来读取环境变量
// use once_cell::sync::Lazy;
use rand::distr::Alphanumeric;
use rand::{thread_rng, Rng};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex}; // Use StdMutex for PendingAuthState
use tauri::{AppHandle, Emitter, Manager, Runtime, State}; // Ensure Manager is imported
use thiserror::Error;
use tokio::sync::{oneshot, Mutex as TokioMutex};
use urlencoding;

// --- Conditional Imports for Dev Server ---
#[cfg(debug_assertions)]
use axum::{
    extract::{Query, State as AxumState},
    response::Html,
    routing::get,
    Router, http,
};
#[cfg(debug_assertions)]
use std::net::SocketAddr;

// --- Configuration ---
// 使用 env! 宏在编译时直接读取环境变量
// 警告：这会将 Secret 直接编译进二进制文件！
// 如果编译时环境变量未设置，编译将会失败！
const GITHUB_CLIENT_ID: &str = env!("GITHUB_CLIENT_ID");
const GITHUB_CLIENT_SECRET: &str = env!("GITHUB_CLIENT_SECRET");

// --- Dynamic Redirect URI based on build type ---
// 这个保持不变，因为它依赖于编译配置而非环境变量
fn get_redirect_uri() -> &'static str {
    if cfg!(debug_assertions) {
        "http://127.0.0.1:54321/callback" // Development: Local server
    } else {
        "revision://github/callback" // Production: Use YOUR custom scheme "revision"
    }
}

const CSRF_STATE_EXPIRY_SECS: u64 = 300; // 5 minutes

// --- Backend Worker Configuration ---
// 使用 env! 宏在编译时直接读取环境变量
// 警告：这会将 API Key 和 URL 直接编译进二进制文件！
// 如果编译时环境变量未设置，编译将会失败！
const WORKER_API_URL: &str = env!("WORKER_API_URL");
const WORKER_API_KEY: &str = env!("WORKER_API_KEY");

// --- State Management ---

// Shared state for pending requests (used by both dev server and deep link handler)
pub type PendingAuthState = Arc<StdMutex<HashMap<String, oneshot::Sender<Result<String, AuthError>>>>>;

// --- Dev Server Specific State ---
#[cfg(debug_assertions)]
#[derive(Default)]
pub struct ServerHandle {
   pub shutdown_tx: Option<oneshot::Sender<()>>,
   pub join_handle: Option<tokio::task::JoinHandle<()>>,
}
#[cfg(debug_assertions)]
pub type AuthServerState = Arc<TokioMutex<ServerHandle>>; // TokioMutex needed for async locking around start/stop

// --- Data Structures ---
#[derive(Deserialize, Debug)]
struct CallbackParams {
    code: String,
    state: String,
}

#[derive(Deserialize, Debug)]
struct GithubTokenResponse {
    access_token: String,
    scope: String,
    token_type: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GithubUserProfile {
    login: String,
    id: u64,
    name: Option<String>,
    avatar_url: String,
    email: Option<String>,
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

// --- Error Handling ---
#[derive(Serialize, Debug, Clone, Error)]
pub enum AuthError {
    #[error("Network request failed: {0}")]
    ReqwestError(String),
    #[cfg(debug_assertions)]
    #[error("Failed to start local callback server: {0}")]
    ServerStartError(String),
    #[error("Invalid CSRF state received")]
    InvalidState,
    #[error("GitHub returned an error: {0}")]
    GitHubError(String),
    #[error("Callback timed out or was cancelled")]
    CallbackTimeout,
    #[error("Failed to parse response: {0}")]
    ParseError(String),
    #[error("Internal error: {0}")]
    InternalError(String),
    #[error("Authentication cancelled by user or system")]
    Cancelled,
    #[error("Failed to sync user data to backend: {0}")]
    BackendSyncFailed(String),
    #[error("Deep link error: {0}")]
    DeepLinkError(String),
}

impl From<reqwest::Error> for AuthError {
    fn from(err: reqwest::Error) -> Self {
        AuthError::ReqwestError(err.to_string())
    }
}

// --- Tauri Command ---
#[tauri::command]
pub async fn login_with_github<R: Runtime>(
    app: AppHandle<R>,
    pending_auth_state: State<'_, PendingAuthState>,
) -> Result<String, String> { // Returns GitHub Auth URL or an error string
    println!("Auth: Initiating GitHub OAuth flow...");

    // --- Determine Redirect URI ---
    let redirect_uri = get_redirect_uri();
    println!("Auth: Using redirect URI: {}", redirect_uri);

    // --- Common Logic: State and Channel ---
    let state: String = thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    let (code_tx, code_rx) = oneshot::channel::<Result<String, AuthError>>();

    // --- Conditional: Start Dev Server ---
    #[cfg(debug_assertions)]
    {
        // Get the server state ONLY in debug builds using try_state
        if let Some(server_state) = app.try_state::<AuthServerState>() {
             println!("Auth [Debug]: Attempting to start local callback server...");
             let server_start_result = start_dev_server(
                 app.clone(),
                 pending_auth_state.inner().clone(),
                 server_state.inner().clone() // Pass the Arc<TokioMutex<...>>
             ).await;

             if let Err(e) = server_start_result {
                 println!("Auth [Debug]: Failed to start server: {:?}", e);
                 let _ = app.emit("github_auth_error", Some(e.clone()));
                 return Err(e.to_string());
             }
             println!("Auth [Debug]: Local callback server running or already started.");

        } else {
            // This case should ideally not happen if main.rs manages the state correctly in debug
            let err = AuthError::InternalError("AuthServerState not managed in debug build".to_string());
             println!("Auth [Debug]: Error - {}", err);
             let _ = app.emit("github_auth_error", Some(err.clone()));
             return Err(err.to_string());
        }
    } // End #[cfg(debug_assertions)] block for starting server

    // --- Store state and sender *before* returning URL (Common Logic) ---
    {
        let mut pending_map = pending_auth_state.lock().expect("Failed to lock pending auth state");
        pending_map.insert(state.clone(), code_tx);
        println!("Auth: State '{}' stored. Ready for callback/deep link.", state);
    }

    // --- Build GitHub Authorization URL (Common Logic) ---
    // 使用编译时常量 GITHUB_CLIENT_ID
    let auth_url = format!(
        "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&scope={}&state={}",
        GITHUB_CLIENT_ID, // 直接使用常量
        urlencoding::encode(redirect_uri),
        urlencoding::encode("read:user user:email"),
        state.clone()
    );

    // --- Spawn the Task to Wait for Callback/Deep Link and Handle Flow (Common Logic) ---
    let task_app_handle = app.clone();
    let task_pending_auth_state = pending_auth_state.inner().clone();
    let task_state = state.clone();

    tokio::spawn(async move { // This is the "Authentication Processing Task"
        println!("Auth Task [{}]: Spawned. Waiting for callback/deep link...", task_state);

        // --- Wait for callback/deep link or timeout ---
        let code_result = match tokio::time::timeout(
            std::time::Duration::from_secs(CSRF_STATE_EXPIRY_SECS),
            code_rx, // Wait on the receiver end of the oneshot channel
        )
        .await
        {
            Ok(Ok(code_res)) => { // Received from channel successfully
                println!("Auth Task [{}]: Code received via channel.", task_state);
                code_res // Result<String, AuthError>
            },
            Ok(Err(_rx_err)) => { // Channel sender was dropped
                eprintln!("Auth Task [{}]: Callback/Deep Link sender dropped.", task_state);
                Err(AuthError::CallbackTimeout) // Simulate timeout as the flow was interrupted
            }
            Err(_timeout_err) => { // Timeout waiting for channel
                 let removed = task_pending_auth_state.lock().unwrap().remove(&task_state).is_some();
                 if removed {
                    println!("Auth Task [{}]: Timed out waiting for code. State removed.", task_state);
                 } else {
                    println!("Auth Task [{}]: Timed out, but state was already removed (likely invalid state received).", task_state);
                 }
                Err(AuthError::CallbackTimeout)
            }
        };

         // --- Process Result (Exchange code, Get Profile, Sync, Emit events) ---
        let final_result: Result<(), AuthError> = async {
            let code = code_result?; // Propagate error (Timeout, InvalidState from channel, etc.)
            println!("Auth Task [{}]: Exchanging code for token...", task_state);
            // exchange_code_for_token 内部会使用编译时常量 GITHUB_CLIENT_SECRET
            let token_info = exchange_code_for_token(&code).await?;
            println!("Auth Task [{}]: Fetching GitHub profile...", task_state);
            let profile = fetch_github_user_profile(&token_info.access_token).await?;
            println!("Auth Task [{}]: Profile fetched for '{}'", task_state, profile.login);

            println!("Auth Task [{}]: Syncing profile to backend...", task_state);
            // sync_user_profile_to_backend 内部会使用编译时常量 WORKER_API_URL 和 WORKER_API_KEY
            sync_user_profile_to_backend(&profile).await?; // Propagates BackendSyncFailed or ReqwestError

            println!("Auth Task [{}]: Authentication successful. Emitting event.", task_state);
            task_app_handle.emit(
                "github_auth_success",
                Some(serde_json::json!({ "profile": profile })),
            ).expect("Failed to emit success event");

            Ok(())
        }.await;

        // --- Handle Final Result (Error Emission, State Removal) ---
        if let Err(final_err) = final_result {
            eprintln!("Auth Task [{}]: Authentication flow failed: {:?}", task_state, final_err);
             // Ensure state is removed on errors other than timeout/invalid state (which handle removal themselves)
             match final_err {
                 AuthError::CallbackTimeout | AuthError::InvalidState | AuthError::DeepLinkError(_) => (),
                 _ => {
                    // Remove state in case of GitHub API errors, Backend Sync errors, etc.
                    if task_pending_auth_state.lock().unwrap().remove(&task_state).is_some() {
                       println!("Auth Task [{}]: State removed due to error: {:?}", task_state, final_err);
                    }
                 }
             }
            let _ = task_app_handle.emit("github_auth_error", Some(final_err)); // Emit specific error
        }

        // --- Conditional: Shutdown Dev Server ---
        // Retrieve the state conditionally again inside the task
        #[cfg(debug_assertions)]
        {
            if let Some(task_server_state) = task_app_handle.try_state::<AuthServerState>() {
                println!("Auth Task [{}]: Requesting dev server shutdown...", task_state);
                // Pass the Arc<TokioMutex<...>> to shutdown_dev_server
                shutdown_dev_server(task_server_state.inner().clone()).await;
            } else {
                 eprintln!("Auth Task [{}]: Could not get AuthServerState to shut down server.", task_state);
            }
        } // End #[cfg(debug_assertions)] block for shutting down server

        println!("Auth Task [{}]: Finished.", task_state);
    }); // End of tokio::spawn for the "Authentication Processing Task"

    // --- Return the Auth URL immediately (Common Logic) ---
    println!("Auth: Returning auth URL to frontend. Background task will handle the rest.");
    Ok(auth_url)
}

// --- === DEV SERVER SPECIFIC CODE === ---

#[cfg(debug_assertions)]
async fn start_dev_server<R: Runtime>(
    app_handle: AppHandle<R>,
    pending_state_clone: PendingAuthState, // Arc<StdMutex<...>>
    server_state_clone: AuthServerState,   // Arc<TokioMutex<...>> - Still accepted here
) -> Result<(), AuthError> {
    let mut server_handle_guard = server_state_clone.lock().await;

    if server_handle_guard.shutdown_tx.is_some() {
         println!("Auth [Debug]: Server already running.");
         return Ok(());
    }

    let addr_str = get_redirect_uri(); // Still use function to get dev URI
    let addr = match addr_str.parse::<http::Uri>() {
         Ok(uri) => match uri.authority() {
             Some(auth) => SocketAddr::from(([127, 0, 0, 1], auth.port_u16().unwrap_or(54321))),
             None => SocketAddr::from(([127, 0, 0, 1], 54321)),
         },
         Err(_) => SocketAddr::from(([127, 0, 0, 1], 54321)),
     };

     println!("Auth [Debug]: Attempting to bind server to {}", addr);
     let listener = match tokio::net::TcpListener::bind(addr).await {
         Ok(l) => l,
         Err(e) => {
             let err_msg = format!("Failed to bind to {}: {}", addr, e);
             eprintln!("Auth [Debug]: {}", err_msg);
             let _ = app_handle.emit("github_auth_error", Some(AuthError::ServerStartError(err_msg.clone())));
             return Err(AuthError::ServerStartError(err_msg));
         }
     };

     let (internal_shutdown_tx, internal_shutdown_rx) = oneshot::channel::<()>();

     let app_router = Router::new()
         .route("/callback", get(github_callback_handler))
         .with_state(pending_state_clone); // Pass Arc<StdMutex<...>>

     let server_config = axum::serve(listener, app_router.into_make_service())
         .with_graceful_shutdown(async {
             internal_shutdown_rx.await.ok();
             println!("Auth [Debug]: Callback server received shutdown signal.");
         });

     println!("Auth [Debug]: Callback server listening on {}", addr);

     let task_server_state_clone = server_state_clone.clone();
     let server_task = tokio::spawn(async move {
         if let Err(e) = server_config.await {
             eprintln!("Auth [Debug]: Server error: {}", e);
         } else {
             println!("Auth [Debug]: Server task finished gracefully.");
         }
         let mut guard = task_server_state_clone.lock().await;
         guard.shutdown_tx = None;
         guard.join_handle = None;
         println!("Auth [Debug]: Server handle state cleared.");
     });

     server_handle_guard.shutdown_tx = Some(internal_shutdown_tx);
     server_handle_guard.join_handle = Some(server_task);
     println!("Auth [Debug]: Server started, shutdown sender and join handle stored.");

     Ok(())
 }

#[cfg(debug_assertions)]
async fn shutdown_dev_server(server_state: AuthServerState) { // Still accepted here
    let server_task_join_handle: Option<tokio::task::JoinHandle<()>>;
    {
        let mut guard = server_state.lock().await;
        if let Some(tx) = guard.shutdown_tx.take() {
            println!("Auth [Debug]: Sending shutdown signal to server...");
             let _ = tx.send(());
             server_task_join_handle = guard.join_handle.take();
        } else {
            println!("Auth [Debug]: Server already shut down or handle missing.");
            return;
        }
    }

    if let Some(handle) = server_task_join_handle {
        println!("Auth [Debug]: Waiting for server task to finish...");
        match tokio::time::timeout(std::time::Duration::from_secs(5), handle).await {
            Ok(Ok(_)) => println!("Auth [Debug]: Server task joined successfully."),
            Ok(Err(e)) => eprintln!("Auth [Debug]: Server task panicked or finished with error: {}", e),
            Err(_) => eprintln!("Auth [Debug]: Timed out waiting for server task to finish."),
       }
    }
}

// Axum Callback Handler (Only compiled in debug builds)
#[cfg(debug_assertions)]
async fn github_callback_handler(
    Query(params): Query<CallbackParams>,
    AxumState(pending_state): AxumState<PendingAuthState>,
) -> Html<String> {
    println!("Auth [Debug] Callback: Received. State: {}, Code: [hidden]", params.state);

     let sender = pending_state.lock().unwrap().remove(&params.state);

     match sender {
         Some(tx) => {
             println!("Auth [Debug] Callback: State matched. Sending code via channel.");
             let send_result = tx.send(Ok(params.code));
             if send_result.is_err() {
                 eprintln!("Auth [Debug] Callback: Receiver dropped (Task likely timed out or errored). State: {}", params.state);
                 return Html(
                    "<html><body><h1>Authentication Error</h1><p>The application is no longer waiting for this login attempt. It may have timed out. Please try logging in again.</p></body></html>".to_string(),
                 );
             }
             Html(
                 "<html><body><h1>Authentication Successful</h1><p>You can close this window now.</p><script>window.close();</script></body></html>".to_string(),
             )
         }
         None => {
             eprintln!("Auth [Debug] Callback: Invalid or expired state received: {}", params.state);
             Html(
                 "<html><body><h1>Authentication Failed</h1><p>Invalid session state. Please close this window and try logging in again from the application.</p></body></html>".to_string(),
             )
         }
     }
}

// --- === CORE API INTERACTION LOGIC (Constants used here) === ---

async fn exchange_code_for_token(code: &str) -> Result<GithubTokenResponse, AuthError> {
    let client = reqwest::Client::new();
    let redirect_uri = get_redirect_uri(); // Use the function, it handles debug/release difference
    // 直接使用编译时常量 GITHUB_CLIENT_ID 和 GITHUB_CLIENT_SECRET
    let params = [
        ("client_id", GITHUB_CLIENT_ID),
        ("client_secret", GITHUB_CLIENT_SECRET),
        ("code", code),
        ("redirect_uri", redirect_uri),
    ];

    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "Tauri GitHub Auth Example")
        .form(&params) // params 现在是 &[(&str, &str); 4] 类型，可以直接用于 form
        .send()
        .await?;

    if response.status().is_success() {
        let token_response = response.json::<GithubTokenResponse>().await
            .map_err(|e| AuthError::ParseError(format!("Failed to parse token response: {}", e)))?;
        if token_response.access_token.is_empty() {
             Err(AuthError::GitHubError("Received empty access token".to_string()))
        } else {
            println!("Auth: Token exchanged successfully.");
            Ok(token_response)
        }
    } else {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error reading response body".to_string());
        eprintln!("Auth: GitHub token exchange error ({}): {}", status, error_text);
        Err(AuthError::GitHubError(format!(
            "Failed to exchange code (status {}): {}",
            status, error_text
        )))
    }
}

// 这个函数不需要修改，因为它只使用 access_token
async fn fetch_github_user_profile(access_token: &str) -> Result<GithubUserProfile, AuthError> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.github.com/user")
        .header(AUTHORIZATION, format!("Bearer {}", access_token))
        .header(USER_AGENT, "Tauri GitHub Auth Example")
        .send()
        .await?;

     if response.status().is_success() {
        let profile = response.json::<GithubUserProfile>().await
            .map_err(|e| AuthError::ParseError(format!("Failed to parse user profile: {}", e)))?;
        println!("Auth: User profile fetched successfully for {}.", profile.login);
        Ok(profile)
     } else {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error reading response body".to_string());
        eprintln!("Auth: GitHub profile fetch error ({}): {}", status, error_text);
        Err(AuthError::GitHubError(format!(
            "Failed to fetch user profile (status {}): {}",
             status, error_text
        )))
    }
}

async fn sync_user_profile_to_backend(profile: &GithubUserProfile) -> Result<(), AuthError> {
    println!("Auth: Attempting backend sync for user ID: {}", profile.id);
    let client = reqwest::Client::new();
    let payload = BackendSyncPayload { profile };

    // 直接使用编译时常量 WORKER_API_URL 和 WORKER_API_KEY
    let response = client
        .post(WORKER_API_URL) // 使用常量 &str
        .header(AUTHORIZATION, format!("Bearer {}", WORKER_API_KEY)) // 使用常量 &str
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, "Tauri Backend Sync")
        .json(&payload)
        .send()
        .await?;

    let status = response.status();
    println!("Auth: Backend sync response status: {}", status);

    if status.is_success() {
        match response.json::<BackendSyncResponse>().await {
            Ok(sync_response) => {
                if sync_response.success {
                    println!("Auth: Backend sync reported success.");
                    Ok(())
                } else {
                    let err_msg = format!("Backend reported sync failure: {}", sync_response.message.unwrap_or_default());
                    eprintln!("Auth: {}", err_msg);
                    Err(AuthError::BackendSyncFailed(err_msg))
                }
            }
            Err(e) => {
                 let err_msg = format!("Failed to parse successful backend sync response: {}", e);
                 eprintln!("Auth: {}", err_msg);
                 Err(AuthError::ParseError(err_msg))
            }
        }
    } else {
        let error_text = response.text().await.unwrap_or_else(|_| format!("HTTP error {}", status));
        let err_msg = format!("Backend API returned error (status {}): {}", status, error_text);
        eprintln!("Auth: {}", err_msg);
        Err(AuthError::BackendSyncFailed(err_msg))
    }
}