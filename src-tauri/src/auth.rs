// src-tauri/src/auth.rs
use axum::{
    extract::{Query, State as AxumState},
    response::Html,
    routing::get,
    Router,
    http,
};
use once_cell::sync::Lazy; // Or load from config/env
use rand::distr::Alphanumeric;
use rand::{thread_rng, Rng};
use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT, CONTENT_TYPE}; // CONTENT_TYPE added
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

// --- NEW: Backend Worker Configuration ---
static WORKER_API_URL: Lazy<String> =
    Lazy::new(|| std::env::var("WORKER_API_URL").expect("WORKER_API_URL must be set (e.g., https://your-worker.your-domain.workers.dev/sync-user)"));
static WORKER_API_KEY: Lazy<String> =
    Lazy::new(|| std::env::var("WORKER_API_KEY").expect("WORKER_API_KEY must be set for backend authentication"));

// --- State Management ---

pub type PendingAuthState = Arc<Mutex<HashMap<String, oneshot::Sender<Result<String, AuthError>>>>>;

pub struct ServerHandle {
   pub shutdown_tx: Option<oneshot::Sender<()>>,
}
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

#[derive(Serialize, Deserialize, Debug, Clone)] // Clone needed for emitting and backend sync
pub struct GithubUserProfile {
    login: String,
    id: u64,
    name: Option<String>,
    avatar_url: String,
    email: Option<String>, // May be null depending on scope and user settings
}

// --- NEW: Backend Interaction Data Structures ---

#[derive(Serialize, Debug)]
struct BackendSyncPayload<'a> {
    profile: &'a GithubUserProfile,
    // 可以考虑是否也发送 token，取决于后端是否需要
    // access_token: Option<&'a str>,
}

#[derive(Deserialize, Debug)]
struct BackendSyncResponse {
    success: bool,
    message: Option<String>,
}


