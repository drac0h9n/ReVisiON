use axum::{
    extract::{Query, State as AxumState},
    response::Html,
    routing::get,
    Router,
};
use once_cell::sync::Lazy; // Or load from config/env
use rand::distr::Alphanumeric;
use rand::{thread_rng, Rng};
use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, Runtime, State, Emitter};
use thiserror::Error;
use tokio::sync::{oneshot, Mutex as TokioMutex}; // Use tokio's Mutex for async locking if needed in server
use urlencoding;

// --- Configuration ---
// !! 重要: 不要在生产代码中硬编码这些值 !!
// 建议从环境变量、配置文件或 Tauri 的配置中读取
static GITHUB_CLIENT_ID: Lazy<String> =
    Lazy::new(|| std::env::var("GITHUB_CLIENT_ID").expect("GITHUB_CLIENT_ID must be set"));
static GITHUB_CLIENT_SECRET: Lazy<String> =
    Lazy::new(|| std::env::var("GITHUB_CLIENT_SECRET").expect("GITHUB_CLIENT_SECRET must be set"));
const REDIRECT_URI: &str = "http://127.0.0.1:54321/callback"; // 固定端口，需与 GitHub App 设置一致
const CSRF_STATE_EXPIRY_SECS: u64 = 300; // State 有效期 (例如 5 分钟)

// --- State Management ---

// 用于存储临时的 CSRF state 和对应的 oneshot sender (用于将 code 发回给等待的任务)
// Key: csrf_state, Value: Sender to notify the waiting task with the received code or an error
pub type PendingAuthState = Arc<Mutex<HashMap<String, oneshot::Sender<Result<String, AuthError>>>>>;

// 用于管理本地服务器的关闭
pub struct ServerHandle {
   pub shutdown_tx: Option<oneshot::Sender<()>>,
}
// 使用 Tokio Mutex 包装 ServerHandle 以便在异步上下文中使用
pub type AuthServerState = Arc<TokioMutex<ServerHandle>>;

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

#[derive(Serialize, Deserialize, Debug, Clone)] // Clone needed for emitting
pub struct GithubUserProfile {
    login: String,
    id: u64,
    name: Option<String>,
    avatar_url: String,
    email: Option<String>, // May be null depending on scope and user settings
}

#[derive(Serialize, Debug, Clone, Error)] // Clone needed for emitting
pub enum AuthError {
    #[error("Network request failed: {0}")]
    ReqwestError(String), // Store as String as reqwest::Error is not Serializable
    #[error("Failed to start local server: {0}")]
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
}

// Helper to convert reqwest::Error
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
    auth_server_state: State<'_, AuthServerState>,
) -> Result<String, String> { // Returns GitHub Auth URL or an error string
    println!("Starting GitHub OAuth flow initiation...");

    // 1. Generate State
    let state: String = thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    // 2. Prepare for callback channel
    let (code_tx, code_rx) = oneshot::channel::<Result<String, AuthError>>();

// --- Start Server Task ---
// Clone necessary state for the server task
let server_pending_state_clone = Arc::clone(&pending_auth_state);
let server_auth_server_state_clone = Arc::clone(&auth_server_state);
let server_app_handle = app.clone();

// Declare variables needed outside the lock scope
let internal_shutdown_tx: oneshot::Sender<()>; // Declare sender outside
let server_task_handle; // Declare task handle outside

// === Start a new scope for the lock ===
{
    let mut server_handle_guard = server_auth_server_state_clone.lock().await; // Lock acquired L122 (Conceptually)
    if server_handle_guard.shutdown_tx.is_some() {
        println!("Auth server seems to be already running.");
        return Err("Authentication process already in progress.".to_string());
    }

    let addr = SocketAddr::from(([127, 0, 0, 1], 54321));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            let err_msg = format!("Failed to bind to {}: {}", addr, e);
            eprintln!("{}", err_msg);
            app.emit("github_auth_error", Some(AuthError::ServerStartError(err_msg.clone())))
                .expect("Failed to emit server start error event");
            return Err(err_msg);
        }
    };

    // Create the shutdown channel *inside* the lock scope if needed to store tx
    let (tx, internal_shutdown_rx) = oneshot::channel::<()>();
    internal_shutdown_tx = tx; // Assign to the outer variable

    let app_router = Router::new()
        .route("/callback", get(github_callback_handler))
        .with_state(server_pending_state_clone.clone()); // Clone for router state

    let server_config = axum::serve(listener, app_router.into_make_service())
        .with_graceful_shutdown(async {
            internal_shutdown_rx.await.ok();
            println!("Auth callback server shutting down gracefully.");
        });

    println!("Auth callback server listening on {}", addr);

    // Clone the state *again* specifically for the spawned task before moving it
    let task_server_state_clone = Arc::clone(&server_auth_server_state_clone);

    server_task_handle = tokio::spawn(async move { // Now moves task_server_state_clone
        if let Err(e) = server_config.await {
            eprintln!("Auth server error: {}", e);
        } else {
            println!("Auth server finished gracefully.");
        }
        // Use the moved clone inside the task
        let mut guard = task_server_state_clone.lock().await;
        guard.shutdown_tx = None;
        println!("Server handle cleared after server task completion.");
    });

    // Store the shutdown sender in the state using the guard
    server_handle_guard.shutdown_tx = Some(internal_shutdown_tx);
    // === Lock (`server_handle_guard`) goes out of scope and is dropped here === L172 (Conceptually)
} // <--- End of the lock scope


    // 3. Store state and sender *before* returning URL
    {
        let mut pending_map = pending_auth_state.lock().expect("Failed to lock pending auth state");
        pending_map.insert(state.clone(), code_tx);
        println!("State stored. Ready for callback.");
    }

    // 4. Build GitHub Authorization URL
    let auth_url = format!(
        "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&scope={}&state={}",
        *GITHUB_CLIENT_ID,
        urlencoding::encode(REDIRECT_URI),
        urlencoding::encode("read:user user:email"),
        state.clone() // Clone state for the URL
    );

    // --- Spawn the Task to Wait for Callback and Handle Flow ---
    // Clone remaining needed variables for the spawned task
    let task_pending_auth_state = Arc::clone(&pending_auth_state);
    let task_auth_server_state = Arc::clone(&auth_server_state);
    let task_state = state.clone(); // Clone state again for the task

    tokio::spawn(async move {
        println!("Spawned task waiting for callback or timeout for state: {}", task_state);
        // --- Wait for callback or timeout ---
        let code_result = match tokio::time::timeout(
            std::time::Duration::from_secs(CSRF_STATE_EXPIRY_SECS),
            code_rx,
        )
        .await
        {
            Ok(Ok(code_res)) => code_res,
            Ok(Err(_rx_err)) => {
                 Err(AuthError::InternalError("Callback sender dropped unexpectedly.".into()))
            }
            Err(_timeout_err) => {
                if task_pending_auth_state.lock().unwrap().remove(&task_state).is_some() {
                     println!("Auth timed out, removing state: {}", task_state);
                } else {
                     println!("Auth timed out, state already removed or invalid: {}", task_state);
                }
                Err(AuthError::CallbackTimeout)
            }
        };

        // --- Process Callback Result (inside the spawned task) ---
        let final_result = match code_result {
            Ok(code) => {
                println!("Received code for state {}, exchanging for token...", task_state);
                match exchange_code_for_token(&code).await {
                    Ok(token_info) => {
                        println!("Successfully obtained access token for state {}.", task_state);
                        match fetch_github_user_profile(&token_info.access_token).await {
                            Ok(profile) => {
                                println!("Successfully fetched profile for {}: {:?}", task_state, profile.login);
                                server_app_handle.emit( // Use cloned app handle
                                    "github_auth_success",
                                    Some(serde_json::json!({
                                        "token": token_info.access_token,
                                        "profile": profile,
                                    })),
                                ).expect("Failed to emit success event");
                                Ok(()) // Indicate success within the task
                            }
                            Err(err) => {
                                eprintln!("Error fetching profile for state {}: {:?}", task_state, err);
                                Err(err) // Propagate profile fetch error
                            }
                        }
                    }
                    Err(err) => {
                         eprintln!("Error exchanging code for state {}: {:?}", task_state, err);
                         Err(err) // Propagate token exchange error
                    }
                }
            }
            Err(err) => {
                eprintln!("Authentication failed for state {}: {:?}", task_state, err);
                // Ensure state is removed if error is not timeout (timeout already handled removal)
                if !matches!(err, AuthError::CallbackTimeout) {
                     task_pending_auth_state.lock().unwrap().remove(&task_state);
                }
                Err(err) // Propagate the initial error (timeout, internal, etc.)
            }
        };

         // --- Emit error event if any step failed ---
        if let Err(final_err) = final_result {
            let err_clone = final_err.clone(); // Clone error for emitting
            server_app_handle.emit("github_auth_error", Some(err_clone))
               .expect("Failed to emit error event");
        }


        // --- Shutdown Server (inside the spawned task, after processing) ---
         println!("Requesting server shutdown for state {} flow...", task_state);
        {
            let mut guard = task_auth_server_state.lock().await;
            if let Some(tx) = guard.shutdown_tx.take() {
                println!("Sending shutdown signal to auth server...");
                let _ = tx.send(()); // Send shutdown signal via the *internal* sender
                // We might not need to explicitly await the server_task_handle here,
                // as graceful shutdown handles it. But waiting can be useful for debugging.
                // Drop the guard to release the lock before potentially long await
                drop(guard);
                 match tokio::time::timeout(std::time::Duration::from_secs(5), server_task_handle).await {
                     Ok(Ok(_)) => println!("Server task joined successfully after state {} flow.", task_state),
                     Ok(Err(e)) => eprintln!("Server task panicked or finished with error after state {} flow: {}", task_state, e),
                     Err(_) => eprintln!("Timed out waiting for server task to finish after state {} flow.", task_state),
                 }

            } else {
                println!("Server already shut down or handle missing when state {} flow finished.", task_state);
            }
        }
         println!("Finished spawned task for state {}.", task_state);

    }); // End of tokio::spawn

    // 5. Return the URL immediately to the frontend
    println!("Returning auth URL to frontend. Background task will handle the rest.");
    Ok(auth_url)
}
// --- Axum Callback Handler ---