// --- Error Handling ---

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
    #[error("Failed to sync user data to backend: {0}")] // NEW Error Variant
    BackendSyncFailed(String),
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
    let server_pending_state_clone = Arc::clone(&pending_auth_state);
    let server_auth_server_state_clone = Arc::clone(&auth_server_state);
    let server_app_handle = app.clone(); // Clone app handle early for potential error emission

    let internal_shutdown_tx: oneshot::Sender<()>;
    let mut server_task_handle_option: Option<tokio::task::JoinHandle<()>> = None; // Store JoinHandle if server starts

    { // Lock Scope for Server Start
        let mut server_handle_guard = server_auth_server_state_clone.lock().await;
        if server_handle_guard.shutdown_tx.is_some() {
            println!("Auth server seems to be already running.");
            // Consider if returning an error is always right, maybe join existing flow?
            // For simplicity, we prevent concurrent flows initiated by this command.
            return Err("Authentication process already in progress.".to_string());
        }

        let addr = match REDIRECT_URI.parse::<http::Uri>() {
            Ok(uri) => match uri.authority() {
                 Some(auth) => SocketAddr::from(([127, 0, 0, 1], auth.port_u16().unwrap_or(54321))), // Default or parsed port
                 None => SocketAddr::from(([127, 0, 0, 1], 54321)), // Default if no authority
             },
             Err(_) => SocketAddr::from(([127, 0, 0, 1], 54321)), // Default on parse error
         };

        let listener = match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                let err_msg = format!("Failed to bind to {}: {}", addr, e);
                eprintln!("{}", err_msg);
                // Use the early cloned app handle
                let _ = server_app_handle.emit("github_auth_error", Some(AuthError::ServerStartError(err_msg.clone())));
                return Err(err_msg);
            }
        };

        let (tx, internal_shutdown_rx) = oneshot::channel::<()>();
        internal_shutdown_tx = tx; // Assign to outer variable

        let app_router = Router::new()
            .route("/callback", get(github_callback_handler))
            .with_state(server_pending_state_clone.clone()); // Clone for router state

        let server_config = axum::serve(listener, app_router.into_make_service())
            .with_graceful_shutdown(async {
                internal_shutdown_rx.await.ok();
                println!("Auth callback server shutting down gracefully.");
            });

        println!("Auth callback server listening on {}", addr);

        let task_server_state_clone = Arc::clone(&server_auth_server_state_clone);
        let server_task_handle = tokio::spawn(async move { // Task to run the server
            if let Err(e) = server_config.await {
                eprintln!("Auth server error: {}", e);
                // Potentially emit an event here too if the server crashes unexpectedly
            } else {
                println!("Auth server finished gracefully.");
            }
            let mut guard = task_server_state_clone.lock().await;
            guard.shutdown_tx = None; // Clear the handle once stopped
            println!("Server handle cleared after server task completion.");
        });

        // Store the shutdown sender and the task handle
        server_handle_guard.shutdown_tx = Some(internal_shutdown_tx);
        server_task_handle_option = Some(server_task_handle); // Store the handle

    } // Lock (`server_handle_guard`) released here

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
        urlencoding::encode("read:user user:email"), // Ensure scope covers profile details
        state.clone()
    );

    // --- Spawn the Task to Wait for Callback and Handle Flow ---
    let task_pending_auth_state = Arc::clone(&pending_auth_state);
    let task_auth_server_state = Arc::clone(&auth_server_state);
    let task_state = state.clone();
    let task_app_handle = app.clone(); // Use the main app handle passed into the command

    tokio::spawn(async move { // This is the "Authentication Processing Task"
        println!("Spawned task waiting for callback or timeout for state: {}", task_state);

        // --- Wait for callback or timeout ---
        let code_result = match tokio::time::timeout(
            std::time::Duration::from_secs(CSRF_STATE_EXPIRY_SECS),
            code_rx,
        )
        .await
        {
            Ok(Ok(code_res)) => {
                println!("Callback received for state {}", task_state);
                code_res // Should be Result<String, AuthError> from the callback handler
            },
            Ok(Err(_rx_err)) => {
                // Sender was dropped - this happens if the callback sends an error or if something panics
                eprintln!("Callback sender dropped unexpectedly for state {}", task_state);
                Err(AuthError::InternalError("Callback sender dropped unexpectedly.".into()))
            }
            Err(_timeout_err) => {
                 if task_pending_auth_state.lock().unwrap().remove(&task_state).is_some() {
                     println!("Auth timed out, removing state: {}", task_state);
                 } else {
                     println!("Auth timed out, state {} already removed or invalid.", task_state);
                 }
                Err(AuthError::CallbackTimeout)
            }
        };

        // --- Process Callback Result (inside the spawned task) ---
        // Chain the asynchronous operations using async blocks and match/Result combinators
        let final_result: Result<(), AuthError> = async {
            // Step A: Get Code (already done above, stored in code_result)
            let code = code_result?; // Propagate error if code_result is Err

            // Step B: Exchange Code for Token
            println!("Exchanging code for token for state {}...", task_state);
            let token_info = exchange_code_for_token(&code).await?;
            println!("Successfully obtained access token for state {}.", task_state);

            // Step C: Fetch GitHub User Profile
            println!("Fetching GitHub profile for state {}...", task_state);
            let profile = fetch_github_user_profile(&token_info.access_token).await?;
            println!("Successfully fetched profile for {}: {:?}", task_state, profile.login);

            // --> ADD THIS LINE <--
            println!("DEBUG: Full fetched profile data: {:?}", profile);
            // --> END ADDED LINE <--
            
            // --- NEW: Step D: Sync User Profile to Backend ---
            println!("Syncing profile to backend for state {}...", task_state);
            match sync_user_profile_to_backend(&profile).await {
                Ok(sync_response) => {
                    if sync_response.success {
                         println!("Successfully synced profile for state {} to backend.", task_state);
                    } else {
                         let err_msg = format!("Backend reported sync failure for state {}: {}", task_state, sync_response.message.unwrap_or_default());
                         eprintln!("{}", err_msg);
                         // Decide: Fail the whole login or just log? We choose to fail here.
                         return Err(AuthError::BackendSyncFailed(err_msg));
                    }
                }
                Err(sync_err) => {
                     eprintln!("Error syncing profile to backend for state {}: {:?}", task_state, sync_err);
                     // Propagate the sync error (likely BackendSyncFailed or ReqwestError)
                     return Err(sync_err);
                 }
             }

            // --- Step E: Emit Success Event ---
            println!("Authentication and sync successful for state {}. Emitting event.", task_state);
            task_app_handle.emit( // Use cloned app handle
                "github_auth_success",
                Some(serde_json::json!({
                    // Decide what frontend needs. Maybe just profile now?
                    // "token": token_info.access_token,
                    "profile": profile, // Profile is needed by frontend and was synced
                })),
            ).expect("Failed to emit success event");

            Ok(()) // Indicate overall success of the async block

        }.await; // Execute the async block


         // --- Handle Final Result (Error Emission) ---
        if let Err(final_err) = final_result {
            eprintln!("Authentication flow failed for state {}: {:?}", task_state, final_err);
             // Ensure state is removed if the error wasn't a timeout or invalid state from callback
            match final_err {
                AuthError::CallbackTimeout | AuthError::InvalidState => (), // Already handled or doesn't exist in map
                _ => {
                    // Remove state in case of other errors (e.g., GitHub API error, Backend Sync error)
                    task_pending_auth_state.lock().unwrap().remove(&task_state);
                }
            }
            // Emit the specific error encountered
            let err_clone = final_err.clone(); // Clone error for emitting
            task_app_handle.emit("github_auth_error", Some(err_clone))
               .expect("Failed to emit error event");
        }


        // --- Shutdown Server (always attempt, inside the spawned task, after processing) ---
         println!("Requesting server shutdown for state {} flow...", task_state);
        { // Lock scope for server shutdown
            let mut guard = task_auth_server_state.lock().await;
            if let Some(tx) = guard.shutdown_tx.take() { // Take the sender to signal shutdown
                println!("Sending shutdown signal to auth server...");
                let _ = tx.send(()); // Send the signal

                // Drop the lock *before* waiting on the join handle
                drop(guard);

                // Now wait for the server task handle if it was stored
                if let Some(server_task_handle) = server_task_handle_option {
                    match tokio::time::timeout(std::time::Duration::from_secs(5), server_task_handle).await {
                         Ok(Ok(_)) => println!("Server task joined successfully after state {} flow.", task_state),
                         Ok(Err(e)) => eprintln!("Server task panicked or finished with error after state {} flow: {}", task_state, e),
                         Err(_) => eprintln!("Timed out waiting for server task to finish after state {} flow.", task_state),
                    }
                 } else {
                    println!("Server task handle was not available for joining after state {} flow.", task_state);
                 }

            } else {
                println!("Server already shut down or handle missing when state {} flow finished.", task_state);
            }
        } // Lock released here
         println!("Finished spawned task for state {}.", task_state);

    }); // End of tokio::spawn for the "Authentication Processing Task"

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
            let send_result = tx.send(Ok(params.code)); // Send Ok(code)
            if send_result.is_err() {
                eprintln!("Callback receiver was already dropped (likely timed out). State: {}", params.state);
                return Html(
                    "<html><body><h1>Authentication Error</h1><p>The application is no longer waiting for this login attempt. It might have timed out. Please try logging in again.</p></body></html>".to_string(),
                );
            }
            Html(
                "<html><body><h1>Authentication Successful</h1><p>You can close this window now.</p><script>window.close();</script></body></html>".to_string(),
            )
        }
        None => {
            // State not found or already used/expired
            eprintln!("Invalid or expired state received: {}", params.state);
            // We cannot send Err back via tx here because we don't have tx.
            // The waiting task will time out.
            // Alternatively, we could try storing an error marker in a different state map
            // but timeout handling is simpler.
             // Explicitly send an error *if* we could find the tx, but here we can't.
            // If we had the sender, we might do:
            // let _ = tx.send(Err(AuthError::InvalidState));
            Html(
                "<html><body><h1>Authentication Failed</h1><p>Invalid session state. Please try logging in again from the application.</p></body></html>".to_string(),
            )
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
        ("redirect_uri", REDIRECT_URI),
    ];

    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "Tauri GitHub Auth Example") // Good practice
        .form(&params)
        .send()
        .await?; // Converts reqwest::Error to AuthError::ReqwestError

    if response.status().is_success() {
        let token_response = response.json::<GithubTokenResponse>().await
            .map_err(|e| AuthError::ParseError(format!("Failed to parse token response: {}", e)))?;
        if token_response.access_token.is_empty() {
             Err(AuthError::GitHubError("Received empty access token".to_string()))
        } else {
            Ok(token_response)
        }
    } else {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error reading response body".to_string());
        eprintln!("GitHub token exchange error ({}): {}", status, error_text);
        Err(AuthError::GitHubError(format!(
            "Failed to exchange code (status {}): {}",
            status, error_text
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
        .await?; // Converts reqwest::Error

     if response.status().is_success() {
        let profile = response.json::<GithubUserProfile>().await
            .map_err(|e| AuthError::ParseError(format!("Failed to parse user profile: {}", e)))?;
        Ok(profile)
     } else {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error reading response body".to_string());
        eprintln!("GitHub profile fetch error ({}): {}", status, error_text);
        Err(AuthError::GitHubError(format!(
            "Failed to fetch user profile (status {}): {}",
             status, error_text
        )))
    }
}


// --- NEW: Backend Worker API Interaction ---

async fn sync_user_profile_to_backend(profile: &GithubUserProfile) -> Result<BackendSyncResponse, AuthError> {
    println!("Attempting to sync profile for user ID: {}", profile.id);
    let client = reqwest::Client::new();
    let payload = BackendSyncPayload { profile }; // Add token if needed: , access_token: Some(token) };

    let response = client
        .post(WORKER_API_URL.as_str())
        .header(AUTHORIZATION, format!("Bearer {}", *WORKER_API_KEY))
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, "Tauri Backend Sync") // Identify the client
        .json(&payload) // Send profile data as JSON body
        .send()
        .await?; // Converts reqwest::Error

    let status = response.status();
    println!("Backend sync response status: {}", status);

    if status.is_success() {
        // Try to parse the success response from the worker
        let sync_response = response.json::<BackendSyncResponse>().await
            .map_err(|e| AuthError::ParseError(format!("Failed to parse backend sync response: {}", e)))?;
        Ok(sync_response) // Return the parsed response (contains success: bool)
    } else {
        // Attempt to read error message from backend response body
        let error_text = response.text().await.unwrap_or_else(|_| format!("HTTP error {}", status));
        eprintln!("Backend sync failed: {}", error_text);
        Err(AuthError::BackendSyncFailed(format!(
            "Backend API returned error (status {}): {}",
            status, error_text
        )))
    }
}