async fn github_callback_handler(
    Query(params): Query<CallbackParams>,
    AxumState(pending_state): AxumState<PendingAuthState>, // Extract the shared state
) -> Html<String> {
    println!("Callback received. State: {}, Code: [hidden]", params.state);

    // Find the corresponding sender for the state and remove it atomically
    let sender = pending_state.lock().unwrap().remove(&params.state);

    match sender {
        Some(tx) => {
            println!("State matched. Sending code back to waiting task.");
            // Send the code back to the waiting login_with_github task
            let send_result = tx.send(Ok(params.code));
            if send_result.is_err() {
                // This means the receiver (in login_with_github) was dropped,
                // likely due to timeout or cancellation before the callback arrived.
                eprintln!("Callback receiver was already dropped. State: {}", params.state);
                return Html(
                    "<html><body><h1>Authentication Error</h1><p>The application is no longer waiting for this login attempt. It might have timed out. Please try logging in again.</p></body></html>".to_string(),
                );
            }
            // Return a simple success page to the user
            Html(
                "<html><body><h1>Authentication Successful</h1><p>You can close this window now.</p><script>window.close();</script></body></html>".to_string(),
            )
        }
        None => {
            // State not found or already used/expired
            eprintln!("Invalid or expired state received: {}", params.state);
            // Do NOT send anything via tx here, as we don't have one.
            // The original task might time out or handle the error differently.
            // Return an error page to the user.
            Html(
                "<html><body><h1>Authentication Failed</h1><p>Invalid session state. Please try logging in again from the application.</p></body></html>".to_string(),
            )
            // Note: We didn't call tx.send(Err(AuthError::InvalidState)) here
            // because we don't *have* tx. The waiting task in login_with_github
            // will eventually time out or potentially receive an error if we modified
            // the state map differently. The current logic relies on timeout for invalid state.
            // A more robust implementation might have the callback handler directly
            // emit an error event to the frontend in this case.
        }
    }
}

// --- GitHub API Interaction ---

async fn exchange_code_for_token(code: &str) -> Result<GithubTokenResponse, AuthError> {
    let client = reqwest::Client::new();
    let params = [
        ("client_id", GITHUB_CLIENT_ID.as_str()),
        ("client_secret", GITHUB_CLIENT_SECRET.as_str()),
        ("code", code),
        ("redirect_uri", REDIRECT_URI), // Optional but recommended by GitHub
    ];

    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header(ACCEPT, "application/json") // Request JSON response
        .header(USER_AGENT, "Tauri GitHub Auth Example") // Good practice
        .form(&params)
        .send()
        .await?;

    if response.status().is_success() {
        let token_response = response.json::<GithubTokenResponse>().await?;
        // Check if GitHub returned an error object within the JSON instead of a token
        // (Though usually it sends non-200 status for errors here)
        if token_response.access_token.is_empty() {
             Err(AuthError::GitHubError(
                "Received empty access token".to_string(),
            ))
        } else {
            Ok(token_response)
        }
    } else {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        eprintln!("GitHub token exchange error: {}", error_text);
        Err(AuthError::GitHubError(format!(
            "Failed to exchange code: {}",
            error_text
        )))
    }
}

async fn fetch_github_user_profile(access_token: &str) -> Result<GithubUserProfile, AuthError> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.github.com/user")
        .header(AUTHORIZATION, format!("Bearer {}", access_token))
        .header(USER_AGENT, "Tauri GitHub Auth Example") // Required by GitHub API
        .send()
        .await?;

     if response.status().is_success() {
        let profile = response.json::<GithubUserProfile>().await
            .map_err(|e| AuthError::ParseError(format!("Failed to parse user profile: {}", e)))?;
        Ok(profile)
     } else {
         let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
         eprintln!("GitHub profile fetch error: {}", error_text);
        Err(AuthError::GitHubError(format!(
            "Failed to fetch user profile: {}",
            error_text
        )))
    }
}